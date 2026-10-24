// Comercial V2.5 — cálculos puros, sem Firebase nem acesso ao navegador.
import {ms, elapsed, unionMs, effectiveStatus, countGroups} from './metricas.js';
export {ms, elapsed, unionMs, effectiveStatus, countGroups};
export const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
export const category = d => String(d?.categoriaNota || d?.categoriaFornecedor || d?.tipoNota || 'Categoria não registrada');
export const buyer = d => String(d?.compradorNome || d?.compradorAtualNome || 'Não informado no registro').trim();
export function localDate(value) {
  const n=ms(value); if(!n)return '';
  const d=new Date(n);const pad=x=>String(x).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
export function selectDivergences(all, f={}) {
  const search=norm(f.search), sector=f.sector||'todos',status=f.status||'todos',cat=f.category||'todas',buyerFilter=f.buyer||'todos';
  return all.filter(d => {
    if(f.start && localDate(d.criadoEm||d.atualizadoEm)<f.start)return false;
    if(f.end && localDate(d.criadoEm||d.atualizadoEm)>f.end)return false;
    if(sector!=='todos'&&d.setor!==sector)return false;
    if(status!=='todos'&&effectiveStatus(d)!==status)return false;
    if(cat!=='todas'&&category(d)!==cat)return false;
    if(buyerFilter!=='todos'&&buyer(d)!==buyerFilter)return false;
    return !search||norm([d.chave,d.numeroNf,d.cnpj,d.fornecedorNome,d.tipoNome,buyer(d),category(d),d.empresa].join(' ')).includes(search);
  });
}
export function groupNotes(divs) {
  const notes=new Map();
  for(const d of divs){
    if(!d.chave)continue;
    let x=notes.get(d.chave);
    if(!x){x={chave:d.chave,numeroNf:d.numeroNf||'',cnpj:d.cnpj||'',fornecedorNome:d.fornecedorNome||'',categoria:category(d),status:'respondida',atualizadoMs:0,divergencias:[],setores:new Set(),compradores:new Set(),tipos:new Set()};notes.set(d.chave,x);}
    x.divergencias.push(d);x.setores.add(d.setor||'');x.tipos.add(d.tipoNome||'');
    const name=buyer(d);if(name!=='Não informado no registro')x.compradores.add(name);
    const when=ms(d.atualizadoEm||d.ultimaOcorrenciaEm||d.criadoEm);
    if(when>x.atualizadoMs){x.atualizadoMs=when;x.numeroNf=d.numeroNf||x.numeroNf;x.fornecedorNome=d.fornecedorNome||x.fornecedorNome;x.categoria=category(d)||x.categoria;}
    if(effectiveStatus(d)==='aberta')x.status='aberta';
  }
  return [...notes.values()].sort((a,b)=>b.atualizadoMs-a.atualizadoMs||a.chave.localeCompare(b.chave));
}
export function reportMetrics(divs,passages) {
  const ids=new Set(divs.map(x=>x.id));const keys=new Set(divs.map(x=>x.chave));
  const counted=passages.filter(p=>ids.has(p.divergenciaId)&&p.inicioEm&&p.fimEm);
  const byReceived=new Map(),byAttribution=new Map(),byBuyer=new Map(),byType=new Map();
  const divMap=new Map(divs.map(d=>[d.id,d]));
  const add=(map,key,pass,duration)=>{const v=map.get(key)||{ms:0,passagens:0,notas:new Set()};v.ms+=duration;v.passagens++;if(pass.chave)v.notas.add(pass.chave);map.set(key,v);};
  for(const p of counted){
    const diff=elapsed(p.inicioEm,p.fimEm);const sector=p.setor||'não informado';const attr=p.atribuicaoTempo==='crf_erro'?'crf_erro':sector;
    const d=divMap.get(p.divergenciaId)||{};
    add(byReceived,sector,p,diff);add(byAttribution,attr,p,diff);
    add(byType,d.tipoNome||'Tipo não informado',p,diff);
    const b=buyer(d);add(byBuyer,b,p,diff);
  }
  return {notes:keys.size,divergencias:divs.length,abertas:divs.filter(x=>effectiveStatus(x)==='aberta').length,
    responded:divs.filter(x=>effectiveStatus(x)==='respondida').length,
    passagens:counted.length,totalMs:counted.reduce((s,p)=>s+elapsed(p.inicioEm,p.fimEm),0),
    byReceived,byAttribution,byBuyer,byType,
    buyers:countGroups(divs,d=>buyer(d)),types:countGroups(divs,d=>d.tipoNome||'Tipo não informado'),
    sectors:countGroups(divs,d=>d.setor||'Setor não informado'),categories:countGroups(divs,category),
    days:countGroups(divs,d=>localDate(d.criadoEm||d.atualizadoEm)||'Sem data')};
}
export function noteTimeline(divs,events,passes,key,now=Date.now()) {
  const list=divs.filter(d=>d.chave===key);const related=new Set(list.map(d=>d.id));
  const ee=events.filter(e=>e.chave===key||related.has(e.divergenciaId)).sort((a,b)=>ms(a.criadoEm)-ms(b.criadoEm));
  const pp=passes.filter(p=>p.chave===key||related.has(p.divergenciaId)).sort((a,b)=>ms(a.inicioEm)-ms(b.inicioEm));
  const ranges=pp.map(p=>({inicioEm:p.inicioEm,fimEm:p.fimEm||new Date(now)}));
  const first=Math.min(...[...list.map(d=>ms(d.criadoEm)),...pp.map(p=>ms(p.inicioEm))].filter(Boolean));
  const pending=pp.some(p=>!p.fimEm)||list.some(d=>effectiveStatus(d)==='aberta');
  const last=pending?now:Math.max(...[...pp.map(p=>ms(p.fimEm)),...list.map(d=>ms(d.atualizadoEm))].filter(Boolean));
  return {divergences:list,events:ee,passages:pp,pending,first:Number.isFinite(first)?first:0,last:Number.isFinite(last)?last:0,
    calendarMs:Number.isFinite(first)&&Number.isFinite(last)&&last>=first?last-first:0,
    pendingMs:unionMs(ranges),sumMs:pp.filter(p=>p.fimEm).reduce((s,p)=>s+elapsed(p.inicioEm,p.fimEm),0)};
}
