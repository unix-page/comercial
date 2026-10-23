// ==UserScript==
// @name         Comercial • Infradesk • Divergências V2
// @namespace    comercial/infradesk
// @version      2.0.1
// @description  Registra divergências e movimentações por chave NF-e, integrado ao Comercial V2.
// @match        https://*.infradesk.app/backend/chamados/painel*
// @match        https://*.infradesk.app/backend/chamados*
// @run-at       document-end
// @icon         https://unix-page.github.io/comercial/comercial.png
// @grant        none
// ==/UserScript==
(function(){'use strict';
if(window.__COMERCIAL_APP_RUNNING__)return;
if(typeof firebase==='undefined'||!firebase.auth||!firebase.firestore){console.error('[Comercial V2] Firebase compat indisponível. Instale o loader oficial.');return;}
window.__COMERCIAL_APP_RUNNING__=true;window.__COMERCIAL_APP_VERSION__='2.0.1';
const URL_ICON='https://unix-page.github.io/comercial/comercial.png';
const firebaseConfig={apiKey:'AIzaSyBpWLYK1cejNpUAo5NMk8ecSSQrYMVf6-0',authDomain:'comercial-divergencias.firebaseapp.com',projectId:'comercial-divergencias',storageBucket:'comercial-divergencias.firebasestorage.app',messagingSenderId:'602637992147',appId:'1:602637992147:web:fc930856cc72f598a31426'};
const appName='comercial-divergencias-app';let app;try{app=firebase.app(appName);}catch(_){app=firebase.initializeApp(firebaseConfig,appName);}const auth=app.auth(),db=app.firestore(),F=firebase.firestore.FieldValue;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const dig=s=>String(s||'').replace(/\D/g,'');const clean=s=>String(s||'').replace(/\s+/g,' ').trim();const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sectors={fiscal:'Fiscal (Sicofe)',comercial:'Comercial',cadastro:'Cadastro'};
const state={user:null,profile:null,card:null,data:null,notes:[],buyers:[],suppliers:new Map(),types:[],loadedAt:0,selected:null,busy:false};
function parseKey(v){const s=dig(v);if(s.length!==44)return null;let sum=0,p=2;for(let i=42;i>=0;i--){sum+=Number(s[i])*p;p=p===9?2:p+1;}const r=sum%11,dv=r<2?0:11-r;if(Number(s[43])!==dv)return null;return{chave:s,cnpj:s.slice(6,20),numeroNf:String(parseInt(s.slice(25,34),10)),modelo:s.slice(20,22),serie:s.slice(22,25)};}
function extract(card){const text=card.innerText||card.textContent||'';const matched=text.match(/\b\d{44}\b/)||text.match(/(?:\d[\s.-]*){44}/);const key=parseKey(matched?.[0]);const link=$('.item-data-fornecedor',card);const fornecedorId=link?.getAttribute('href')?.match(/\/fornecedores\/contato\/(\d+)/i)?.[1]||'';const fornecedorNome=clean(link?.textContent||'Fornecedor não identificado').replace(/^#?\d+\s+/,'');return {...(key||{}),chamadoInfradeskId:card.getAttribute('data-chamado-id')||'',fornecedorId,fornecedorNome,empresa:clean($('.item-data-empresa',card)?.textContent||''),tipoNota:clean($('.item-subcategoria',card)?.getAttribute('title')||$('.item-subcategoria',card)?.textContent||''),descricaoInfradesk:clean($('.item-ultima-descricao-copy',card)?.textContent||'')};}
function notify(msg,bad=false){let el=$('#comercial-v2-toast');if(!el){el=document.createElement('div');el.id='comercial-v2-toast';document.body.appendChild(el);}el.textContent=msg;el.style.cssText=`position:fixed;z-index:2147483647;top:20px;right:20px;max-width:430px;background:${bad?'#a92020':'#146e57'};color:white;padding:12px 16px;border-radius:12px;font:13px system-ui;box-shadow:0 12px 30px #0002`;clearTimeout(notify.t);notify.t=setTimeout(()=>el.remove(),6500);}
function ensureUI(){if($('#comercial-v2-modal'))return;const style=document.createElement('style');style.textContent=`.comercial-v2-button{display:inline-flex!important;align-items:center!important;justify-content:center!important;background:#ffe9f3!important;border:1px solid #f1a3c9!important;border-radius:6px!important;width:27px!important;height:27px!important;padding:2px!important;margin-left:4px!important;cursor:pointer!important}.comercial-v2-button img{width:21px;height:21px;object-fit:contain}.comercial-v2-overlay{position:fixed;inset:0;background:#0f172a99;z-index:2147483644;display:none;align-items:center;justify-content:center;padding:14px;font:13px system-ui;color:#172033}.comercial-v2-overlay.open{display:flex}.comercial-v2-modal{background:white;width:min(650px,100%);max-height:94vh;overflow:auto;border-radius:16px;box-shadow:0 20px 60px #0005}.comercial-v2-head{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid #e7eaf1}.comercial-v2-head img{width:35px;height:35px;border-radius:8px}.comercial-v2-head strong{font-size:16px}.comercial-v2-head small{display:block;color:#627085}.comercial-v2-head button{margin-left:auto}.comercial-v2-body{padding:16px;display:grid;gap:12px}.comercial-v2-body label{font-weight:650;display:grid;gap:4px}.comercial-v2-body input,.comercial-v2-body select,.comercial-v2-body textarea{display:block;width:100%;border:1px solid #d7e0eb;background:#fff;color:#172033;padding:9px 10px;border-radius:9px;font:inherit;box-sizing:border-box}.comercial-v2-info{padding:10px;background:#fff3f8;border:1px solid #fbcde1;border-radius:9px;color:#7b284d;overflow-wrap:anywhere}.comercial-v2-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.comercial-v2-btn{border-radius:9px;border:1px solid #d6ddeb;background:#fff;color:#172033;padding:9px 12px;font-weight:700;cursor:pointer}.comercial-v2-btn.primary{background:#df2578;border-color:#df2578;color:#fff}.comercial-v2-actions{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #e6eaf1;padding:12px 16px;flex-wrap:wrap}.comercial-v2-help{color:#657186;font-size:11px}.comercial-v2-login{border:1px solid #e3e8ef;padding:12px;border-radius:10px;display:grid;gap:8px}.comercial-v2-login-actions{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:550px){.comercial-v2-row{grid-template-columns:1fr}}`;document.head.appendChild(style);
const overlay=document.createElement('div');overlay.id='comercial-v2-modal';overlay.className='comercial-v2-overlay';overlay.innerHTML=`<div class="comercial-v2-modal" role="dialog" aria-modal="true" aria-label="Comercial V2"><div class="comercial-v2-head"><img src="${URL_ICON}" alt=""><div><strong>Registrar divergência</strong><small>Comercial V2 • Histórico único por NF-e</small></div><button class="comercial-v2-btn" id="comercial-v2-close">✕</button></div><div class="comercial-v2-body"><div class="comercial-v2-info" id="cv-info"></div><div id="cv-auth" class="comercial-v2-login"><span id="cv-auth-info">Entre com sua conta Comercial</span><div class="comercial-v2-row"><input id="cv-email" type="email" placeholder="E-mail"><input id="cv-password" type="password" placeholder="Senha"></div><div class="comercial-v2-login-actions"><button class="comercial-v2-btn" id="cv-login-email">Entrar por e-mail</button><button class="comercial-v2-btn" id="cv-login-google">Entrar com Google</button></div></div><div id="cv-form" style="display:none;gap:10px"><label>Divergência nesta nota<select id="cv-divergence"><option value="">Nova divergência</option></select></label><div class="comercial-v2-row"><label>Setor responsável<select id="cv-sector"><option value="">Escolha</option><option value="fiscal">Fiscal (Sicofe)</option><option value="comercial">Comercial</option><option value="cadastro">Cadastro</option></select></label><label>Tipo de divergência<select id="cv-type"><option value="">Selecione o setor</option></select></label></div><label id="cv-buyer-wrap">Comprador responsável<select id="cv-buyer"><option value="">Escolha</option></select></label><label>Ação<select id="cv-action"><option value="abrir">Abrir divergência</option></select></label><label>Observação / resultado<textarea id="cv-description" rows="3" placeholder="Ex.: Enviado ao comprador via WhatsApp. / XML baixado. / Pedido corrigido."></textarea></label><div class="comercial-v2-help">As ações são registradas pela CRF. Cada encaminhamento cria uma passagem; retorno/conclusão fecha a passagem e preserva o tempo real entre timestamps do Firestore.</div></div></div><div class="comercial-v2-actions"><button class="comercial-v2-btn" id="cv-cancel">Cancelar</button><button class="comercial-v2-btn primary" id="cv-save">Salvar evento</button></div></div>`;document.body.appendChild(overlay);
$('#comercial-v2-close').onclick=close;$('#cv-cancel').onclick=close;
$('#cv-login-google').onclick=async()=>{
  const button=$('#cv-login-google');
  if(button.disabled)return;
  button.disabled=true;
  const initialLabel=button.textContent;
  button.textContent='Abrindo Google...';
  try{
    // A abertura do popup acontece diretamente no clique, sem await prévio.
    await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    await refreshProfile();
    await loadIntoForm();
    if(!state.profile)notify('Google autenticou, mas sua conta não possui perfil na coleção usuarios. Solicite acesso.',true);
    else if(state.profile.ativo===false)notify('Google autenticou, mas seu perfil está inativo.',true);
    else if(!canRecord())notify('Google autenticou, mas seu perfil não permite registrar eventos no Infradesk.',true);
  }catch(e){
    const code=e?.code||'erro-desconhecido';
    const map={
      'auth/unauthorized-domain':'Este domínio do Infradesk não está autorizado no Firebase Authentication: '+location.hostname+'. O administrador deve adicioná-lo em Authentication > Settings > Authorized domains.',
      'auth/popup-blocked':'O navegador bloqueou a janela do Google. Permita pop-ups para '+location.hostname+' e tente novamente.',
      'auth/popup-closed-by-user':'A janela do Google foi fechada antes de concluir o login. Tente novamente.',
      'auth/cancelled-popup-request':'Outra tentativa de login interrompeu esta. Aguarde e tente novamente.',
      'auth/operation-not-allowed':'Login Google não está habilitado no Firebase Authentication deste projeto.',
      'auth/network-request-failed':'Falha na rede ou bloqueio por extensão/proxy. Confira a conexão e tente novamente.',
      'auth/web-storage-unsupported':'O navegador está bloqueando o armazenamento necessário para a sessão. Verifique permissões, modo anônimo ou políticas corporativas.',
      'auth/internal-error':'Falha interna do login Google; verifique o Console e as políticas de pop-up/cookies do navegador.'
    };
    console.error('[Comercial V2] Falha no login Google:',code,e);
    notify(map[code]||('Google: '+(e?.message||code)),true);
  }finally{
    button.disabled=false;
    button.textContent=initialLabel;
  }
};
$('#cv-login-email').onclick=async()=>{try{await auth.signInWithEmailAndPassword($('#cv-email').value.trim(),$('#cv-password').value);await refreshProfile();await loadIntoForm();}catch(e){notify(e.message||'Login incorreto',true);}};
$('#cv-divergence').onchange=renderSelection;$('#cv-sector').onchange=renderSector;$('#cv-action').onchange=renderAction;$('#cv-save').onclick=save;
}
function close(){if(state.busy)return;$('#comercial-v2-modal')?.classList.remove('open');state.card=null;state.data=null;state.selected=null;}
function canRecord(){return !!(state.user&&state.profile&&state.profile.ativo!==false&&['admin','usuario','crf'].includes(state.profile.papel));}
async function refreshProfile(){state.user=auth.currentUser;state.profile=null;if(!state.user)return;const snap=await db.collection('usuarios').doc(state.user.uid).get();state.profile=snap.exists?{id:snap.id,...snap.data()}:null;}
async function lookupData(){const key=state.data.chave;if(!key)return;const now=Date.now();if(now-state.loadedAt>5*60*1000){const[b,t]=await Promise.all([db.collection('compradores_v2').get(),db.collection('tipos_divergencia_v2').get()]);state.buyers=b.docs.map(d=>({id:d.id,...d.data()}));state.types=t.docs.map(d=>({id:d.id,...d.data()}));state.loadedAt=now;}
const [noteSnap,supplierSnap,divSnap]=await Promise.all([db.collection('notas_v2').doc(key).get(),db.collection('fornecedores_v2').doc(state.data.cnpj).get(),db.collection('divergencias_v2').where('chave','==',key).limit(40).get()]);state.supplier=supplierSnap.exists?supplierSnap.data():null;state.note=noteSnap.exists?noteSnap.data():null;state.notes=divSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.criadoEm?.toMillis?.()||0)-(a.criadoEm?.toMillis?.()||0));}
async function openCard(card){ensureUI();const data=extract(card);if(!data.chave){notify('A chave da NF-e está ausente ou inválida (44 dígitos / dígito verificador).',true);return;}state.card=card;state.data=data;$('#cv-info').innerHTML=`<strong>Chamado:</strong> ${esc(data.chamadoInfradeskId||'—')} • <strong>NF:</strong> ${esc(data.numeroNf)} • <strong>CNPJ:</strong> ${esc(data.cnpj)}<br><strong>Fornecedor:</strong> ${esc(data.fornecedorNome)}<br><strong>Chave:</strong> ${esc(data.chave)}`;$('#cv-description').value='';$('#comercial-v2-modal').classList.add('open');try{await refreshProfile();await loadIntoForm();}catch(e){notify(e.message||'Falha ao abrir',true);}}
async function loadIntoForm(){const logged=canRecord();$('#cv-auth').style.display=logged?'none':'grid';$('#cv-form').style.display=logged?'grid':'none';$('#cv-save').disabled=!logged;$('#cv-auth-info').textContent=state.user?(!state.profile?'Perfil ausente em usuarios':state.profile.ativo===false?'Conta inativa':'Seu perfil não permite registrar divergências'):'Entre com sua conta Comercial';if(!logged)return;
await lookupData();const sel=$('#cv-divergence');sel.replaceChildren(new Option('Nova divergência',''));for(const d of state.notes)sel.add(new Option(`${d.tipoNome||'Divergência'} • ${d.status||'—'} • ${d.compradorNome||sectors[d.setor]||''}`,d.id));sel.value='';renderSelection();}
function renderSelection(){state.selected=state.notes.find(d=>d.id===$('#cv-divergence').value)||null;const d=state.selected;$('#cv-sector').value=d?.setor||'';renderSector();if(d){$('#cv-type').value=d.tipoId||'';$('#cv-buyer').value=d.compradorId||'';}const action=$('#cv-action');const options=d ? (['concluida','devolucao'].includes(d.status)?[['reabrir','Reabrir / novo encaminhamento'],['observacao','Registrar observação']]:[['observacao','Registrar observação'],['encaminhar','Encaminhar / reenviar a setor'],['retorno','Registrar retorno à CRF'],['concluir','Concluir divergência'],['devolver','Registrar devolução / recusa']]):[['abrir','Abrir e encaminhar ao setor']];action.replaceChildren(...options.map(([v,t])=>new Option(t,v)));renderAction();}
function renderSector(){const setor=$('#cv-sector').value;const typ=$('#cv-type');const previous=typ.value;typ.replaceChildren(new Option('Selecione o tipo',''));state.types.filter(t=>t.ativo!==false&&t.setor===setor).sort((a,b)=>a.nome.localeCompare(b.nome)).forEach(t=>typ.add(new Option(t.nome,t.id)));if([...typ.options].some(o=>o.value===previous))typ.value=previous;$('#cv-buyer-wrap').style.display=setor==='comercial'?'grid':'none';const buyers=(state.supplier?.compradorIds||[]).map(id=>state.buyers.find(b=>b.id===id)).filter(b=>b&&b.ativo!==false);const bs=$('#cv-buyer');const prior=bs.value;bs.replaceChildren(new Option(buyers.length?'Selecione o comprador vinculado':'Nenhum comprador ativo vinculado',''));buyers.forEach(b=>bs.add(new Option(b.nome,b.id)));if(buyers.some(b=>b.id===prior))bs.value=prior;renderAction();}
function renderAction(){const action=$('#cv-action').value,d=state.selected;const needsSector=['abrir','encaminhar','reabrir'].includes(action);$('#cv-sector').disabled=!!d&&!needsSector;$('#cv-type').disabled=!!d;$('#cv-buyer').disabled=!!d&&!needsSector;
// Em encaminhamento a escolha do novo setor/comprador é livre, mas a classificação original permanece imutável.
if(d&&!needsSector){$('#cv-sector').value=d.setor;$('#cv-type').value=d.tipoId;renderBuyerFromRecord(d);}if(d&&needsSector&&$('#cv-sector').value!==d.setor){/* setor de destino alterável */}}
function renderBuyerFromRecord(d){const el=$('#cv-buyer');if([...el.options].some(o=>o.value===d.compradorId))el.value=d.compradorId;}
function fieldTimestamp(){return F.serverTimestamp();}
async function save(){if(state.busy||!canRecord())return;const action=$('#cv-action').value,d=state.selected,data=state.data;if(!data?.chave)return;let setor=$('#cv-sector').value,typeId=$('#cv-type').value,buyerId=$('#cv-buyer').value;const noteRef=db.collection('notas_v2').doc(data.chave),oldD=d||null;
if(action==='abrir'&&(!setor||!typeId))return notify('Escolha setor e tipo da divergência.',true);
if(['abrir','encaminhar','reabrir'].includes(action)&&!setor)return notify('Selecione o setor responsável.',true);
if(['abrir','encaminhar','reabrir'].includes(action)&&setor==='comercial'&&!buyerId)return notify('Selecione um comprador ativo vinculado ao CNPJ no portal administrativo.',true);
if(!oldD&&action!=='abrir')return;
const comment=clean($('#cv-description').value);if(!comment)return notify('Descreva a ocorrência ou resultado antes de salvar.',true);
const type=state.types.find(t=>t.id===typeId),buyer=state.buyers.find(b=>b.id===buyerId);
if(action==='abrir'&&(!type||type.setor!==setor||type.ativo===false))return notify('Tipo de divergência inválido.',true);
if(['abrir','encaminhar','reabrir'].includes(action)&&setor==='comercial'&&(!buyer||buyer.ativo===false||!(state.supplier?.compradorIds||[]).includes(buyerId)))return notify('Comprador não está ativo ou vinculado ao CNPJ.',true);
state.busy=true;$('#cv-save').disabled=true;$('#cv-save').textContent='Salvando...';try{
const newDivRef=oldD?db.collection('divergencias_v2').doc(oldD.id):db.collection('divergencias_v2').doc();const eventRef=db.collection('eventos_v2').doc();const passRef=db.collection('passagens_v2').doc();const buyerName=buyer?.nome||'';
await db.runTransaction(async tx=>{
// Todas as leituras precedem qualquer escrita.
const nSnap=await tx.get(noteRef);const divSnap=oldD?await tx.get(newDivRef):null;
if(oldD&&!divSnap.exists)throw new Error('Divergência não encontrada; atualize a tela.');const prior=divSnap?.data()||null;
if(oldD&&prior.status!==oldD.status)throw new Error('Outro operador modificou a divergência. Abra novamente antes de salvar.');
const prevPass=prior?.passagemAbertaId?db.collection('passagens_v2').doc(prior.passagemAbertaId):null;
const passSnap=prevPass?await tx.get(prevPass):null;
const supplierRef=db.collection('fornecedores_v2').doc(data.cnpj);const supplierSnap=await tx.get(supplierRef);
const now=fieldTimestamp();const operator=state.profile?.nome||state.user.displayName||state.user.email;
let nextStatus=prior?.status||'aberta';if(action==='retorno')nextStatus='em_crf';if(['abrir','encaminhar','reabrir'].includes(action))nextStatus='aberta';if(action==='concluir')nextStatus='concluida';if(action==='devolver')nextStatus='devolucao';
if(action==='reabrir'&&!['devolucao','concluida'].includes(prior?.status))throw new Error('Só é possível reabrir uma divergência encerrada.');
if(!supplierSnap.exists){tx.set(supplierRef,{cnpj:data.cnpj,razaoSocial:clean(data.fornecedorNome)||'Não identificado',nomeInfradesk:data.fornecedorNome,origemRazaoSocial:'infradesk',compradorIds:[],ativo:true,criadoEm:now,atualizadoEm:now});}
const noteFields={chave:data.chave,cnpj:data.cnpj,numeroNf:data.numeroNf,modelo:data.modelo,serie:data.serie,fornecedorNome:supplierSnap.exists?(supplierSnap.data().razaoSocial||data.fornecedorNome):data.fornecedorNome,nomeInfradesk:data.fornecedorNome,atualizadoEm:now,ultimaAcao:action,ultimaOcorrenciaTexto:comment,versao:2};
if(data.chamadoInfradeskId)noteFields.chamadosInfradeskIds=F.arrayUnion(data.chamadoInfradeskId);
if(!nSnap.exists)tx.set(noteRef,{...noteFields,criadoEm:now,divergenciasCount:action==='abrir'?1:0});else tx.update(noteRef,{...noteFields,...(action==='abrir'?{divergenciasCount:F.increment(1)}:{})});
if(!prior){tx.set(newDivRef,{chave:data.chave,cnpj:data.cnpj,numeroNf:data.numeroNf,fornecedorNome:noteFields.fornecedorNome,criadoEm:now,atualizadoEm:now,abertoPor:state.user.uid,abertoPorNome:operator,setor,tipoId,tipoNome:type.nome,compradorId:setor==='comercial'?buyerId:'',compradorNome:setor==='comercial'?buyerName:'',status:'aberta',passagemAbertaId:passRef.id,passagensCount:1,ultimaOcorrenciaTexto:comment,ultimaOcorrenciaEm:now});}
else{
const update={atualizadoEm:now,status:nextStatus,ultimaOcorrenciaTexto:comment,ultimaOcorrenciaEm:now};
if(['abrir','encaminhar','reabrir'].includes(action)){update.passagemAbertaId=passRef.id;update.passagensCount=F.increment(1);update.compradorId=setor==='comercial'?buyerId:'';update.compradorNome=setor==='comercial'?buyerName:'';}
if(['retorno','concluir','devolver'].includes(action))update.passagemAbertaId=null;
if(['concluir','devolver'].includes(action))update.resolvidoEm=now;
if(action==='reabrir')update.resolvidoEm=null;
tx.update(newDivRef,update);
}
if(prevPass&&passSnap?.exists&&['encaminhar','retorno','concluir','devolver'].includes(action)&&!passSnap.data().fimEm){tx.update(prevPass,{fimEm:now,fechadoPor:state.user.uid,fechamento:action});}
if(['abrir','encaminhar','reabrir'].includes(action))tx.set(passRef,{chave:data.chave,divergenciaId:newDivRef.id,setor,compradorId:setor==='comercial'?buyerId:'',compradorNome:setor==='comercial'?buyerName:'',inicioEm:now,fimEm:null,criadoPor:state.user.uid,criadoPorNome:operator,chamadoInfradeskId:data.chamadoInfradeskId||''});
tx.set(eventRef,{chave:data.chave,divergenciaId:newDivRef.id,acao:action,setor:needsSectorOf(action)?setor:prior?.setor||setor,compradorId:buyerId||prior?.compradorId||'',compradorNome:buyerName||prior?.compradorNome||'',texto:comment,chamadoInfradeskId:data.chamadoInfradeskId||'',usuarioId:state.user.uid,usuarioNome:operator,usuarioEmail:state.user.email,criadoEm:now});
});
notify('Evento registrado no histórico único da nota.');close();
}catch(e){console.error('[Comercial V2]',e);notify(e.code==='permission-denied'?'Permissão negada: publique firestore.rules e confira seu perfil.':(e.message||'Falha ao salvar.'),true);}finally{state.busy=false;$('#cv-save').disabled=!canRecord();$('#cv-save').textContent='Salvar evento';}}
function needsSectorOf(action){return ['abrir','encaminhar','reabrir'].includes(action);}
function addButton(card){if($('.comercial-v2-button',card))return;const data=extract(card);if(!data.chave)return;const toolbar=$('.toolbar-atendente',card)||$('.list-toolbar',card)||card;const btn=document.createElement('button');btn.type='button';btn.className='comercial-v2-button';btn.title='Registrar divergência/ocorrência no Comercial V2';btn.innerHTML=`<img src="${URL_ICON}" alt="Comercial">`;btn.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();openCard(card);});const x=$('.xabuia-card-btn',toolbar);if(x)x.insertAdjacentElement('afterend',btn);else toolbar.appendChild(btn);}
function scan(){$$('.chamado-item[data-chamado-id]').forEach(addButton);}
let debounce=0;const ob=new MutationObserver(()=>{clearTimeout(debounce);debounce=setTimeout(scan,300);});
auth.onAuthStateChanged(u=>{state.user=u;if(!u)state.profile=null;});
function boot(){ensureUI();scan();ob.observe(document.body,{childList:true,subtree:true});window.addEventListener('focus',scan);console.log('[Comercial V2] ativo. Use somente com loader oficial.');}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
