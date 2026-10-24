// Comercial V2.5.1 — consultas manuais, pacote offline, relatórios e linha do tempo locais.
// Não usar onSnapshot; nenhum clique em filtro/gráfico/timeline consulta Firestore.
import {db,SECTORS,escapeHtml,fmtDuration,initAuthUI,isAdmin,
  collection,query,where,orderBy,limit,startAfter} from './firebase-core.js';
import {getDocsFromServer} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {ms,elapsed,unionMs,effectiveStatus,countGroups,norm,category,buyer,localDate,selectDivergences,groupNotes,reportMetrics,noteTimeline} from './painel-local.js';

const $=s=>document.querySelector(s);
const PAGE_SIZE=50, FIRESTORE_PAGE=250, IN_CHUNK=30;
const DB_NAME='comercial_v2_reports_offline';
const MAX_SNAPSHOTS_PER_USER=5;
const state={user:null,profile:null,uid:'',snapshot:null,page:0,busy:false,showCharts:false,noteKey:'',inFlight:false,buyerSearch:''};
const sectors=SECTORS;
const esc=escapeHtml;
const dt=v=>ms(v)?new Date(ms(v)).toLocaleString('pt-BR'):'—';
const duration=fmtDuration;
function toast(msg,error=false){let t=$('#toast');if(!t)return;t.textContent=msg;t.className='toast '+(error?'error':'success');clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>t.classList.add('hidden'),6500);}
function fail(e){console.error('[Comercial Painel V2.5]',e);toast(e?.message||String(e),true);}
function status(msg){$('#cacheStatus').textContent=msg;}
function dateToday(offsetDays=0){const d=new Date();d.setDate(d.getDate()+offsetDays);const z=x=>String(x).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;}
function sameScope(a,start,end){return a?.start===start&&a?.end===end;}
function currentFilters(){return {start:$('#reportStart').value,end:$('#reportEnd').value,sector:$('#sectorFilter').value,buyer:$('#buyerFilter').value,category:$('#categoryFilter').value,status:$('#statusFilter').value,search:$('#searchFilter').value};}
function selected(){return selectDivergences(state.snapshot?.divs||[],currentFilters());}
function currentPasses(){return state.snapshot?.passes||[];}
function metric(label,val,sub=''){return `<article class="report-number"><small>${esc(label)}</small><strong>${esc(String(val))}</strong><span>${esc(sub)}</span></article>`;}
function sep(arr){return [...arr].filter(Boolean).join(', ')||'—';}
function labelSector(s){return sectors[s]||s||'—';}
function mapRows(rows){return rows.map(([key,v])=>({name:key,count:v.passagens,ms:v.ms,notes:v.notas.size})).sort((a,b)=>b.ms-a.ms);}
function timeTable(title,map,translate=v=>v){const rows=mapRows([...map].map(([k,v])=>[translate(k),v]));return `<div class="time-block"><h3>${esc(title)}</h3><div class="table-wrap"><table class="nf-compact-table"><thead><tr><th>Responsável</th><th>Notas</th><th>Passagens</th><th>Tempo</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.notes}</td><td>${x.count}</td><td>${duration(x.ms)}</td></tr>`).join('')||'<tr><td colspan="4">Nenhuma passagem encerrada no recorte.</td></tr>'}</tbody></table></div></div>`;}
function chart(title,rows,kind){
  const top=rows.slice(0,14),max=Math.max(1,...top.map(x=>x.divergencias));
  return `<article class="nf-chart"><h3>${esc(title)}</h3>${top.map(x=>`<button type="button" class="nf-bar-row nf-bar-action" data-chart="${esc(kind)}" data-value="${esc(x.name)}" title="Filtrar por ${esc(x.name)} sem nova consulta"><span>${esc(x.name)}</span><div class="nf-bar-track"><i style="width:${Math.round(100*x.divergencias/max)}%"></i></div><strong>${x.divergencias}</strong></button>`).join('')||'<p class="muted">Sem dados.</p>'}</article>`;
}
// O navegador de compradores trabalha sempre com o pacote local inteiro.
// Aplica os outros filtros (data, setor, categoria etc.) somente às CONTAGENS,
// mas jamais esconde um comprador só porque outro está selecionado.
function buyerDirectoryRows(){
  const all=state.snapshot?.divs||[];
  const f={...currentFilters(),buyer:'todos'};
  const visibleCounts=new Map(countGroups(selectDivergences(all,f),buyer).map(x=>[x.name,x.divergencias]));
  const names=[...new Set(all.map(buyer))].sort((a,b)=>{
    if(a==='Não informado no registro')return 1;
    if(b==='Não informado no registro')return -1;
    return a.localeCompare(b,'pt-BR');
  });
  return names.map(name=>({name,divergencias:visibleCounts.get(name)||0}));
}
function renderBuyerDirectory(){
  const rows=buyerDirectoryRows();
  const active=$('#buyerFilter').value;
  const totalInOtherFilters=rows.reduce((sum,row)=>sum+row.divergencias,0);
  const max=Math.max(1,...rows.map(x=>x.divergencias));
  const selectedName=active==='todos'?'Todos os compradores':active;
  return `<article class="nf-chart nf-buyers-directory" id="buyerDirectory">
    <div class="nf-buyer-heading"><div><h3>Compradores — escolha para filtrar</h3><p>Lista fixa dos dados baixados • ${rows.length} nome(s)</p></div><span class="nf-buyer-selection">${esc(selectedName)}</span></div>
    <label class="nf-buyer-search-label" for="buyerDirectorySearch">Pesquisar comprador<input type="search" id="buyerDirectorySearch" placeholder="Digite um nome..." autocomplete="off" aria-label="Pesquisar comprador na cópia local"></label>
    <div class="nf-buyer-list" id="buyerDirectoryList" role="group" aria-label="Filtrar por comprador">
      <button type="button" class="nf-buyer-item nf-buyer-all${active==='todos'?' selected':''}" data-chart="buyer" data-value="todos" aria-pressed="${active==='todos'}" title="Exibir dados de todos os compradores"><span class="nf-buyer-name">Todos os compradores</span><strong>${totalInOtherFilters}</strong></button>
      ${rows.map(row=>`<button type="button" class="nf-buyer-item${active===row.name?' selected':''}${row.divergencias===0?' no-matches':''}" data-chart="buyer" data-value="${esc(row.name)}" aria-pressed="${active===row.name}" title="${esc(row.name)} — ${row.divergencias} divergência(s) no recorte"><span class="nf-buyer-name">${esc(row.name)}</span><div class="nf-bar-track"><i style="width:${Math.round(100*row.divergencias/max)}%"></i></div><strong>${row.divergencias}</strong></button>`).join('')}
    </div>
    <p class="nf-buyer-empty hidden" id="buyerDirectoryEmpty">Nenhum comprador corresponde à pesquisa.</p>
    <p class="nf-buyer-footnote">A lista permanece visível. Os números acompanham os outros filtros; selecionar um nome atualiza gráficos e notas sem acessar o Firebase.</p>
  </article>`;
}
function filterBuyerDirectory(){
  const list=$('#buyerDirectoryList');
  if(!list)return;
  const search=norm(state.buyerSearch);
  let matching=0;
  list.querySelectorAll('.nf-buyer-item:not(.nf-buyer-all)').forEach(btn=>{
    const visible=!search||norm(btn.dataset.value).includes(search);
    btn.hidden=!visible;
    if(visible)matching++;
  });
  $('#buyerDirectoryEmpty')?.classList.toggle('hidden',matching>0||!search);
}
function renderChoices(){
  const d=state.snapshot?.divs||[];
  for(const [id,list,all] of [['#buyerFilter',[...new Set(d.map(buyer))],'Todos os compradores'],['#categoryFilter',[...new Set(d.map(category))],'Todas as categorias']]){
    const select=$(id);const selected=select.value;
    select.replaceChildren(new Option(all,id==='#buyerFilter'?'todos':'todas'),...list.sort((a,b)=>a.localeCompare(b,'pt-BR')).map(x=>new Option(x,x)));
    if([...select.options].some(o=>o.value===selected))select.value=selected;
  }
}
function renderReport(divs,metrics){
  if(!state.showCharts){$('#reportPanel').classList.add('hidden');return;}
  $('#reportPanel').classList.remove('hidden');
  const previousScroll=$('#buyerDirectoryList')?.scrollTop||0;
  const att=metrics.byAttribution;
  $('#reportContent').innerHTML=`<div class="report-grid">${metric('Passagens encerradas',metrics.passagens,'Relógios finalizados')}${metric('Tempo somado',duration(metrics.totalMs),'Com simultaneidades')}${metric('Tempo comercial',duration(att.get('comercial')?.ms||0),'Exclui erro CRF')}${metric('Tempo fiscal',duration(att.get('fiscal')?.ms||0),'Exclui erro CRF')}${metric('Tempo cadastro',duration(att.get('cadastro')?.ms||0),'Exclui erro CRF')}${metric('Retrabalho causado pela CRF',duration(att.get('crf_erro')?.ms||0),'Informações divergentes')}</div>
    <div class="nf-chart-grid">${renderBuyerDirectory()}${chart('Divergências por tipo',metrics.types,'type')}${chart('Divergências por departamento',metrics.sectors.map(x=>({...x,name:labelSector(x.name)})),'sector')}${chart('Categorias da NF',metrics.categories,'category')}${chart('Divergências por data',metrics.days.map(x=>({...x,name:x.name==='Sem data'?x.name:x.name.split('-').reverse().join('/')})),'day')}</div>
    <div class="two-col">${timeTable('Tempo por departamento que recebeu',metrics.byReceived,labelSector)}${timeTable('Tempo atribuído no relatório',metrics.byAttribution,x=>x==='crf_erro'?'Erro CRF':labelSector(x))}</div>
    ${timeTable('Tempo por comprador — todos os setores',metrics.byBuyer)}
    <p class="help">Estatísticas calculadas localmente apenas com os documentos do pacote do período. O tempo acumulado soma passagens, não é o tempo de calendário de cada NF. O botão de atualização é a única consulta de dados.</p>`;
  const searchInput=$('#buyerDirectorySearch');
  if(searchInput)searchInput.value=state.buyerSearch;
  const list=$('#buyerDirectoryList');
  if(list)list.scrollTop=previousScroll;
  filterBuyerDirectory();
}
function render(){
  const divs=selected(),notes=groupNotes(divs),metrics=reportMetrics(divs,currentPasses());
  for(const [id,value] of [['#metricNotas',metrics.notes],['#metricDivergencias',metrics.divergencias],['#metricPendentes',metrics.abertas],['#metricConcluidas',metrics.responded],['#metricTempo',duration(metrics.totalMs)]])$(id).textContent=String(value);
  const f=currentFilters(), snap=state.snapshot;
  let scopeMsg='Nenhum pacote carregado. Consulte um período ou abra dados salvos.';
  if(snap){const within=(!f.start||f.start>=snap.start)&&(!f.end||f.end<=snap.end);scopeMsg=`${divs.length} divergências • ${notes.length} NFs distintas • ${snap.divs.length} divergências no pacote • ${within?'pacote completo para o período carregado':'ATENÇÃO: período selecionado fora do pacote; clique Atualizar do Firebase'} • 0 consultas nos filtros`;
    if(!snap.complete)scopeMsg+=' • pacote marcado como parcial';}
  $('#dataInfo').textContent=scopeMsg;
  const activeBuyer=$('#buyerFilter').value;
  $('#buyerActiveInfo').textContent=activeBuyer==='todos'?'':`Filtro comprador: ${activeBuyer} — aplicado localmente`;
  $('#buyerActiveInfo').classList.toggle('hidden',activeBuyer==='todos');
  state.page=Math.min(state.page,Math.max(0,Math.ceil(notes.length/PAGE_SIZE)-1));
  const subset=notes.slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE);
  $('#noteRows').innerHTML=subset.map(n=>`<tr>
    <td><span class="pill ${n.status==='respondida'?'concluida':'aberta'}">${n.status==='aberta'?'Aberta':'Respondida'}</span></td>
    <td><strong>NF ${esc(n.numeroNf||'—')}</strong><br><small class="muted">${esc(n.cnpj)}</small></td>
    <td>${esc(n.fornecedorNome||'—')}</td>
    <td><strong>${n.divergencias.length}</strong> <span class="muted">${esc(sep(n.tipos))}</span></td>
    <td>${esc(sep([...n.setores].map(labelSector)))}</td>
    <td>${esc(sep(n.compradores))}</td>
    <td>${esc(n.categoria)}</td>
    <td>${dt(n.atualizadoMs)}</td>
    <td><button type="button" class="btn outline small" data-note="${esc(n.chave)}">Linha do tempo</button></td>
  </tr>`).join('')||'<tr><td colspan="9">Nenhuma NF encontrada para este recorte.</td></tr>';
  const pages=Math.ceil(notes.length/PAGE_SIZE);
  $('#pageInfo').textContent=`Página ${pages?state.page+1:0} de ${pages} • ${notes.length} NFs`;
  $('#prevPage').disabled=state.page===0;$('#nextPage').disabled=state.page+1>=pages;
  renderReport(divs,metrics);
}
function refreshUi(){renderChoices();state.page=0;render();}

// Armazenamento IndexedDB isolado por Firebase UID e período; nunca enviado a outro serviço.
let dbPromise=null;
function localDB(){
  if(!('indexedDB' in window))return Promise.reject(new Error('Este navegador não permite armazenamento local IndexedDB.'));
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('snapshots'))req.result.createObjectStore('snapshots',{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  }).catch(e=>{dbPromise=null;throw e;});return dbPromise;
}
async function listSaved(uid){const dbx=await localDB();return new Promise((resolve,reject)=>{const tx=dbx.transaction('snapshots','readonly');const rq=tx.objectStore('snapshots').getAll();rq.onsuccess=()=>resolve(rq.result.filter(x=>x.uid===uid).sort((a,b)=>b.fetchedAt-a.fetchedAt));rq.onerror=()=>reject(rq.error);});}
async function saveSnapshot(obj){
  const dbx=await localDB();
  await new Promise((resolve,reject)=>{const tx=dbx.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(obj);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  const all=await listSaved(obj.uid);
  if(all.length>MAX_SNAPSHOTS_PER_USER){await new Promise((resolve,reject)=>{const tx=dbx.transaction('snapshots','readwrite');all.slice(MAX_SNAPSHOTS_PER_USER).forEach(s=>tx.objectStore('snapshots').delete(s.id));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
}
async function deleteSaved(uid){const dbx=await localDB();const all=await listSaved(uid);return new Promise((resolve,reject)=>{const tx=dbx.transaction('snapshots','readwrite');all.forEach(s=>tx.objectStore('snapshots').delete(s.id));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function updateStatus(){
  const snap=state.snapshot;if(!snap){status('Sem pacote offline carregado. O Firebase só será consultado ao clicar Atualizar do Firebase.');return;}
  const when=new Date(snap.fetchedAt).toLocaleString('pt-BR');
  status(`Pacote salvo • ${snap.start} a ${snap.end} • ${when} • ${snap.divs.length} divergências, ${snap.passes.length} passagens e ${snap.events.length} eventos • pronto para filtros offline`);
}
async function restoreSaved(){if(!state.uid)return;try{
  const all=await listSaved(state.uid);if(!all.length){updateStatus();return;}
  const exact=all.find(s=>sameScope(s,$('#reportStart').value,$('#reportEnd').value));
  state.snapshot=exact||all[0];
  if(!exact){$('#reportStart').value=state.snapshot.start;$('#reportEnd').value=state.snapshot.end;}
  refreshUi();updateStatus();
}catch(e){status('A cópia local está indisponível neste navegador. A página ainda permite consultar o Firebase manualmente.');console.warn('[Comercial Offline]',e);}}

function jsonSafe(data){return JSON.parse(JSON.stringify(data));}
async function fetchPages(buildQuery,desc){
  const results=[];let cursor=null;
  for(let index=0;index<2000;index++){
    const q=buildQuery(cursor);const snap=await getDocsFromServer(q);
    results.push(...snap.docs.map(x=>({id:x.id,...jsonSafe(x.data())})));
    status(`Consultando Firebase: ${desc} — ${results.length} documentos baixados. Não feche a página...`);
    if(snap.size<FIRESTORE_PAGE)return results;
    cursor=snap.docs.at(-1);
  }
  throw new Error(`Limite de segurança de páginas excedido em ${desc}. Nada foi substituído na cópia salva.`);
}
async function fetchRelated(coll,keys){
  const output=[];
  for(let i=0;i<keys.length;i+=IN_CHUNK){
    const subset=keys.slice(i,i+IN_CHUNK);
    const rows=await fetchPages(cursor=>{
      const parts=[where('chave','in',subset),limit(FIRESTORE_PAGE)];
      if(cursor)parts.splice(1,0,startAfter(cursor));
      return query(collection(db,coll),...parts);
    },`${coll} • lote ${Math.floor(i/IN_CHUNK)+1}/${Math.ceil(keys.length/IN_CHUNK)}`);
    output.push(...rows);
  }
  return output;
}
async function synchronize(){
  if(state.busy||!state.uid)return;
  const from=$('#reportStart').value,to=$('#reportEnd').value;
  if(!from||!to)return toast('Defina data inicial e final para a consulta.',true);
  if(from>to)return toast('A data inicial não pode ser maior que a final.',true);
  state.busy=true;$('#syncButton').disabled=true;
  let ok=false;
  try{
    const start=new Date(`${from}T00:00:00`),end=new Date(`${to}T23:59:59.999`);
    const divs=await fetchPages(cursor=>{
      const parts=[where('criadoEm','>=',start),where('criadoEm','<=',end),orderBy('criadoEm','asc')];
      if(cursor)parts.push(startAfter(cursor));parts.push(limit(FIRESTORE_PAGE));
      return query(collection(db,'divergencias_v2'),...parts);
    },'divergências do período');
    // Buscar por CHAVE, não por ID da divergência, reduz o número de lotes
    // e preserva todo o histórico de eventos/passagens das NFs do período.
    const keys=[...new Set(divs.map(d=>d.chave).filter(Boolean))];
    const passes=await fetchRelated('passagens_v2',keys);
    const events=await fetchRelated('eventos_v2',keys);
    // Tudo é concluído antes de trocar o snapshot antigo, inclusive na ocorrência de erros.
    const snap={id:`${state.uid}|${from}|${to}`,uid:state.uid,start:from,end:to,fetchedAt:Date.now(),complete:true,divs,passes,events};
    try{await saveSnapshot(snap);}catch(error){
      toast('O relatório foi baixado, mas não coube no armazenamento local; poderá ser perdido após fechar a página.',true);
      console.warn('[Comercial Offline] Falha ao persistir:',error);
    }
    state.snapshot=snap;refreshUi();updateStatus();ok=true;
  }catch(e){fail(e);status('A sincronização falhou; mantive a cópia anterior. Nada foi apagado. Confira a conexão e as permissões do Firebase.');}
  finally{state.busy=false;$('#syncButton').disabled=false;}
  if(ok)toast('Pacote completo do período atualizado e pronto para consultas locais!');
}
function showTimeline(key){
  const all=state.snapshot;
  if(!all){toast('Carregue ou abra um pacote salvo antes de visualizar históricos.',true);return;}
  const t=noteTimeline(all.divs,all.events,all.passes,key);
  if(!t.divergences.length)return toast('Esta nota não está dentro do período carregado.',true);
  state.noteKey=key;
  const note=t.divergences[0], passMap=new Map(t.passages.map(p=>[p.id,p]));
  $('#detailTitle').textContent=`NF ${note.numeroNf||'—'} • ${note.fornecedorNome||'—'}`;
  $('#detailSubtitle').textContent=`${key} • ${t.divergences.length} divergência(s) • histórico da cópia local`;
  const timeBy=new Map();
  for(const p of t.passages.filter(x=>x.fimEm)){const k=p.setor||'não informado';const v=timeBy.get(k)||{ms:0,passagens:0};v.ms+=elapsed(p.inicioEm,p.fimEm);v.passagens++;timeBy.set(k,v);}
  const emap=new Map(t.divergences.map(d=>[d.id,d]));
  $('#detailContent').innerHTML=`<div class="report-grid">${metric('Tempo pendente (sem sobreposição)',duration(t.pendingMs),'União dos relógios')}${metric('Calendário da NF',duration(t.calendarMs),'Pode incluir intervalos livres')}${metric('Soma das passagens',duration(t.sumMs),'Inclui passagens simultâneas')}${metric('Passagens',t.passages.length,'Da mesma nota')}</div>
    <h3>Divergências da nota</h3><div class="nf-div-grid">${t.divergences.map(d=>`<article class="nf-div"><b>${esc(d.tipoNome||'—')}</b><span class="pill ${effectiveStatus(d)==='aberta'?'aberta':'concluida'}">${effectiveStatus(d)==='aberta'?'Aberta':'Respondida'}</span><small>${esc(labelSector(d.setor))} • ${esc(buyer(d))}</small><small>Resposta: ${esc(d.ultimaRespostaNome||'—')}</small></article>`).join('')}</div>
    <h3>Histórico completo em ordem cronológica (${t.events.length} eventos)</h3><div class="timeline nf-timeline">${t.events.map(e=>{const d=emap.get(e.divergenciaId)||{};const p=passMap.get(e.passagemId);return `<article class="event nf-event"><strong>${esc(e.respostaNome || (e.acao==='abrir'?'Aberta':e.acao==='responder'?'Respondida':e.acao||'Evento'))} • ${dt(e.criadoEm)}</strong><span class="muted">${esc(d.tipoNome||'Divergência')} • ${esc(labelSector(e.setor||d.setor))} • ${esc(e.compradorNome||buyer(d))}</span><small class="muted">${esc(e.usuarioNome||e.usuarioEmail||'Operador')} • Chamado ${esc(e.chamadoInfradeskId||'—')}${p?.fimEm?' • '+duration(elapsed(p.inicioEm,p.fimEm)):''}</small><p>${esc(e.texto||'—')}</p></article>`;}).join('')||'<p>Não há eventos gravados para esta nota.</p>'}</div>
    <h3>Passagens (${t.passages.length})</h3><div class="nf-pass-list">${t.passages.map(p=>`<article class="nf-passage"><b>${esc(labelSector(p.setor))}</b> ${p.compradorNome?' • '+esc(p.compradorNome):''}<small>${dt(p.inicioEm)} → ${p.fimEm?dt(p.fimEm):'Em andamento'}</small><small>${p.fimEm?duration(elapsed(p.inicioEm,p.fimEm)):'Relógio ativo'} • ${esc(p.respostaNome||'Aguardando resposta')}${p.atribuicaoTempo==='crf_erro'?' • Erro CRF':''}</small></article>`).join('')||'<p>Sem passagens.</p>'}</div>
    <p class="help">O histórico está disponível offline porque os eventos e passagens foram baixados durante a atualização do período. Os eventos e passagens de uma NF são baixados por chave, inclusive passagens de divergências antigas; a lista de divergências e os relatórios continuam filtrados pela data de abertura.</p>`;
  $('#detailOverlay').classList.remove('hidden');$('#closeDetail').focus();
}
function closeTimeline(){$('#detailOverlay').classList.add('hidden');state.noteKey='';}
function setBuyer(name){
  const select=$('#buyerFilter');
  if(![...select.options].some(o=>o.value===name))return;
  select.value=name;state.page=0;render();
}
function wire(){
  for(const id of ['#searchFilter','#sectorFilter','#statusFilter','#categoryFilter','#buyerFilter','#reportStart','#reportEnd']){
    $(id)?.addEventListener(id==='#searchFilter'?'input':'change',()=>{state.page=0;render();});
  }
  $('#syncButton').onclick=synchronize;
  $('#savedButton').onclick=async()=>{await restoreSaved();};
  $('#clearSaved').onclick=async()=>{if(!state.uid)return;if(!confirm('Apagar todas as cópias locais do Comercial deste usuário neste navegador? Os dados do Firebase NÃO serão apagados.'))return;try{await deleteSaved(state.uid);state.snapshot=null;refreshUi();updateStatus();toast('Cópias locais apagadas; Firebase preservado.');}catch(e){fail(e);}};
  $('#reportsButton').onclick=()=>{state.showCharts=!state.showCharts;$('#reportsButton').textContent=state.showCharts?'Ocultar relatório':'Mostrar relatório';render();};
  $('#closeReports').onclick=()=>{state.showCharts=false;$('#reportsButton').textContent='Mostrar relatório';render();};
  $('#clearBuyer').onclick=()=>{$('#buyerFilter').value='todos';state.page=0;render();};
  $('#prevPage').onclick=()=>{state.page=Math.max(0,state.page-1);render();};
  $('#nextPage').onclick=()=>{state.page++;render();};
  $('#noteRows').addEventListener('click',e=>{const key=e.target.closest('[data-note]')?.dataset.note;if(key)showTimeline(key);});
  $('#reportContent').addEventListener('input',e=>{
    if(e.target.id==='buyerDirectorySearch'){
      state.buyerSearch=e.target.value;
      filterBuyerDirectory(); // Não recalcula gráficos nem consulta Firebase durante a digitação.
    }
  });
  $('#reportContent').addEventListener('click',e=>{const btn=e.target.closest('[data-chart]');if(!btn)return;const kind=btn.dataset.chart,value=btn.dataset.value;
    if(kind==='buyer')setBuyer(value);
    else if(kind==='sector'){$('#sectorFilter').value=Object.keys(sectors).find(k=>sectors[k]===value)||'todos';state.page=0;render();}
    else if(kind==='category'){$('#categoryFilter').value=value;state.page=0;render();}
    else if(kind==='type'){$('#searchFilter').value=value;state.page=0;render();}
    else if(kind==='day'){
      const iso=value.includes('/')?value.split('/').reverse().join('-'):value;
      if(/^\d{4}-\d{2}-\d{2}$/.test(iso)){$('#reportStart').value=iso;$('#reportEnd').value=iso;state.page=0;render();}
    }
  });
  $('#closeDetail').onclick=closeTimeline;
  $('#detailOverlay').addEventListener('click',e=>{if(e.target===$('#detailOverlay'))closeTimeline();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#detailOverlay').classList.contains('hidden'))closeTimeline();});
}
$('#reportStart').value=dateToday(-7);$('#reportEnd').value=dateToday();wire();
initAuthUI({onError:fail,onUser:async(u,p)=>{
  state.user=u;state.profile=p;state.uid=p&&u?u.uid:'';state.snapshot=null;state.page=0;
  if(!state.uid){render();updateStatus();return;}
  $('#userLine').textContent=`${p.nome||u.email} • ${p.papel} • Painel V2.5.1 offline`;
  $('#adminLink').classList.toggle('hidden',!isAdmin(p));
  await restoreSaved();
  const deepLink=new URLSearchParams(location.search).get('nf');
  if(deepLink&&/^\d{44}$/.test(deepLink)&&state.snapshot?.divs.some(d=>d.chave===deepLink))showTimeline(deepLink);
}});
