// Comercial V2.5.9 — filtros de gráficos com clique para ativar/desativar; análise 100% local.
// Não usar onSnapshot; nenhum clique em filtro/gráfico/timeline consulta Firestore.
import {db,SECTORS,escapeHtml,fmtDuration,initAuthUI,isAdmin,
  collection,query,where,orderBy,limit,startAfter} from './firebase-core.js';
import {getDocsFromServer} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {ms,elapsed,unionMs,effectiveStatus,countGroups,norm,category,buyer,localDate,selectDivergences,groupNotes,reportMetrics,noteTimeline,supplierKey,supplierRanking,openerRanking,openerKey} from './painel-local.js';
import {setupManualResponse} from './resposta-manual.js';
import {setupBuyerCorrection} from './corrigir-comprador.js';

const $=s=>document.querySelector(s);
const PAGE_SIZE=50, FIRESTORE_PAGE=250, IN_CHUNK=30;
const DB_NAME='comercial_v2_reports_offline';
const MAX_SNAPSHOTS_PER_USER=5;
const state={user:null,profile:null,uid:'',snapshot:null,page:0,busy:false,showCharts:false,noteKey:'',inFlight:false,typeFilter:'',dayFilter:'',openerFilter:'',supplierFilter:'',supplierQuickSearch:'',supplierQuery:'',supplierPage:0,supplierSort:'divergencias',supplierDetailKey:''};
let manualResponder = null;
let buyerCorrection = null;
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
function selected(){
  return filteredForChart('none');
}
// Recortes cruzados: cada gráfico mantém suas opções mesmo quando o próprio filtro
// está ativo. Comprador/tipo/setor/categoria/data/autor são independentes e 100% locais.
function filteredForChart(excludeKind='none'){
  const filters={...currentFilters()};
  if(excludeKind==='buyer')filters.buyer='todos';
  if(excludeKind==='sector')filters.sector='todos';
  if(excludeKind==='category')filters.category='todas';
  let rows=selectDivergences(state.snapshot?.divs||[],filters);
  if(excludeKind!=='type' && state.typeFilter)rows=rows.filter(d=>(d.tipoNome||'Tipo não informado')===state.typeFilter);
  if(excludeKind!=='day' && state.dayFilter)rows=rows.filter(d=>localDate(d.criadoEm||d.atualizadoEm)===state.dayFilter);
  if(excludeKind!=='opener' && state.openerFilter)rows=rows.filter(d=>openerKey(d)===state.openerFilter);
  if(excludeKind!=='supplier' && state.supplierFilter)rows=rows.filter(d=>supplierKey(d)===state.supplierFilter);
  return rows;
}
const chartKeys={
  buyer:buyer,
  type:d=>d.tipoNome||'Tipo não informado',
  sector:d=>d.setor||'Setor não informado',
  category,
  day:d=>localDate(d.criadoEm||d.atualizadoEm)||'Sem data'
};
function chartLabel(kind,key){
  if(kind==='sector')return sectors[key]||key;
  if(kind==='day' && /^\d{4}-\d{2}-\d{2}$/.test(key))return key.split('-').reverse().join('/');
  return key;
}
function chartSelectedValue(kind){
  const field={buyer:'#buyerFilter',sector:'#sectorFilter',category:'#categoryFilter'}[kind];
  if(field)return $(field)?.value||'';
  return kind==='type'?state.typeFilter:kind==='day'?state.dayFilter:kind==='supplier'?state.supplierFilter:kind==='opener'?state.openerFilter:'';
}
function chartItems(kind){
  if (kind==='opener') {
    // As aberturas vêm dos documentos divergencias_v2, jamais de passagens/respostas.
    // Mostrar o autor com o nome salvo na abertura, mas filtrar pelo UID estável.
    const all=openerRanking(state.snapshot?.divs||[]);
    const counts=new Map(openerRanking(filteredForChart('opener')).map(x=>[x.key,x.divergencias]));
    return all.map(x=>({name:x.key,label:x.name,divergencias:counts.get(x.key)||0}))
      .sort((a,b)=>b.divergencias-a.divergencias||a.label.localeCompare(b.label,'pt-BR'));
  }
  const getKey=chartKeys[kind];
  const base=state.snapshot?.divs||[];
  const all=[...new Set(base.map(getKey))];
  const counts=new Map(countGroups(filteredForChart(kind),getKey).map(x=>[x.name,x.divergencias]));
  return all.sort((a,b)=>((counts.get(b)||0)-(counts.get(a)||0))||chartLabel(kind,a).localeCompare(chartLabel(kind,b),'pt-BR'))
    .map(name=>({name,label:chartLabel(kind,name),divergencias:counts.get(name)||0}));
}

function currentPasses(){return state.snapshot?.passes||[];}
function metric(label,val,sub=''){return `<article class="report-number"><small>${esc(label)}</small><strong>${esc(String(val))}</strong><span>${esc(sub)}</span></article>`;}
function sep(arr){return [...arr].filter(Boolean).join(', ')||'—';}
function labelSector(s){return sectors[s]||s||'—';}
function mapRows(rows){return rows.map(([key,v])=>({name:key,count:v.passagens,ms:v.ms,notes:v.notas.size})).sort((a,b)=>b.ms-a.ms);}
function timeTable(title,map,translate=v=>v){const rows=mapRows([...map].map(([k,v])=>[translate(k),v]));return `<div class="time-block"><h3>${esc(title)}</h3><div class="table-wrap"><table class="nf-compact-table"><thead><tr><th>Responsável</th><th>Notas</th><th>Passagens</th><th>Tempo</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.notes}</td><td>${x.count}</td><td>${duration(x.ms)}</td></tr>`).join('')||'<tr><td colspan="4">Nenhuma passagem encerrada no recorte.</td></tr>'}</tbody></table></div></div>`;}
function chart(title,kind){
  const rows=chartItems(kind);
  const active=chartSelectedValue(kind);
  const empty=(kind==='buyer'?'Nenhum comprador no período.':'Nenhum dado no período.');
  const max=Math.max(1,...rows.map(r=>r.divergencias));
  return `<article class="nf-chart" data-chart-card="${kind}"${kind==='opener'?' style="align-self:start"':''}><h3>${esc(title)}</h3><div class="nf-chart-options" data-list-kind="${kind}" role="group" aria-label="${esc(title)}">
    ${rows.map(x=>`<button type="button" class="nf-bar-row nf-bar-action${active===x.name?' selected':''}${x.divergencias===0?' no-matches':''}" data-chart="${kind}" data-value="${esc(x.name)}" aria-pressed="${active===x.name}" title="${esc(x.label)} — clique novamente para remover o filtro"><span title="${esc(x.label)}">${esc(x.label)}</span><div class="nf-bar-track"><i style="width:${Math.round(100*x.divergencias/max)}%"></i></div><strong>${x.divergencias}</strong></button>`).join('')||`<p class="muted">${esc(empty)}</p>`}
  </div>${kind==='opener'?'<small class="help">Uma abertura por divergência criada, inclusive as já respondidas. Respostas não somam novas aberturas.</small>':''}</article>`;
}
// Rank sempre calculado sobre a cópia local, excluindo o próprio filtro de fornecedor.
// Isso deixa as alternativas visíveis quando o diretor seleciona um fornecedor.
const SUPPLIER_TOP=10, SUPPLIER_PER_PAGE=12;
const supplierRanks=()=>supplierRanking(filteredForChart('supplier'));
function matchesSupplier(item,search){
  const q=norm(search), digits=String(search||'').replace(/\D/g,'');
  return !q||norm(item.name).includes(q)||(digits.length>=3&&item.cnpj.includes(digits));
}
const formatCnpj = value => String(value||'').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
const shortSupplier = (name,size=30) => name.length>size?name.slice(0,size-1).trimEnd()+'…':name;
function supplierTopRows(){
  // Busca em TODOS os fornecedores do recorte; mesmo quem está fora do Top 10.
  const rows=supplierRanks().filter(x=>matchesSupplier(x,state.supplierQuickSearch));
  const max=Math.max(1,...rows.slice(0,SUPPLIER_TOP).map(x=>x.divergencias));
  return {rows, html:rows.slice(0,SUPPLIER_TOP).map(x=>`<button type="button" class="nf-bar-row nf-bar-action supplier-rank-row${state.supplierFilter===x.key?' selected':''}" data-chart="supplier" data-value="${esc(x.key)}" aria-pressed="${state.supplierFilter===x.key}" title="${esc(x.name)}${x.cnpj?' • '+formatCnpj(x.cnpj):''} • ${x.divergencias} divergência(s) em ${x.notas} NF(s)"><span class="supplier-rank-name"><b>${esc(shortSupplier(x.name))}</b><small>${esc(formatCnpj(x.cnpj)||'Sem CNPJ')} • ${x.notas} NF(s)</small></span><div class="nf-bar-track"><i style="width:${Math.round(100*x.divergencias/max)}%"></i></div><strong>${x.divergencias}</strong></button>`).join('')||'<p class="muted">Nenhum fornecedor corresponde à busca e aos filtros.</p>'};
}
function supplierChart(){
  const count=supplierRanks().length;
  const selected=state.supplierFilter?supplierRanks().find(x=>x.key===state.supplierFilter):null;
  const top=supplierTopRows();
  return `<article class="nf-chart supplier-chart" data-chart-card="supplier"><div class="supplier-chart-head"><h3>Fornecedores • Top 10</h3><span class="supplier-count">${count} no recorte</span></div>
    <label class="supplier-search-label" for="supplierQuickSearch">Pesquisar nome ou CNPJ</label>
    <input id="supplierQuickSearch" type="search" autocomplete="off" value="${esc(state.supplierQuickSearch)}" placeholder="Buscar entre todos os fornecedores..." aria-label="Pesquisar fornecedor no ranking">
    <div class="nf-chart-options" id="supplierTopList" data-list-kind="supplier" role="group" aria-label="Ranking dos fornecedores">${top.html}</div>
    <div class="supplier-chart-footer"><small id="supplierTopCount">${top.rows.length>SUPPLIER_TOP?'10 de ':''}${top.rows.length} fornecedor(es) encontrados</small><button type="button" class="btn outline small" data-open-suppliers>Ver todos</button></div>
    ${state.supplierFilter?`<button type="button" class="supplier-clear" data-clear-supplier>✕ Limpar fornecedor selecionado${selected?' — '+esc(shortSupplier(selected.name,35)):''}</button>`:''}</article>`;
}
function updateSupplierTopList(){
  const area=$('#supplierTopList');if(!area)return;
  const top=supplierTopRows();area.innerHTML=top.html;
  const count=$('#supplierTopCount');if(count)count.textContent=`${top.rows.length>SUPPLIER_TOP?'10 de ':''}${top.rows.length} fornecedor(es) encontrados`;
}
function modalSupplierRanks(){
  const rows=supplierRanks().filter(x=>matchesSupplier(x,state.supplierQuery));
  return state.supplierSort==='notas'?rows.sort((a,b)=>b.notas-a.notas||b.divergencias-a.divergencias||a.name.localeCompare(b.name,'pt-BR')):rows;
}
function renderSupplierDetails(){
  const target=$('#supplierDetail');if(!target)return;
  const key=state.supplierDetailKey;
  if(!key){target.classList.add('hidden');target.innerHTML='';return;}
  const divs=filteredForChart('supplier').filter(d=>supplierKey(d)===key);
  const item=supplierRanks().find(x=>x.key===key);
  if(!item||!divs.length){target.classList.add('hidden');target.innerHTML='';return;}
  const counts=(getKey)=>{const map=new Map();for(const d of divs){const k=getKey(d);map.set(k,(map.get(k)||0)+1);}return [...map].sort((a,b)=>b[1]-a[1]).slice(0,6);};
  const formatList=(list)=>list.map(([k,v])=>`<li><span>${esc(k)}</span><strong>${v}</strong></li>`).join('')||'<li>Não informado</li>';
  const notes=groupNotes(divs).slice(0,8);
  target.classList.remove('hidden');
  target.innerHTML=`<div class="supplier-detail-heading"><div><strong>${esc(item.name)}</strong><small>${esc(formatCnpj(item.cnpj)||'CNPJ não informado')} • ${item.divergencias} divergência(s) • ${item.notas} nota(s)</small></div><button type="button" class="btn small primary" data-supplier-apply="${esc(key)}">Filtrar painel</button></div>
    <div class="supplier-detail-grids"><div><b>Tipos de divergência</b><ul>${formatList(counts(d=>d.tipoNome||'Não informado'))}</ul></div><div><b>Compradores</b><ul>${formatList(counts(buyer))}</ul></div><div><b>Categorias da NF</b><ul>${formatList(counts(category))}</ul></div></div>
    <div class="supplier-note-preview"><b>Notas do recorte (até 8)</b><div>${notes.map(n=>`<button type="button" class="btn outline small" data-supplier-note="${esc(n.chave)}">NF ${esc(n.numeroNf||'—')} • ${n.divergencias.length} div.</button>`).join('')||'Nenhuma NF identificada'}</div></div>`;
}
function renderSupplierModal(){
  const all=modalSupplierRanks();const pageCount=Math.ceil(all.length/SUPPLIER_PER_PAGE);
  state.supplierPage=Math.min(state.supplierPage,Math.max(0,pageCount-1));
  const rows=all.slice(state.supplierPage*SUPPLIER_PER_PAGE,(state.supplierPage+1)*SUPPLIER_PER_PAGE);
  $('#supplierModalCount').textContent=`${all.length} fornecedores • dados da cópia local`;
  $('#supplierModalRows').innerHTML=rows.map(x=>`<tr${state.supplierFilter===x.key?' class="supplier-row-active"':''}><td><strong class="supplier-full-name" title="${esc(x.name)}">${esc(x.name)}</strong><small class="supplier-cnpj">${esc(formatCnpj(x.cnpj)||'Identificação por nome')}</small></td><td class="supplier-number">${x.notas}</td><td class="supplier-number"><b>${x.divergencias}</b></td><td class="supplier-table-actions"><button type="button" class="btn outline small" data-supplier-details="${esc(x.key)}">Detalhes</button><button type="button" class="btn primary small" data-supplier-apply="${esc(x.key)}">Filtrar painel</button></td></tr>`).join('')||'<tr><td colspan="4">Nenhum fornecedor encontrado para essa pesquisa.</td></tr>';
  $('#supplierPageInfo').textContent=`Página ${pageCount?state.supplierPage+1:0} de ${pageCount}`;
  $('#supplierPrev').disabled=state.supplierPage<=0;
  $('#supplierNext').disabled=state.supplierPage+1>=pageCount;
  renderSupplierDetails();
}
function openSupplierModal(){
  state.supplierQuery='';state.supplierPage=0;state.supplierDetailKey='';state.supplierSort='divergencias';
  $('#supplierModalSearch').value='';$('#supplierModalSort').value='divergencias';
  $('#supplierOverlay').classList.remove('hidden');renderSupplierModal();$('#supplierModalSearch').focus();
}
function closeSupplierModal(){
  $('#supplierOverlay').classList.add('hidden');state.supplierDetailKey='';
}
function clearAllReportFilters(){
  $('#searchFilter').value='';$('#sectorFilter').value='todos';$('#statusFilter').value='todos';
  $('#categoryFilter').value='todas';$('#buyerFilter').value='todos';
  state.typeFilter='';state.dayFilter='';state.openerFilter='';state.supplierFilter='';state.supplierQuickSearch='';
  state.page=0;render();
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
  const previousScroll=new Map([...document.querySelectorAll('#reportContent .nf-chart-options')]
    .map(el=>[el.dataset.listKind,el.scrollTop]));
  const att=metrics.byAttribution;
  $('#reportContent').innerHTML=`<div class="report-grid">${metric('Passagens encerradas',metrics.passagens,'Relógios finalizados')}${metric('Tempo somado',duration(metrics.totalMs),'Com simultaneidades')}${metric('Tempo comercial',duration(att.get('comercial')?.ms||0),'Exclui erro CRF')}${metric('Tempo fiscal',duration(att.get('fiscal')?.ms||0),'Exclui erro CRF')}${metric('Tempo cadastro',duration(att.get('cadastro')?.ms||0),'Exclui erro CRF')}${metric('Retrabalho causado pela CRF',duration(att.get('crf_erro')?.ms||0),'Informações divergentes')}</div>
    <p class="nf-chart-hint">Clique em uma barra para filtrar. Clique na mesma novamente para remover. Combine os filtros como quiser.</p>
    <div class="nf-chart-grid">${chart('Compradores','buyer')}${chart('Divergências por tipo','type')}${chart('Divergências por departamento','sector')}${chart('Categorias da NF','category')}${supplierChart()}${chart('Divergências por data','day')}${chart('Usuários que abriram divergências','opener')}</div>
    <div class="two-col">${timeTable('Tempo por departamento que recebeu',metrics.byReceived,labelSector)}${timeTable('Tempo atribuído no relatório',metrics.byAttribution,x=>x==='crf_erro'?'Erro CRF':labelSector(x))}</div>
    ${timeTable('Tempo por comprador — todos os setores',metrics.byBuyer)}
    <p class="help">Estatísticas calculadas localmente apenas com os documentos do pacote do período. O tempo acumulado soma passagens, não é o tempo de calendário de cada NF. O botão de atualização é a única consulta de dados.</p>`;
  document.querySelectorAll('#reportContent .nf-chart-options').forEach(el=>{
    if(previousScroll.has(el.dataset.listKind))el.scrollTop=previousScroll.get(el.dataset.listKind);
  });
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
  const activeSupplier=state.supplierFilter?supplierRanks().find(x=>x.key===state.supplierFilter):null;
  const supplierInfo=$('#supplierActiveInfo');
  supplierInfo.textContent=state.supplierFilter?`Filtro fornecedor: ${activeSupplier?.name||'Fornecedor selecionado'}${activeSupplier?.cnpj?' • '+formatCnpj(activeSupplier.cnpj):''} — aplicado localmente`:'';
  supplierInfo.classList.toggle('hidden',!state.supplierFilter);
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
  const localChange = snap.modificadoLocalmenteEm ? ` • resposta manual refletida localmente em ${new Date(snap.modificadoLocalmenteEm).toLocaleString('pt-BR')}` : '';
  status(`Pacote salvo • ${snap.start} a ${snap.end} • ${when} • ${snap.divs.length} divergências, ${snap.passes.length} passagens e ${snap.events.length} eventos${localChange} • pronto para filtros offline`);
}
async function restoreSaved(){if(!state.uid)return;try{
  const all=await listSaved(state.uid);if(!all.length){updateStatus();return;}
  const exact=all.find(s=>sameScope(s,$('#reportStart').value,$('#reportEnd').value));
  state.snapshot=exact||all[0];state.typeFilter='';state.dayFilter='';state.openerFilter='';state.supplierFilter='';state.supplierQuickSearch='';
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
    state.snapshot=snap;state.typeFilter='';state.dayFilter='';state.openerFilter='';state.supplierFilter='';state.supplierQuickSearch='';refreshUi();updateStatus();ok=true;
  }catch(e){fail(e);status('A sincronização falhou; mantive a cópia anterior. Nada foi apagado. Confira a conexão e as permissões do Firebase.');}
  finally{state.busy=false;$('#syncButton').disabled=false;}
  if(ok)toast('Pacote completo do período atualizado e pronto para consultas locais!');
}
// Depois de uma gravação manual concluída, corrigir o pacote local usando o mesmo
// resultado confirmado pela transação. Nenhuma nova consulta ao Firestore.
async function applyManualResult(info) {
  const snap = state.snapshot;
  if (!snap || !state.uid) return;
  const divergence = snap.divs.find(d => d.id === info.divId);
  const passage = snap.passes.find(p => p.id === info.passId);
  if (!divergence || !passage) return;
  divergence.passagemAbertaId = null;
  divergence.status = 'respondida';
  divergence.encerradoEm = info.time;
  divergence.ultimaRespostaId = info.resposta.id;
  divergence.ultimaRespostaNome = info.resposta.nome;
  divergence.ultimaOcorrenciaTexto = info.text;
  divergence.ultimaOcorrenciaEm = info.time;
  divergence.atualizadoEm = info.registradoEm;
  divergence.revisao = (Number(divergence.revisao) || 0) + 1;
  passage.fimEm = info.time;
  passage.fechadoPor = info.user.uid;
  passage.fechamento = 'resposta';
  passage.respostaId = info.resposta.id;
  passage.respostaNome = info.resposta.nome;
  passage.atribuicaoTempo = info.attributed;
  snap.events.push({
    id: info.eventId, chave: divergence.chave, divergenciaId: info.divId,
    acao: 'responder', setor: info.setor, passagemId: info.passId,
    compradorNome: divergence.compradorAtualNome || divergence.compradorNome || '',
    respostaId: info.resposta.id, respostaNome: info.resposta.nome,
    atribuicaoTempo: info.attributed, texto: info.text,
    usuarioId: info.user.uid, usuarioNome: info.user.nome, usuarioEmail: info.user.email,
    origem: 'site_manual', referencia: 'whatsapp',
    ocorridoEm: info.time, registradoEm: info.registradoEm, criadoEm: info.registradoEm
  });
  snap.modificadoLocalmenteEm = Date.now();
  try { await saveSnapshot(snap); } catch (e) {
    console.warn('[Comercial] Resposta gravada no Firebase; falha ao atualizar pacote offline:', e);
    toast('Resposta gravada! A cópia local não foi salva; clique Atualizar do Firebase depois.', true);
  }
  refreshUi();
  if (state.noteKey === divergence.chave) showTimeline(divergence.chave);
  updateStatus();
}
async function applyBuyerCorrection(info) {
  const snap=state.snapshot;
  if (!snap || !state.uid) return;
  const divergence=snap.divs.find(d=>d.id===info.divId);
  if (!divergence) return;
  divergence.compradorId=info.newBuyerId;
  divergence.compradorNome=info.newBuyerName;
  divergence.compradorAtualId=info.newBuyerId;
  divergence.compradorAtualNome=info.newBuyerName;
  divergence.compradorCorrigidoEm=info.changedAt;
  divergence.revisao=(Number(divergence.revisao)||0)+1;
  for (const p of snap.passes.filter(p=>p.divergenciaId===info.divId)) {
    p.compradorId=info.newBuyerId;
    p.compradorNome=info.newBuyerName;
  }
  snap.events.push({
    id:info.eventId,chave:divergence.chave,divergenciaId:info.divId,
    acao:'corrigir_comprador',setor:divergence.setor,
    compradorAnteriorId:info.oldBuyerId,compradorAnteriorNome:info.oldBuyerName,
    compradorId:info.newBuyerId,compradorNome:info.newBuyerName,
    motivo:info.reason, origem:'site_correcao_comprador',
    texto:`Comprador corrigido: ${info.oldBuyerName} → ${info.newBuyerName}. Motivo: ${info.reason}`,
    usuarioId:info.operator.uid,usuarioNome:info.operator.nome,usuarioEmail:info.operator.email,
    criadoEm:info.changedAt,registradoEm:info.changedAt
  });
  snap.modificadoLocalmenteEm=Date.now();
  try { await saveSnapshot(snap); }
  catch(e) { console.warn('[Comercial] Comprador corrigido no servidor, mas pacote offline não foi salvo:',e); toast('Comprador corrigido, mas a cópia local não persistiu; atualize o pacote depois.',true); }
  refreshUi();
  if (state.noteKey===divergence.chave) showTimeline(divergence.chave);
  updateStatus();
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
    <h3>Divergências da nota</h3><div class="nf-div-grid">${t.divergences.map(d=>`<article class="nf-div"><b>${esc(d.tipoNome||'—')}</b><span class="pill ${effectiveStatus(d)==='aberta'?'aberta':'concluida'}">${effectiveStatus(d)==='aberta'?'Aberta':'Respondida'}</span><small>${esc(labelSector(d.setor))} • ${esc(buyer(d))}</small><small>Resposta: ${esc(d.ultimaRespostaNome||'—')}</small>${state.profile && ['admin','usuario','crf'].includes(state.profile.papel) ? `<div class="nf-div-actions">${effectiveStatus(d)==='aberta' && d.passagemAbertaId ? `<button class="btn primary small" type="button" data-manual-div="${esc(d.id)}">Registrar resposta pelo site</button>` : ''}<button class="btn outline small" type="button" data-buyer-correction="${esc(d.id)}">Corrigir comprador</button></div>` : ''}</article>`).join('')}</div>
    <h3>Histórico completo em ordem cronológica (${t.events.length} eventos)</h3><div class="timeline nf-timeline">${t.events.map(e=>{const d=emap.get(e.divergenciaId)||{};const p=passMap.get(e.passagemId);return `<article class="event nf-event"><strong>${esc(e.respostaNome || (e.acao==='abrir'?'Aberta':e.acao==='responder'?'Respondida':e.acao==='corrigir_comprador'?'Comprador corrigido':e.acao||'Evento'))} • ${dt(e.ocorridoEm||e.criadoEm)}</strong>${e.origem==='site_manual'?`<small class="muted">Resposta informada do WhatsApp • Lançada no site em ${dt(e.registradoEm||e.criadoEm)}</small>`:''}<span class="muted">${esc(d.tipoNome||'Divergência')} • ${esc(labelSector(e.setor||d.setor))} • ${esc(e.compradorNome||buyer(d))}</span><small class="muted">${esc(e.usuarioNome||e.usuarioEmail||'Operador')} • Chamado ${esc(e.chamadoInfradeskId||'—')}${p?.fimEm?' • '+duration(elapsed(p.inicioEm,p.fimEm)):''}</small><p>${esc(e.texto||'—')}</p></article>`;}).join('')||'<p>Não há eventos gravados para esta nota.</p>'}</div>
    <h3>Passagens (${t.passages.length})</h3><div class="nf-pass-list">${t.passages.map(p=>`<article class="nf-passage"><b>${esc(labelSector(p.setor))}</b> ${p.compradorNome?' • '+esc(p.compradorNome):''}<small>${dt(p.inicioEm)} → ${p.fimEm?dt(p.fimEm):'Em andamento'}</small><small>${p.fimEm?duration(elapsed(p.inicioEm,p.fimEm)):'Relógio ativo'} • ${esc(p.respostaNome||'Aguardando resposta')}${p.atribuicaoTempo==='crf_erro'?' • Erro CRF':''}</small></article>`).join('')||'<p>Sem passagens.</p>'}</div>
    <p class="help">O histórico está disponível offline porque os eventos e passagens foram baixados durante a atualização do período. Os eventos e passagens de uma NF são baixados por chave, inclusive passagens de divergências antigas; a lista de divergências e os relatórios continuam filtrados pela data de abertura.</p>`;
  $('#detailOverlay').classList.remove('hidden');$('#closeDetail').focus();
}
function closeTimeline(){$('#detailOverlay').classList.add('hidden');state.noteKey='';}
function toggleChartFilter(kind,value){
  if(kind==='buyer'){
    const field=$('#buyerFilter');
    if(![...field.options].some(o=>o.value===value))return;
    field.value=field.value===value?'todos':value;
  } else if(kind==='sector'){
    const field=$('#sectorFilter');
    if(![...field.options].some(o=>o.value===value))return;
    field.value=field.value===value?'todos':value;
  } else if(kind==='category'){
    const field=$('#categoryFilter');
    if(![...field.options].some(o=>o.value===value))return;
    field.value=field.value===value?'todas':value;
  } else if(kind==='type'){
    state.typeFilter=state.typeFilter===value?'':value;
  } else if(kind==='supplier'){
    state.supplierFilter=state.supplierFilter===value?'':value;
  } else if(kind==='day'){
    if(value!=='Sem data' && !/^\d{4}-\d{2}-\d{2}$/.test(value))return;
    state.dayFilter=state.dayFilter===value?'':value;
  } else if(kind==='opener'){
    state.openerFilter=state.openerFilter===value?'':value;
  } else return;
  state.page=0;
  render();
}
function wire(){
  for(const id of ['#searchFilter','#sectorFilter','#statusFilter','#categoryFilter','#buyerFilter','#reportStart','#reportEnd']){
    $(id)?.addEventListener(id==='#searchFilter'?'input':'change',()=>{state.page=0;render();});
  }
  $('#syncButton').onclick=synchronize;
  $('#savedButton').onclick=async()=>{await restoreSaved();};
  $('#clearSaved').onclick=async()=>{if(!state.uid)return;if(!confirm('Apagar todas as cópias locais do Comercial deste usuário neste navegador? Os dados do Firebase NÃO serão apagados.'))return;try{await deleteSaved(state.uid);state.snapshot=null;state.typeFilter='';state.dayFilter='';state.openerFilter='';state.supplierFilter='';state.supplierQuickSearch='';refreshUi();updateStatus();toast('Cópias locais apagadas; Firebase preservado.');}catch(e){fail(e);}};
  $('#reportsButton').onclick=()=>{state.showCharts=!state.showCharts;$('#reportsButton').textContent=state.showCharts?'Ocultar relatório':'Mostrar relatório';render();};
  $('#closeReports').onclick=()=>{state.showCharts=false;$('#reportsButton').textContent='Mostrar relatório';render();};
  $('#clearBuyer').onclick=()=>{$('#buyerFilter').value='todos';state.page=0;render();};
  $('#clearReportFilters').onclick=clearAllReportFilters;
  $('#prevPage').onclick=()=>{state.page=Math.max(0,state.page-1);render();};
  $('#nextPage').onclick=()=>{state.page++;render();};
  $('#noteRows').addEventListener('click',e=>{const key=e.target.closest('[data-note]')?.dataset.note;if(key)showTimeline(key);});
  $('#reportContent').addEventListener('input',e=>{
    if(e.target.id==='supplierQuickSearch'){state.supplierQuickSearch=e.target.value;updateSupplierTopList();}
  });
  $('#reportContent').addEventListener('click',e=>{
    if(e.target.closest('[data-open-suppliers]')){openSupplierModal();return;}
    if(e.target.closest('[data-clear-supplier]')){state.supplierFilter='';state.page=0;render();return;}
    const btn=e.target.closest('button[data-chart]');
    if(!btn)return;
    toggleChartFilter(btn.dataset.chart,btn.dataset.value);
  });
  $('#detailContent').addEventListener('click', e => {
    const button = e.target.closest('[data-manual-div]');
    if (button) manualResponder?.open(button.dataset.manualDiv);
    const correction=e.target.closest('[data-buyer-correction]');
    if (correction) buyerCorrection?.open(correction.dataset.buyerCorrection);
  });
  $('#closeSupplierModal').onclick=closeSupplierModal;
  $('#supplierModalSearch').addEventListener('input',e=>{state.supplierQuery=e.target.value;state.supplierPage=0;state.supplierDetailKey='';renderSupplierModal();});
  $('#supplierModalSort').addEventListener('change',e=>{state.supplierSort=e.target.value;state.supplierPage=0;renderSupplierModal();});
  $('#supplierPrev').onclick=()=>{state.supplierPage=Math.max(0,state.supplierPage-1);renderSupplierModal();};
  $('#supplierNext').onclick=()=>{state.supplierPage++;renderSupplierModal();};
  $('#supplierOverlay').addEventListener('click',e=>{
    const apply=e.target.closest('[data-supplier-apply]');
    if(apply){state.supplierFilter=apply.dataset.supplierApply;closeSupplierModal();state.page=0;render();return;}
    const details=e.target.closest('[data-supplier-details]');
    if(details){state.supplierDetailKey=state.supplierDetailKey===details.dataset.supplierDetails?'':details.dataset.supplierDetails;renderSupplierDetails();if(state.supplierDetailKey)$('#supplierDetail').scrollIntoView({block:'nearest',behavior:'smooth'});return;}
    const note=e.target.closest('[data-supplier-note]');
    if(note){const key=note.dataset.supplierNote;closeSupplierModal();showTimeline(key);}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#supplierOverlay').classList.contains('hidden')){e.preventDefault();closeSupplierModal();}});
  $('#closeDetail').onclick=closeTimeline;
  $('#detailOverlay').addEventListener('click',e=>{if(e.target===$('#detailOverlay'))closeTimeline();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#detailOverlay').classList.contains('hidden'))closeTimeline();});
}
buyerCorrection = setupBuyerCorrection({
  getSnapshot: () => state.snapshot,
  getProfile: () => state.profile,
  onSaved: applyBuyerCorrection,
  toast
});
manualResponder = setupManualResponse({
  getSnapshot: () => state.snapshot,
  getProfile: () => state.profile,
  onSaved: applyManualResult,
  toast
});
$('#reportStart').value=dateToday(-7);$('#reportEnd').value=dateToday();wire();
initAuthUI({onError:fail,onUser:async(u,p)=>{
  state.user=u;state.profile=p;state.uid=p&&u?u.uid:'';state.snapshot=null;state.page=0;state.typeFilter='';state.dayFilter='';state.openerFilter='';state.supplierFilter='';state.supplierQuickSearch='';
  if(!state.uid){render();updateStatus();return;}
  $('#userLine').textContent=`${p.nome||u.email} • ${p.papel} • Painel V2.5.9 offline`;
  $('#adminLink').classList.toggle('hidden',!isAdmin(p));
  await restoreSaved();
  const deepLink=new URLSearchParams(location.search).get('nf');
  if(deepLink&&/^\d{44}$/.test(deepLink)&&state.snapshot?.divs.some(d=>d.chave===deepLink))showTimeline(deepLink);
}});
