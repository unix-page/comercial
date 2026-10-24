// Comercial V2.4.0 — painel por NF, histórico completo e relatórios sob demanda.
// Nenhuma consulta em tempo real. Carregue páginas adicionais apenas quando necessário.
import {db,SECTORS,escapeHtml,canon,fmtDate,fmtDuration,millis,initAuthUI,isAdmin,
  doc,collection,getDoc,getDocs,query,where,orderBy,limit,startAfter} from './firebase-core.js';
import {ms, elapsed, noteTimes, effectiveStatus, countGroups, buyerTimeGroups} from './metricas.js';
const $=s=>document.querySelector(s);
const BATCH=120, HISTORY_LIMIT=250, REPORT_GROUP=10, REPORT_GROUP_LIMIT=250;
const state={user:null,profile:null,docs:[],cursor:null,exhausted:false,fetching:false,openKey:'',reportBusy:false,historyBusy:false,deepOpened:false};
const labels={aberta:'Aberta',em_crf:'Aguardando CRF',respondida:'Respondida',concluida:'Concluída',devolucao:'Devolver / recusar'};
const dt=(t)=>fmtDate(t);
const cat=d=>String(d?.categoriaNota||d?.categoriaFornecedor||d?.tipoNota||'Categoria não registrada');
const labelSector=k=>SECTORS[k]||k||'—';
function toast(message,error=false){const el=$('#toast');if(!el)return;el.textContent=message;el.className=`toast ${error?'error':'success'}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add('hidden'),6500);}
function handleError(e){console.error('[Comercial V2.4]',e);toast(e?.message||String(e),true);}
function dateInRange(d){
  const date=ms(d.criadoEm||d.atualizadoEm);
  const start=$('#reportStart')?.value, end=$('#reportEnd')?.value;
  // Sem data no documento, incluímos apenas quando não há filtro temporal.
  if(!start&&!end)return true;
  if(!date)return false;
  if(start&&date<new Date(start+'T00:00:00').getTime())return false;
  if(end&&date>new Date(end+'T23:59:59.999').getTime())return false;
  return true;
}
function visibleRows(){
  const q=canon($('#searchFilter')?.value),setor=$('#sectorFilter')?.value||'todos',status=$('#statusFilter')?.value||'todos',category=$('#categoryFilter')?.value||'todas';
  return state.docs.filter(d=>
    (setor==='todos'||d.setor===setor)&&
    (status==='todos'||effectiveStatus(d)===status)&&
    (category==='todas'||cat(d)===category)&&dateInRange(d)&&
    (!q||canon([d.chave,d.cnpj,d.numeroNf,d.fornecedorNome,d.tipoNome,d.compradorNome,cat(d),(d.chamadosInfradeskIds||[]).join(' ')].join(' ')).includes(q))
  );
}
function renderCategories(){
  const select=$('#categoryFilter');if(!select)return;
  const prev=select.value;
  const cats=[...new Set(state.docs.map(cat))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  select.replaceChildren(new Option('Todas','todas'),...cats.map(x=>new Option(x,x)));
  if([...select.options].some(x=>x.value===prev))select.value=prev;
}
function renderTable(){
  const rows=visibleRows(),notes=new Set(rows.map(d=>d.chave));
  $('#metricNotas').textContent=notes.size;
  $('#metricDivergencias').textContent=rows.length;
  $('#metricPendentes').textContent=rows.filter(d=>['aberta','em_crf'].includes(effectiveStatus(d))).length;
  $('#metricConcluidas').textContent=rows.filter(d=>['respondida','concluida'].includes(effectiveStatus(d))).length;
  $('#metricDevolucoes').textContent=rows.filter(d=>effectiveStatus(d)==='devolucao').length;
  $('#dataInfo').textContent=`${rows.length} divergências filtradas • ${state.docs.length} carregadas • ${notes.size} notas distintas • sem monitoramento automático${state.exhausted?' • fim da consulta':' • mais registros podem existir'}`;
  $('#loadMore').disabled=state.fetching||state.exhausted;
  $('#loadMore').textContent=state.exhausted?'Todas as páginas consultadas':'Carregar mais 120';
  $('#divergenceRows').innerHTML=rows.map(d=>`<tr>
    <td><span class="pill ${escapeHtml(effectiveStatus(d)==='respondida'?'concluida':effectiveStatus(d))}">${escapeHtml(labels[effectiveStatus(d)]||d.status||'—')}</span></td>
    <td><strong>NF ${escapeHtml(d.numeroNf||'—')}</strong><br><span class="muted">${escapeHtml(d.cnpj||'—')}</span></td>
    <td>${escapeHtml(d.fornecedorNome||'—')}</td>
    <td><strong>${escapeHtml(labelSector(d.setor))}</strong><br><span class="muted">${escapeHtml(d.tipoNome||'—')}</span></td>
    <td>${escapeHtml(d.compradorNome||'—')}</td>
    <td class="category-cell">${escapeHtml(cat(d))}</td>
    <td>${dt(d.atualizadoEm)}</td>
    <td><button class="btn small outline" data-key="${escapeHtml(d.chave||'')}">Linha do tempo da NF</button></td></tr>`).join('')||'<tr><td colspan="8">Nenhuma divergência encontrada no conjunto carregado.</td></tr>';
}
async function loadPage(reset=false){
  if(!state.profile||state.fetching)return;
  if(state.exhausted&&!reset)return;
  state.fetching=true;
  try{
    let q=query(collection(db,'divergencias_v2'),orderBy('atualizadoEm','desc'),limit(BATCH));
    if(!reset&&state.cursor)q=query(collection(db,'divergencias_v2'),orderBy('atualizadoEm','desc'),startAfter(state.cursor),limit(BATCH));
    const snap=await getDocs(q);
    if(reset){state.docs=[];state.cursor=null;state.exhausted=false;}
    const docs=snap.docs.map(d=>({id:d.id,...d.data()}));
    const existing=new Set(state.docs.map(d=>d.id));
    state.docs.push(...docs.filter(d=>!existing.has(d.id)));
    state.cursor=snap.docs.at(-1)||state.cursor;
    state.exhausted=snap.size<BATCH;
    renderCategories();renderTable();
  }catch(e){handleError(e);}finally{state.fetching=false;renderTable();}
}
function sortedByDate(rows,field='criadoEm'){return [...rows].sort((a,b)=>ms(a[field])-ms(b[field]));}
function noteInfo(divs,note){
  const d=divs[0]||{};
  return `NF ${escapeHtml(note.numeroNf||d.numeroNf||'—')} • ${escapeHtml(note.fornecedorNome||d.fornecedorNome||'—')}`;
}
function metricsCard(label,value,small='') {return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(small)}</small></div>`;}
function timelineEntry(event,divById,passById){
  const div=divById.get(event.divergenciaId)||{};
  const p=passById.get(event.passagemId)||null;
  const name=event.respostaNome||({abrir:'Divergência aberta',responder:'Resposta recebida',reabrir:'Reaberta',encaminhar:'Encaminhada',observacao:'Observação',devolver:'Devolução',concluir:'Concluída'}[event.acao]||event.acao||'Evento');
  const time=p?.fimEm?` • passagem ${fmtDuration(elapsed(p.inicioEm,p.fimEm))}`:'';
  return `<article class="event nf-event"><strong>${escapeHtml(name)} • ${dt(event.criadoEm)}</strong>
    <span class="muted">${escapeHtml(div.tipoNome||event.tipoNome||'Divergência')} • ${escapeHtml(labelSector(event.setor||div.setor))}${event.compradorNome?' • '+escapeHtml(event.compradorNome):''}</span>
    <small class="muted">${escapeHtml(event.usuarioNome||event.usuarioEmail||'Operador')} • Chamado ${escapeHtml(event.chamadoInfradeskId||'—')}${escapeHtml(time)}</small>
    <p>${escapeHtml(event.texto||'—')}</p></article>`;
}
async function showNote(chave){
  if(state.historyBusy||!/^\d{44}$/.test(String(chave)))return;
  state.historyBusy=true;state.openKey=chave;
  $('#detailPanel').classList.remove('hidden');
  $('#detailTitle').textContent='Histórico completo da NF';
  $('#detailSubtitle').textContent='Chave '+chave;
  $('#detailContent').textContent='Consultando divergências, eventos e passagens desta NF...';
  try{
    // Uma consulta por coleção, sob demanda, filtrando APENAS a chave. Sem N+1 por divergência.
    const [noteSnap,dSnap,eSnap,pSnap]=await Promise.all([
      getDoc(doc(db,'notas_v2',chave)),
      getDocs(query(collection(db,'divergencias_v2'),where('chave','==',chave),limit(80))),
      getDocs(query(collection(db,'eventos_v2'),where('chave','==',chave),limit(HISTORY_LIMIT))),
      getDocs(query(collection(db,'passagens_v2'),where('chave','==',chave),limit(HISTORY_LIMIT)))
    ]);
    const note=noteSnap.exists()?noteSnap.data():{};
    const divs=dSnap.docs.map(x=>({id:x.id,...x.data()}));
    const events=sortedByDate(eSnap.docs.map(x=>({id:x.id,...x.data()})));
    const passes=sortedByDate(pSnap.docs.map(x=>({id:x.id,...x.data()})),'inicioEm');
    const total=noteTimes(divs,passes);
    const dById=new Map(divs.map(d=>[d.id,d]));
    const pById=new Map(passes.map(p=>[p.id,p]));
    const byType=new Map();
    for(const p of passes.filter(p=>p.inicioEm&&p.fimEm)) {
      const name=dById.get(p.divergenciaId)?.tipoNome || 'Tipo não identificado';
      const agg=byType.get(name)||{count:0,ms:0};
      agg.count++;agg.ms+=elapsed(p.inicioEm,p.fimEm);byType.set(name,agg);
    }
    const category=note.categoriaNota||divs.find(d=>d.categoriaNota)?.categoriaNota||'Categoria não registrada';
    const timeRows=Object.entries(total.bySector).map(([k,v])=>`<tr><td>${escapeHtml(labelSector(k))}</td><td>${v.passagens}</td><td>${fmtDuration(v.ms)}</td></tr>`).join('');
    const responsibleRows=Object.entries(total.byAttribution).map(([k,v])=>`<tr><td>${escapeHtml(k==='crf_erro'?'Erro da CRF':labelSector(k))}</td><td>${v.passagens}</td><td>${fmtDuration(v.ms)}</td></tr>`).join('');
    const warning=(dSnap.size>=80||eSnap.size>=HISTORY_LIMIT||pSnap.size>=HISTORY_LIMIT)
      ?'<p class="notice error">Limite de histórico atingido: o tempo e a linha do tempo podem estar incompletos. Não considerar esses totais definitivos.</p>':'';
    $('#detailTitle').textContent=noteInfo(divs,note);
    $('#detailSubtitle').textContent=`${chave} • ${category} • ${divs.length} divergência(s) • ${(note.chamadosInfradeskIds||[]).length} chamado(s) associado(s)`;
    $('#detailContent').innerHTML=`
      ${warning}<div class="nf-facts"><div><b>Fornecedor</b><span>${escapeHtml(note.fornecedorNome||divs[0]?.fornecedorNome||'—')}</span></div><div><b>Categoria Infradesk</b><span>${escapeHtml(category)}</span></div><div><b>Empresa</b><span>${escapeHtml(note.empresa||'—')}</span></div><div><b>Chamados Infradesk</b><span>${escapeHtml((note.chamadosInfradeskIds||[]).join(', ')||'—')}</span></div></div>
      <h3>Tempos da NF</h3><div class="report-grid">
      ${metricsCard('Tempo da NF em pendência',fmtDuration(total.pendingMs),'Sem sobreposição; inclui períodos ainda abertos')}
      ${metricsCard('Intervalo de calendário',fmtDuration(total.calendarMs),total.pending?'Da primeira abertura até agora':'Primeira abertura até último encerramento (inclui intervalos livres)')}
      ${metricsCard('Soma das passagens',fmtDuration(total.sumPassagesMs),`${total.completedPassages} passagem(ns) concluída(s)`)}
      ${metricsCard('Tempo com setores (sem sobreposição)',fmtDuration(total.unionPassagesMs),'Intervalos simultâneos contados apenas uma vez')}
      ${metricsCard('Passagens abertas',String(total.openPassages),'Ainda com relógio em execução')}
      </div>
      <div class="two-col"><div><h3>Tempo de atendimento por setor</h3><table class="nf-compact-table"><thead><tr><th>Setor recebido</th><th>Passagens</th><th>Tempo</th></tr></thead><tbody>${timeRows||'<tr><td colspan="3">Nenhuma passagem concluída</td></tr>'}</tbody></table></div>
      <div><h3>Responsabilidade nos gráficos</h3><table class="nf-compact-table"><thead><tr><th>Responsável</th><th>Passagens</th><th>Tempo</th></tr></thead><tbody>${responsibleRows||'<tr><td colspan="3">Nenhuma passagem concluída</td></tr>'}</tbody></table></div></div>
      <h3>Tempo acumulado por tipo de divergência desta NF</h3>
      <div class="table-wrap"><table class="nf-compact-table"><thead><tr><th>Tipo</th><th>Passagens</th><th>Tempo somado</th></tr></thead><tbody>${[...byType].sort((a,b)=>b[1].ms-a[1].ms).map(([name,v])=>`<tr><td>${escapeHtml(name)}</td><td>${v.count}</td><td>${fmtDuration(v.ms)}</td></tr>`).join('')||'<tr><td colspan="3">Sem passagens concluídas.</td></tr>'}</tbody></table></div>
      <h3>Divergências desta NF (${divs.length})</h3>
      <div class="nf-div-grid">${divs.map(d=>`<article class="nf-div"><b>${escapeHtml(d.tipoNome||'—')}</b><span class="pill ${escapeHtml(effectiveStatus(d)==='respondida'?'concluida':effectiveStatus(d))}">${escapeHtml(labels[effectiveStatus(d)]||d.status||'—')}</span><small>${escapeHtml(labelSector(d.setor))}${d.compradorNome?' • '+escapeHtml(d.compradorNome):''}</small><small>${escapeHtml(d.ultimaRespostaNome||d.ultimaOcorrenciaTexto||'—')}</small></article>`).join('')||'<p>Sem divergências.</p>'}</div>
      <h3>Linha do tempo completa (${events.length} eventos)</h3>
      <div class="timeline nf-timeline">${events.map(e=>timelineEntry(e,dById,pById)).join('')||'<p>Sem eventos registrados.</p>'}</div>
      <h3>Passagens detalhadas (${passes.length})</h3><div class="nf-pass-list">${passes.map(p=>`<div class="nf-passage"><b>${escapeHtml(labelSector(p.setor))}</b> ${p.compradorNome?'• '+escapeHtml(p.compradorNome):''}<small>${dt(p.inicioEm)} → ${p.fimEm?dt(p.fimEm):'EM ANDAMENTO'}</small><small>${p.fimEm?fmtDuration(elapsed(p.inicioEm,p.fimEm)):'Relógio ativo'}${p.respostaNome?' • '+escapeHtml(p.respostaNome):''}${p.atribuicaoTempo==='crf_erro'?' • Retrabalho causado pela CRF':''}</small></div>`).join('')||'<p>Sem passagens.</p>'}</div>
      <p class="help">Tempo em pendência = união dos relógios abertos ou encerrados, sem dupla contagem de períodos simultâneos. Calendário = intervalo entre primeiro início e último fechamento (ou agora); pode incluir lacunas sem pendência. Soma das passagens = esforço acumulado por setor, mesmo com simultaneidade. Toda resposta encerra seu relógio.</p>`;
    $('#detailPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){handleError(e);$('#detailContent').textContent='Não foi possível carregar o histórico desta NF.';}
  finally{state.historyBusy=false;}
}
function chart(title,rows,mode='divergencias'){
  const top=rows.slice(0,10),max=Math.max(1,...top.map(x=>x[mode]||0));
  return `<article class="nf-chart"><h3>${escapeHtml(title)}</h3>${top.map(r=>`<div class="nf-bar-row"><span title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span><div class="nf-bar-track"><i style="width:${Math.max(2,Math.round((r[mode]||0)/max*100))}%"></i></div><strong>${r[mode]||0}</strong></div>`).join('')||'<p class="muted">Sem dados.</p>'}</article>`;
}
async function showReports(){
  if(state.reportBusy)return;
  state.reportBusy=true;
  const divs=visibleRows(),ids=[...new Set(divs.map(d=>d.id))];
  const uniqueNotes=new Set(divs.map(d=>d.chave));
  $('#reportPanel').classList.remove('hidden');
  $('#reportContent').textContent='Carregando passagens somente das divergências filtradas...';
  try{
    const passes=[];let incomplete=false;
    // Consultas direcionadas por ID, em lotes de 10. Evita ler centenas de passagens de outras notas.
    for(let i=0;i<ids.length;i+=REPORT_GROUP){
      const slice=ids.slice(i,i+REPORT_GROUP);
      const q=query(collection(db,'passagens_v2'),where('divergenciaId','in',slice),limit(REPORT_GROUP_LIMIT));
      const snap=await getDocs(q);
      if(snap.size>=REPORT_GROUP_LIMIT)incomplete=true;
      passes.push(...snap.docs.map(x=>({id:x.id,...x.data()})));
    }
    const complete=passes.filter(p=>p.inicioEm&&p.fimEm);
    const byResponsible=new Map(),byReceived=new Map();
    for(const p of complete){
      const duration=elapsed(p.inicioEm,p.fimEm);
      const receiver=p.setor||'nao_informado';
      const responsible=p.atribuicaoTempo==='crf_erro'?'crf_erro':receiver;
      for(const [map,key] of [[byResponsible,responsible],[byReceived,receiver]]){
        const v=map.get(key)||{passagens:0,tempoMs:0,notes:new Set()};
        v.passagens++;v.tempoMs+=duration;if(p.chave)v.notes.add(p.chave);map.set(key,v);
      }
    }
    const buyerTimes=buyerTimeGroups(divs,passes);
    const divById=new Map(divs.map(d=>[d.id,d]));
    const typeTimes=new Map();
    for(const p of complete) {
      const typeName=divById.get(p.divergenciaId)?.tipoNome||'Tipo não identificado';
      const agg=typeTimes.get(typeName)||{ms:0,passagens:0,notes:new Set()};
      agg.ms+=elapsed(p.inicioEm,p.fimEm);agg.passagens++;if(p.chave)agg.notes.add(p.chave);typeTimes.set(typeName,agg);
    }
    const buyers=countGroups(divs,d=>d.compradorNome||'Sem comprador');
    const types=countGroups(divs,d=>d.tipoNome||'Sem tipo');
    const categories=countGroups(divs,cat);
    const dept=countGroups(divs,d=>labelSector(d.setor));
    const days=countGroups(divs,d=>{const time=ms(d.criadoEm||d.atualizadoEm);return time?new Date(time).toLocaleDateString('pt-BR'):'Sem data';});
    const sortedResponsible=[...byResponsible.entries()].sort((a,b)=>b[1].tempoMs-a[1].tempoMs);
    const warning=incomplete||!state.exhausted;
    $('#reportContent').innerHTML=`<p class="help">Recorte: divergências carregadas, respeitando filtros de setor, categoria, status, busca e <b>data de abertura da divergência</b>. Cada chave conta uma única vez por grupo.</p>
      ${warning?'<p class="notice">Relatório parcial: ainda há páginas de divergências não carregadas ou algum lote atingiu o limite. Clique em <b>Carregar mais</b> para ampliar o período analisado.</p>':''}
      <div class="report-grid">
      ${metricsCard('Notas distintas',String(uniqueNotes.size),'Chaves distintas no recorte')}
      ${metricsCard('Divergências',String(divs.length),'Problemas registrados')}
      ${metricsCard('Passagens concluídas',String(complete.length),'Relógios efetivamente encerrados')}
      ${metricsCard('Tempo acumulado',fmtDuration(complete.reduce((s,p)=>s+elapsed(p.inicioEm,p.fimEm),0)),'Soma dos relógios; pode haver simultaneidade')}
      </div>
      <div class="nf-chart-grid">
      ${chart('Divergências por comprador',buyers)}
      ${chart('Divergências por tipo',types)}
      ${chart('Divergências por departamento',dept)}
      ${chart('Categorias originais da NF',categories)}
      ${chart('Divergências por data de abertura',days)}
      </div>
      <h3>Tempo acumulado por tipo de divergência</h3>
      <div class="table-wrap"><table><thead><tr><th>Tipo de divergência</th><th>Notas distintas</th><th>Passagens concluídas</th><th>Tempo acumulado</th></tr></thead><tbody>${[...typeTimes].sort((a,b)=>b[1].ms-a[1].ms).map(([name,v])=>`<tr><td>${escapeHtml(name)}</td><td>${v.notes.size}</td><td>${v.passagens}</td><td>${fmtDuration(v.ms)}</td></tr>`).join('')||'<tr><td colspan="4">Sem passagens encerradas.</td></tr>'}</tbody></table></div>
      <h3>Tempo atribuído por responsabilidade</h3><div class="report-grid">${sortedResponsible.map(([k,v])=>metricsCard(k==='crf_erro'?'Retrabalho causado pela CRF':labelSector(k),fmtDuration(v.tempoMs),`${v.passagens} passagens • ${v.notes.size} NFs distintas`)).join('')||'<p>Sem passagens concluídas.</p>'}</div>
      <h3>Tempo registrado por departamento receptor</h3><div class="table-wrap"><table><thead><tr><th>Setor</th><th>Passagens</th><th>Notas distintas</th><th>Tempo (inclusive retornos indevidos)</th></tr></thead><tbody>${[...byReceived].sort((a,b)=>b[1].tempoMs-a[1].tempoMs).map(([k,v])=>`<tr><td>${escapeHtml(labelSector(k))}</td><td>${v.passagens}</td><td>${v.notes.size}</td><td>${fmtDuration(v.tempoMs)}</td></tr>`).join('')||'<tr><td colspan="4">Sem passagens.</td></tr>'}</tbody></table></div>
      <h3>Compradores — tempos das passagens</h3><div class="table-wrap"><table><thead><tr><th>Comprador</th><th>Notas distintas</th><th>Passagens</th><th>Tempo Comercial</th><th>Tempo erro CRF</th></tr></thead><tbody>${buyerTimes.map(b=>`<tr><td>${escapeHtml(b.nome)}</td><td>${b.notas}</td><td>${b.passagens}</td><td>${fmtDuration(b.ms)}</td><td>${fmtDuration(b.erroCrfMs)}</td></tr>`).join('')||'<tr><td colspan="5">Sem dados.</td></tr>'}</tbody></table></div>
      <p class="help">**Atenção:** esses são resultados do recorte carregado, não uma auditoria de toda a base. Categorias antigas que não foram gravadas aparecem como “Categoria não registrada”. Leituras adicionais ocorrem somente ao solicitar este relatório.</p>`;
  }catch(e){handleError(e);$('#reportContent').textContent='Não foi possível gerar o relatório.';}
  finally{state.reportBusy=false;}
}
$('#divergenceRows').addEventListener('click',e=>{const key=e.target.closest('[data-key]')?.dataset.key;if(key)showNote(key);});
for(const s of ['#searchFilter','#sectorFilter','#statusFilter','#categoryFilter','#reportStart','#reportEnd'])$(s)?.addEventListener('input',renderTable);
$('#refreshButton').addEventListener('click',()=>loadPage(true));
$('#loadMore').addEventListener('click',()=>loadPage(false));
$('#reportsButton').addEventListener('click',showReports);
$('#closeReports').addEventListener('click',()=>$('#reportPanel').classList.add('hidden'));
$('#closeDetail').addEventListener('click',()=>$('#detailPanel').classList.add('hidden'));
initAuthUI({onError:handleError,onUser:async(u,p)=>{
  state.user=u;state.profile=p;state.docs=[];state.cursor=null;state.exhausted=false;state.deepOpened=false;
  if(!u||!p)return;
  $('#userLine').textContent=`${p.nome||u.email} • ${p.papel}`;
  $('#adminLink').classList.toggle('hidden',!isAdmin(p));
  await loadPage(true);
  const fromUrl=new URLSearchParams(location.search).get('nf');
  if(fromUrl&&/^\d{44}$/.test(fromUrl)&&!state.deepOpened){state.deepOpened=true;await showNote(fromUrl);}
}});
