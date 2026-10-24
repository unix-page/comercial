// ==UserScript==
// @name         Comercial • Infradesk • Registro de divergências V2.3.1
// @namespace    comercial/infradesk
// @version      2.3.1
// @description  Uma NF por chave; divergências independentes; cada resposta encerra uma passagem. Sem consultas automáticas por card.
// @match        https://*.infradesk.app/backend/chamados*
// @run-at       document-end
// @noframes
// @icon         https://unix-page.github.io/comercial/comercial.png
// @homepageURL  https://unix-page.github.io/comercial/
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  if (window.__COMERCIAL_APP_RUNNING__) return;
  if (!window.firebase?.auth || !window.firebase?.firestore) {
    console.error('[Comercial V2.3.1] Firebase compat não encontrado. Confira o loader.');
    return;
  }
  window.__COMERCIAL_APP_RUNNING__ = true;
  window.__COMERCIAL_APP_VERSION__ = '2.3.1';

  const ICON = 'https://unix-page.github.io/comercial/comercial.png';
  const CONFIG = {
    apiKey: 'AIzaSyBpWLYK1cejNpUAo5NMk8ecSSQrYMVf6-0',
    authDomain: 'comercial-divergencias.firebaseapp.com',
    projectId: 'comercial-divergencias',
    storageBucket: 'comercial-divergencias.firebasestorage.app',
    messagingSenderId: '602637992147',
    appId: '1:602637992147:web:fc930856cc72f598a31426'
  };
  let app;
  try { app = firebase.app('comercial-divergencias-app'); }
  catch (_) { app = firebase.initializeApp(CONFIG, 'comercial-divergencias-app'); }
  const auth = app.auth();
  const db = app.firestore();
  const FV = firebase.firestore.FieldValue;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const onlyDigits = s => String(s ?? '').replace(/\D/g, '');
  const trim = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const sectors = { fiscal:'Fiscal (Sicofe)', comercial:'Comercial', cadastro:'Cadastro' };
  const TTL = 15 * 60 * 1000;
  const state = {
    user: null, profile: null, profileAt: 0,
    catalog: { types: [], responses: [], expiresAt: 0 },
    buyers: new Map(),
    card: null, data: null, supplier: null,
    divergences: [], selected: null, busy: false,
    viewToken: 0, mode: 'abrir', autoDetails: ''
  };

  function parseKey(v) {
    const s = onlyDigits(v);
    if (s.length !== 44 || /^(\d)\1{43}$/.test(s)) return null;
    let sum = 0, mult = 2;
    for (let i = 42; i >= 0; i--) { sum += Number(s[i]) * mult; mult = mult === 9 ? 2 : mult + 1; }
    const rem = sum % 11;
    if (Number(s[43]) !== (rem < 2 ? 0 : 11 - rem)) return null;
    return { chave: s, cnpj: s.slice(6,20), numeroNf: String(Number(s.slice(25,34))), serie: s.slice(22,25) };
  }
  function extract(card) {
    const text = card.innerText || card.textContent || '';
    const match = text.match(/\b\d{44}\b/) || text.match(/(?:\d[\s.\-]*){44}/);
    const parsed = parseKey(match?.[0]);
    if (!parsed) return null;
    const supplierLink = $('.item-data-fornecedor', card);
    const fornecedorNome = trim(supplierLink?.textContent || 'Fornecedor não identificado').replace(/^#?\d+\s+/, '');
    return {
      ...parsed,
      chamadoInfradeskId: card.getAttribute('data-chamado-id') || '',
      fornecedorNome,
      fornecedorId: supplierLink?.getAttribute('href')?.match(/\/fornecedores\/contato\/(\d+)/i)?.[1] || '',
      empresa: trim($('.item-data-empresa',card)?.textContent || ''),
      descricaoInfradesk: trim($('.item-ultima-descricao-copy',card)?.textContent || '')
    };
  }
  function timeString(ts) {
    if (!ts) return '—';
    const dt = ts.toDate?.() || new Date(ts);
    return isNaN(dt.getTime()) ? '—' : dt.toLocaleString('pt-BR');
  }
  function alertUser(text, isError = false) {
    let el = $('#cv-toast');
    if (!el) { el = document.createElement('div'); el.id = 'cv-toast'; document.body.append(el); }
    el.textContent = text;
    el.style.cssText = 'position:fixed;right:18px;top:18px;max-width:470px;z-index:2147483647;color:white;background:' + (isError ? '#a32236' : '#177554') + ';padding:12px 16px;border-radius:10px;font:13px system-ui;box-shadow:0 12px 30px #0003';
    clearTimeout(alertUser.timer);
    alertUser.timer = setTimeout(() => el.remove(), 6500);
  }
  function erroCrf(response) {
    // Compatibilidade com as 11 respostas existentes. No futuro o admin pode salvar erroCrf=true.
    const ascii = trim(response?.nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return response?.erroCrf === true || ascii.startsWith('informacoes divergentes');
  }
  function canRecord() {
    return !!(state.user && state.profile && state.profile.ativo !== false && ['admin','crf','usuario'].includes(state.profile.papel));
  }
  async function loadProfile(force=false) {
    const user = auth.currentUser;
    if (!user) { state.user = null; state.profile = null; return; }
    if (!force && state.user?.uid === user.uid && state.profileAt && Date.now() - state.profileAt < 5 * 60 * 1000) return;
    const snap = await db.collection('usuarios').doc(user.uid).get();
    state.user = user;
    state.profile = snap.exists ? snap.data() : null;
    state.profileAt = Date.now();
  }
  async function loadCatalog(force=false) {
    if (!force && Date.now() < state.catalog.expiresAt) return;
    // Apenas ao abrir uma NF, sem listener. Listas curtas e compartilhadas por 15 minutos.
    const [typeDocs, responseDocs] = await Promise.all([
      db.collection('tipos_divergencia_v2').get(),
      db.collection('respostas_v2').get()
    ]);
    state.catalog = {
      types: typeDocs.docs.map(s => ({ id:s.id, ...s.data() })),
      responses: responseDocs.docs.map(s => ({ id:s.id, ...s.data() })),
      expiresAt: Date.now() + TTL
    };
  }
  async function buyerRecord(id) {
    if (!id) return null;
    const cached = state.buyers.get(id);
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    const snap = await db.collection('compradores_v2').doc(id).get();
    const result = snap.exists ? { id:snap.id, ...snap.data() } : null;
    state.buyers.set(id, { value:result, expiresAt: Date.now() + TTL });
    return result;
  }
  async function loadNote() {
    if (!state.data) return;
    // Exatamente uma consulta por chave, uma leitura do fornecedor e somente compradores vinculados.
    const [supplierSnap, divDocs] = await Promise.all([
      db.collection('fornecedores_v2').doc(state.data.cnpj).get(),
      db.collection('divergencias_v2').where('chave','==',state.data.chave).limit(40).get()
    ]);
    state.supplier = supplierSnap.exists ? supplierSnap.data() : null;
    state.divergences = divDocs.docs.map(s=>({ id:s.id, ...s.data() }))
      .sort((a,b)=>(b.criadoEm?.toMillis?.()||0)-(a.criadoEm?.toMillis?.()||0));
    const ids = [...new Set((state.supplier?.compradorIds || []).filter(Boolean))];
    await Promise.all(ids.map(id => buyerRecord(id)));
  }
  function activeBuyers() {
    return (state.supplier?.compradorIds || [])
      .map(id => state.buyers.get(id)?.value)
      .filter(b => b && b.ativo !== false)
      .sort((a,b)=>trim(a.nome).localeCompare(trim(b.nome),'pt-BR'));
  }
  function createUI() {
    if ($('#comercial-v2-modal')) return;
    const style = document.createElement('style');
    style.id = 'comercial-v2-css';
    style.textContent = `
      .comercial-v2-button{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:27px!important;height:27px!important;margin-left:4px!important;padding:2px!important;border-radius:6px!important;border:1px solid #ec9dc7!important;background:#ffe9f3!important;cursor:pointer!important}
      .comercial-v2-button img{width:21px;height:21px;object-fit:contain}
      .cv-backdrop{display:none;position:fixed;inset:0;z-index:2147483644;background:#111827a6;align-items:center;justify-content:center;padding:12px;font:13px system-ui,Arial;color:#18243a}
      .cv-backdrop.open{display:flex}.cv-window{background:#fff;width:min(710px,100%);max-height:94vh;overflow:auto;border-radius:15px;box-shadow:0 22px 70px #0006}
      .cv-header{display:flex;align-items:center;gap:10px;padding:14px 17px;border-bottom:1px solid #e6eaf1}.cv-header img{width:32px;height:32px;border-radius:7px}.cv-header strong{font-size:16px}.cv-header small{display:block;color:#6b7280}.cv-header button{margin-left:auto}
      .cv-content{display:grid;gap:12px;padding:15px 17px}.cv-info{background:#fff2f7;border:1px solid #ffcfe3;padding:10px 12px;border-radius:10px;line-height:1.6;overflow-wrap:anywhere}
      .cv-content label{display:grid;gap:5px;font-size:12px;font-weight:700}.cv-content select,.cv-content input,.cv-content textarea{box-sizing:border-box;width:100%;padding:9px 10px;color:#162238;background:white;border:1px solid #d4dce9;border-radius:8px;font:13px system-ui}
      .cv-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cv-card{padding:10px 12px;border:1px solid #e6eaf1;border-radius:9px;background:#f8fafc;line-height:1.55}
      .cv-hint{font-size:11px;color:#65758b;line-height:1.5}.cv-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e6eaf1;flex-wrap:wrap}.cv-button{padding:9px 12px;border:1px solid #d6deea;background:white;color:#1a2941;border-radius:8px;font:700 12px system-ui;cursor:pointer}.cv-button:disabled{opacity:.55;cursor:not-allowed}.cv-button.primary{background:#d91e74;border-color:#d91e74;color:#fff}.cv-login{display:grid;gap:10px;padding:12px;border:1px solid #dce4ee;border-radius:10px}
      .cv-session{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;background:#f3f7fc;border:1px solid #dbe3ee;border-radius:9px;font-size:12px;flex-wrap:wrap}.cv-session b{color:#14213d}.cv-session small{color:#5c6a7c}.cv-description{font-size:11px;color:#66768c;font-weight:400}.cv-pill{display:inline-flex;padding:3px 8px;border-radius:30px;background:#fff0f6;color:#a51d62;font-size:11px;font-weight:700}.cv-hidden{display:none!important}@media(max-width:620px){.cv-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
    const modal = document.createElement('div');
    modal.id = 'comercial-v2-modal'; modal.className = 'cv-backdrop';
    modal.innerHTML = `<div class="cv-window" role="dialog" aria-modal="true" aria-label="Comercial V2">
      <div class="cv-header"><img src="${ICON}" alt=""><div><strong>Comercial — Ocorrências</strong><small>V2.3.1 • Divergências e respostas por setor</small></div><button class="cv-button" id="cv-close" type="button">✕</button></div>
      <div class="cv-content">
        <div class="cv-info" id="cv-info"></div>
        <div class="cv-session"><div id="cv-session-text">Verificando login do Comercial...</div><button type="button" class="cv-button cv-hidden" id="cv-logout">Sair / trocar conta</button></div>
        <div id="cv-login" class="cv-login cv-hidden"><strong id="cv-login-status">Entre no Comercial</strong><div class="cv-grid"><input id="cv-email" type="email" placeholder="E-mail"><input id="cv-pass" type="password" placeholder="Senha"></div><div><button class="cv-button" id="cv-email-login" type="button">Entrar com e-mail</button> <button class="cv-button" id="cv-google-login" type="button">Entrar com Google</button></div></div>
        <div id="cv-form" class="cv-hidden" style="display:grid;gap:12px">
          <label>Qual divergência você quer movimentar?<select id="cv-div"><option value="">+ Nova divergência</option></select></label>
          <div id="cv-current" class="cv-card cv-hidden"></div>
          <label>Próxima ação<select id="cv-action"></select></label>
          <div class="cv-grid" id="cv-target"><label>Setor para encaminhamento<select id="cv-sector"><option value="">Selecione</option><option value="comercial">Comercial</option><option value="fiscal">Fiscal (Sicofe)</option><option value="cadastro">Cadastro</option></select></label><label id="cv-type-wrap">Tipo de divergência<select id="cv-type"><option value="">Selecione</option></select></label></div>
          <label id="cv-buyer-wrap">Comprador responsável<select id="cv-buyer"><option value="">Selecione</option></select></label>
          <label id="cv-response-wrap" class="cv-hidden">Resposta recebida do setor<select id="cv-response"><option value="">Selecione uma resposta</option></select></label>
          <label><span id="cv-details-title">Observação / detalhes (opcional)</span><textarea id="cv-text" rows="3" placeholder="Observação adicional, se necessário..."></textarea><span id="cv-description-preview" class="cv-description"></span></label>
          <p class="cv-hint" id="cv-hint">Registrar no Comercial não altera o chamado original do Infradesk.</p>
        </div>
      </div>
      <div class="cv-buttons"><button type="button" class="cv-button" id="cv-refresh">Atualizar dados desta nota</button><button type="button" class="cv-button" id="cv-cancel">Cancelar</button><button type="button" class="cv-button primary" id="cv-save">Salvar ocorrência</button></div>
    </div>`;
    document.body.appendChild(modal);
    $('#cv-close').onclick = close;
    $('#cv-cancel').onclick = close;
    $('#cv-div').onchange = renderSelected;
    $('#cv-action').onchange = renderMode;
    $('#cv-sector').onchange = () => { renderTypes(); renderBuyers(); };
    $('#cv-type').onchange = fillTypeDescription;
    $('#cv-response').onchange = renderResponseDetailRequirement;
    $('#cv-google-login').onclick = async () => {
      const b = $('#cv-google-login'); b.disabled = true;
      try {
        // Precisa ser chamado imediatamente no clique, antes de outras operações assíncronas.
        await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        await loadProfile(true); await loadForm();
      } catch(e) { console.error('[Comercial] Google:',e); alertUser(googleError(e),true); }
      finally { b.disabled = false; }
    };
    $('#cv-email-login').onclick = async () => {
      try { await auth.signInWithEmailAndPassword($('#cv-email').value.trim(),$('#cv-pass').value); await loadProfile(true); await loadForm(); }
      catch(e) { alertUser(e?.message||'Erro no login.',true); }
    };
    $('#cv-refresh').onclick = async () => {
      if (!state.data || state.busy) return;
      $('#cv-refresh').disabled = true;
      try { await loadProfile(true); state.catalog.expiresAt = 0; state.buyers.clear(); await loadForm(); alertUser('Cadastros e divergências atualizados.'); }
      catch(e) { alertUser(e.message || 'Não foi possível atualizar.',true); }
      finally { $('#cv-refresh').disabled = false; }
    };
    $('#cv-save').onclick = save;
    $('#cv-logout').onclick = async () => {
      if (state.busy) return;
      const button = $('#cv-logout');
      button.disabled = true;
      try {
        await auth.signOut();
        state.user = null; state.profile = null; state.profileAt = 0;
        state.catalog.expiresAt = 0; state.buyers.clear();
        await loadForm();
        alertUser('Sessão do Comercial encerrada. Escolha como entrar.');
      } catch (e) { alertUser('Não consegui sair: ' + (e.message || 'erro desconhecido'), true); }
      finally { button.disabled = false; }
    };
  }
  function googleError(e) {
    const messages={
      'auth/popup-blocked':'Popup bloqueado. Autorize janelas para o Infradesk.',
      'auth/unauthorized-domain':'Domínio não autorizado no Firebase Authentication: '+location.hostname,
      'auth/popup-closed-by-user':'Janela de login fechada antes de concluir.',
      'auth/network-request-failed':'Falha de rede ou bloqueio de conexão.',
      'auth/operation-not-allowed':'Login Google desabilitado no projeto Firebase.'
    };
    return messages[e?.code] || e?.message || 'Não foi possível entrar com Google.';
  }
  function close(force = false) {
    if (state.busy && force !== true) return;
    $('#comercial-v2-modal')?.classList.remove('open');
    state.card = null; state.data = null; state.selected = null; state.viewToken++;
  }
  async function openCard(card) {
    const data = extract(card);
    if (!data) { alertUser('Chave de NF-e ausente ou inválida. Confira os 44 dígitos.',true); return; }
    const token = ++state.viewToken;
    state.card = card; state.data = data; state.selected = null; state.autoDetails = '';
    $('#cv-info').innerHTML = `<b>Chamado:</b> ${escape(data.chamadoInfradeskId||'—')} • <b>NF:</b> ${escape(data.numeroNf)} • <b>CNPJ:</b> ${escape(data.cnpj)}<br><b>Fornecedor no Infradesk:</b> ${escape(data.fornecedorNome)}<br><b>Chave:</b> ${escape(data.chave)}`;
    $('#cv-text').value = '';
    $('#comercial-v2-modal').classList.add('open');
    $('#cv-form').classList.add('cv-hidden');
    $('#cv-save').disabled = true;
    renderSession();
    try {
      await loadProfile();
      if (token !== state.viewToken) return;
      await loadForm();
    } catch(e) { console.error('[Comercial V2.3.1] Abrir:',e); alertUser(e.message||'Não foi possível carregar a nota.',true); }
  }
  function renderSession() {
    const user = state.user || auth.currentUser;
    const profile = state.profile;
    const line = $('#cv-session-text');
    if (!line) return;
    const logout = $('#cv-logout');
    logout?.classList.toggle('cv-hidden', !user);
    if (!user) {
      line.textContent = 'Você ainda não entrou no Comercial. Use Google ou e-mail/senha abaixo.';
      return;
    }
    const nome = trim(profile?.nome || user.displayName || user.email || 'Usuário');
    const email = trim(user.email || '');
    const papel = trim(profile?.papel || 'sem perfil');
    line.replaceChildren();
    const strong = document.createElement('b');
    strong.textContent = 'Conectado como: ' + nome;
    const small = document.createElement('small');
    small.textContent = ' • ' + email + ' • Perfil: ' + papel;
    line.append(strong, small);
  }
  async function loadForm() {
    const allowed = canRecord();
    renderSession();
    $('#cv-login').classList.toggle('cv-hidden',allowed);
    $('#cv-form').classList.toggle('cv-hidden',!allowed);
    $('#cv-save').disabled = !allowed;
    $('#cv-login-status').textContent = !state.user ? 'Entre no Comercial' : !state.profile ? 'Conta conectada sem perfil em usuarios. Use Sair / trocar conta para escolher outra.' : state.profile.ativo === false ? 'Conta inativa' : 'Este perfil não pode registrar eventos';
    if (!allowed) return;
    await Promise.all([loadCatalog(),loadNote()]);
    const dropdown=$('#cv-div');
    dropdown.replaceChildren(new Option('+ Abrir nova divergência',''));
    for (const d of state.divergences) {
      const label = `${d.tipoNome||'Divergência'} • ${d.status||'—'} • ${d.compradorNome||sectors[d.setor]||'—'}`;
      dropdown.add(new Option(label,d.id));
    }
    renderSelected();
  }
  function renderSelected() {
    state.selected = state.divergences.find(d=>d.id===$('#cv-div').value)||null;
    const d=state.selected;
    const select=$('#cv-action');
    const options = !d ? [['abrir','Abrir e encaminhar divergência']] :
      d.passagemAbertaId ? [['responder','Registrar resposta recebida (para o relógio)'],['observacao','Adicionar observação (mantém relógio)']] :
      ['concluida','devolucao'].includes(d.status) ? [['reabrir','Reabrir e encaminhar novamente'],['observacao','Adicionar observação ao histórico']] :
      [['encaminhar','Encaminhar novamente'],['concluir','Concluir após validação CRF'],['devolver','Marcar para devolução/recusa'],['observacao','Adicionar observação']];
    select.replaceChildren(...options.map(([v,t])=>new Option(t,v)));
    const box=$('#cv-current');
    box.classList.toggle('cv-hidden',!d);
    if (d) {
      const set=d.setorAtual || d.setor;
      box.innerHTML = `<b>Divergência:</b> ${escape(d.tipoNome||'—')} <span class="cv-pill">${escape(d.status||'—')}</span><br><b>Setor atual:</b> ${escape(sectors[set]||set||'CRF')} • <b>Comprador:</b> ${escape(d.compradorAtualNome||d.compradorNome||'—')}<br><b>Passagem:</b> ${d.passagemAbertaId ? 'aguardando resposta (tempo contando)' : 'sem relógio ativo'} • <b>Última ocorrência:</b> ${escape(timeString(d.ultimaOcorrenciaEm))}`;
      $('#cv-sector').value = d.setorAtual || d.setor || '';
    } else $('#cv-sector').value='';
    renderMode();
  }
  function renderMode() {
    const d=state.selected;
    const mode=state.mode=$('#cv-action').value;
    const target=['abrir','encaminhar','reabrir'].includes(mode);
    const response=mode==='responder';
    $('#cv-target').classList.toggle('cv-hidden',!target);
    $('#cv-type-wrap').classList.toggle('cv-hidden',mode!=='abrir');
    $('#cv-response-wrap').classList.toggle('cv-hidden',!response);
    $('#cv-buyer-wrap').classList.toggle('cv-hidden',!target || $('#cv-sector').value!=='comercial');
    $('#cv-sector').disabled=false;
    if (target) {
      if(d && !$('#cv-sector').value) $('#cv-sector').value=d.setorAtual||d.setor||'';
      renderTypes(); renderBuyers();
    }
    if (response) renderResponses();
    if (mode !== 'abrir' && state.autoDetails && trim($('#cv-text').value) === state.autoDetails) {
      $('#cv-text').value = '';
      state.autoDetails = '';
    }
    const needsDetail = mode === 'devolver' || (response && isDevolverResponse(selectedResponse()));
    $('#cv-details-title').textContent = needsDetail ? 'Observação / detalhes (obrigatória para devolver e recusar)' : 'Observação / detalhes (opcional)';
    $('#cv-text').required = needsDetail;
    $('#cv-description-preview').textContent = '';
    if (mode === 'abrir') fillTypeDescription();
    $('#cv-hint').textContent = response ? 'Qualquer resposta ativa deste setor encerra a passagem e para o relógio. “Informações divergentes” atribui esse período ao retrabalho por erro da CRF. Não encerra automaticamente a divergência.' :
      target ? 'Ao salvar será iniciada uma nova passagem. A classificação original da divergência não muda. O Comercial não modifica o status do Infradesk.' :
      mode==='observacao' ? 'Esta observação não muda a situação nem inicia/encerra relógio.' :
      'Esta ação é da CRF e somente fica disponível sem passagem ativa.';
    $('#cv-text').placeholder = needsDetail ? 'Explique o motivo da devolução ou recusa (obrigatório)' : 'Observação adicional, se necessário (opcional)';
  }
  function renderTypes() {
    const select=$('#cv-type');
    const existing=select.value, sector=$('#cv-sector').value;
    select.replaceChildren(new Option('Selecione o tipo',''));
    state.catalog.types.filter(x=>x.ativo!==false && x.setor===sector)
      .sort((a,b)=>trim(a.nome).localeCompare(trim(b.nome),'pt-BR'))
      .forEach(t=>select.add(new Option(t.nome,t.id)));
    if ([...select.options].some(x=>x.value===existing)) select.value=existing;
    if (state.mode === 'abrir') fillTypeDescription();
  }
  function fillTypeDescription() {
    const textarea = $('#cv-text');
    if (!textarea || state.mode !== 'abrir') return;
    const typeId = $('#cv-type').value;
    const type = state.catalog.types.find(x => x.id === typeId);
    const description = trim(type?.descricao || '');
    // Não sobrescrever uma observação que o operador digitou manualmente.
    const current = trim(textarea.value);
    if (!current || (state.autoDetails && current === state.autoDetails)) {
      textarea.value = description;
      state.autoDetails = description;
    }
    $('#cv-description-preview').textContent = description
      ? 'Descrição sugerida a partir do cadastro da divergência. Você pode alterar ou apagar.'
      : (type ? 'Esta divergência não tem descrição no cadastro. A observação é opcional.' : 'Selecione o tipo para carregar uma descrição, se existir.');
  }
  function selectedResponse() {
    return state.catalog.responses.find(x => x.id === $('#cv-response').value) || null;
  }
  function isDevolverResponse(response) {
    if (!response) return false;
    const name = trim(response.nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return response.efeito === 'devolver' || (name.includes('devolver') && name.includes('recusar'));
  }
  function renderBuyers() {
    const sector=$('#cv-sector').value;
    $('#cv-buyer-wrap').classList.toggle('cv-hidden',sector!=='comercial' || !['abrir','encaminhar','reabrir'].includes(state.mode));
    const select=$('#cv-buyer');
    const current=select.value, buyers=activeBuyers();
    select.replaceChildren(new Option(buyers.length ? 'Selecione o comprador' : 'Nenhum comprador ativo vinculado',''));
    buyers.forEach(b=>select.add(new Option(b.nome,b.id)));
    const remembered=state.selected?.compradorAtualId || state.selected?.compradorId || '';
    if (buyers.some(b=>b.id===current)) select.value=current;
    else if (state.selected && buyers.some(b=>b.id===remembered)) select.value=remembered;
    else if (buyers.length===1) select.value=buyers[0].id;
    // Nova divergência com 2+ compradores: seleção em branco, obrigatória.
  }
  function renderResponseDetailRequirement() {
    if (state.mode !== 'responder') return;
    const mandatory = isDevolverResponse(selectedResponse());
    $('#cv-details-title').textContent = mandatory ? 'Observação / detalhes (obrigatória para devolver e recusar)' : 'Observação / detalhes (opcional)';
    $('#cv-text').required = mandatory;
    $('#cv-text').placeholder = mandatory ? 'Explique o motivo da devolução ou recusa (obrigatório)' : 'Observação adicional, se necessário (opcional)';
  }
  function renderResponses() {
    const sector=state.selected?.setorAtual || state.selected?.setor;
    const select=$('#cv-response');
    select.replaceChildren(new Option('Selecione a resposta do setor',''));
    state.catalog.responses.filter(r=>r.ativo!==false && r.setor===sector)
      .sort((a,b)=>trim(a.nome).localeCompare(trim(b.nome),'pt-BR'))
      .forEach(r=>select.add(new Option(r.nome,r.id)));
    renderResponseDetailRequirement();
  }
  async function save() {
    if (state.busy || !canRecord() || !state.data) return;
    const action=state.mode, old=state.selected, data=state.data;
    const sector=$('#cv-sector').value, typeId=$('#cv-type').value;
    const buyerId=$('#cv-buyer').value, responseId=$('#cv-response').value;
    let details=trim($('#cv-text').value);
    const forwarding=['abrir','encaminhar','reabrir'].includes(action);
    const type=state.catalog.types.find(x=>x.id===typeId);
    const buyer=state.buyers.get(buyerId)?.value || null;
    const response=state.catalog.responses.find(x=>x.id===responseId);

    if (!old && action!=='abrir') return alertUser('Escolha uma divergência.',true);
    if (action==='abrir' && (!type || type.ativo===false || type.setor!==sector)) return alertUser('Escolha um tipo de divergência ativo deste setor.',true);
    if (forwarding && !sectors[sector]) return alertUser('Escolha o setor responsável.',true);
    if (forwarding && sector==='comercial' && (!buyer || buyer.ativo===false || !(state.supplier?.compradorIds||[]).includes(buyerId))) return alertUser('Selecione um comprador ativo vinculado ao CNPJ.',true);
    if (action==='responder' && (!response || response.ativo===false || response.setor !== (old?.setorAtual||old?.setor))) return alertUser('Escolha uma resposta ativa do setor que recebeu a nota.',true);
    if ((action === 'devolver' || (action === 'responder' && isDevolverResponse(response))) && !details) {
      return alertUser('Para Devolver e recusar, informe obrigatoriamente o motivo na observação.', true);
    }
    // Um evento precisa de texto legível, mas não exige digitação do operador.
    if (!details) {
      const fallback = {
        abrir: `Divergência aberta: ${type?.nome || 'não informada'}.`,
        encaminhar: `Reencaminhada a ${sectors[sector] || sector}.`,
        reabrir: `Divergência reaberta e encaminhada a ${sectors[sector] || sector}.`,
        responder: `Resposta recebida: ${response?.nome || 'não informada'}.`,
        concluir: 'Divergência concluída após validação da CRF.',
        observacao: 'Acompanhamento registrado pela CRF.'
      };
      details = fallback[action] || 'Ocorrência registrada.';
    }

    state.busy=true; $('#cv-save').disabled=true; $('#cv-save').textContent='Gravando...';
    const noteRef=db.collection('notas_v2').doc(data.chave);
    const divRef=old?db.collection('divergencias_v2').doc(old.id):db.collection('divergencias_v2').doc();
    const eventRef=db.collection('eventos_v2').doc();
    const nextPassRef=forwarding?db.collection('passagens_v2').doc():null;
    const currentPassRef=old?.passagemAbertaId?db.collection('passagens_v2').doc(old.passagemAbertaId):null;
    const attribution=action==='responder' && erroCrf(response)?'crf_erro':(old?.setorAtual||old?.setor||sector);
    try {
      await db.runTransaction(async tx=>{
        // Leituras da transação SEMPRE antes de qualquer gravação.
        const nSnap=await tx.get(noteRef);
        const dSnap=old?await tx.get(divRef):null;
        const pSnap=currentPassRef?await tx.get(currentPassRef):null;
        let supplierSnap=null;
        const supplierRef=db.collection('fornecedores_v2').doc(data.cnpj);
        if (!state.supplier) supplierSnap=await tx.get(supplierRef);

        const prior=dSnap?.data()||null;
        if (old && !dSnap.exists) throw Error('Divergência não encontrada. Reabra a nota.');
        if (old && (Number(prior.revisao||0)!==Number(old.revisao||0) || String(prior.passagemAbertaId||'')!==String(old.passagemAbertaId||''))) throw Error('Outro operador já movimentou esta divergência. Reabra a nota para atualizar.');
        if (action==='responder' && (!prior?.passagemAbertaId || !pSnap?.exists || pSnap.data().fimEm)) throw Error('Esta passagem já foi encerrada. Atualize a nota.');
        if (action==='observacao' && !old) throw Error('Escolha uma divergência.');
        if (forwarding && prior?.passagemAbertaId) throw Error('Já existe uma passagem aguardando resposta. Registre o retorno primeiro.');
        if (['concluir','devolver'].includes(action) && prior?.passagemAbertaId) throw Error('Registre a resposta do setor antes de concluir.');
        if (['concluir','devolver','encaminhar'].includes(action) && !['em_crf'].includes(prior?.status)) throw Error('Esta divergência não está aguardando a CRF. Atualize a nota.');
        if (action==='reabrir' && !['concluida','devolucao'].includes(prior?.status)) throw Error('A divergência ainda não foi encerrada.');
        if (action==='abrir' && prior) throw Error('Esta divergência já existe.');
        const now=FV.serverTimestamp();
        const opName=trim(state.profile?.nome||state.user.displayName||state.user.email);
        const supplierName=state.supplier?.razaoSocial || supplierSnap?.data()?.razaoSocial || data.fornecedorNome;
        if (!state.supplier && !supplierSnap?.exists) tx.set(supplierRef,{
          cnpj:data.cnpj,razaoSocial:data.fornecedorNome,nomeInfradesk:data.fornecedorNome,
          origemRazaoSocial:'infradesk',compradorIds:[],ativo:true,criadoEm:now,atualizadoEm:now
        });
        const noteData={
          chave:data.chave,cnpj:data.cnpj,numeroNf:data.numeroNf,serie:data.serie,
          fornecedorNome:supplierName,nomeInfradesk:data.fornecedorNome,
          ultimaAcao:action,ultimaOcorrenciaTexto:details,atualizadoEm:now,versao:2
        };
        if (data.chamadoInfradeskId) noteData.chamadosInfradeskIds=FV.arrayUnion(data.chamadoInfradeskId);
        if(!nSnap.exists) tx.set(noteRef,{...noteData,criadoEm:now,divergenciasCount:action==='abrir'?1:0});
        else tx.update(noteRef,{...noteData,...(action==='abrir'?{divergenciasCount:FV.increment(1)}:{})});

        const nextStatus=forwarding?'aberta':action==='responder'?'em_crf':action==='concluir'?'concluida':action==='devolver'?'devolucao':prior.status;
        const buyerName=sector==='comercial'?(buyer?.nome||''):'';
        if (!prior) tx.set(divRef,{
          chave:data.chave,cnpj:data.cnpj,numeroNf:data.numeroNf,fornecedorNome:supplierName,
          criadoEm:now,atualizadoEm:now,abertoPor:state.user.uid,abertoPorNome:opName,
          setor:sector,tipoId:typeId,tipoNome:type.nome,
          compradorId:buyerId,compradorNome:buyerName,
          setorAtual:sector,compradorAtualId:buyerId,compradorAtualNome:buyerName,
          status:'aberta',passagemAbertaId:nextPassRef.id,passagensCount:1,revisao:1,
          ultimaOcorrenciaTexto:details,ultimaOcorrenciaEm:now
        });
        else {
          const changes={atualizadoEm:now,ultimaOcorrenciaTexto:details,ultimaOcorrenciaEm:now,status:nextStatus,revisao:FV.increment(1)};
          if (forwarding) Object.assign(changes,{
            passagemAbertaId:nextPassRef.id,passagensCount:FV.increment(1),
            setorAtual:sector,compradorAtualId:sector==='comercial'?buyerId:'',compradorAtualNome:buyerName,
            ...(action==='reabrir'?{resolvidoEm:null}:{})
          });
          if (action==='responder') Object.assign(changes,{passagemAbertaId:null,ultimaRespostaId:response.id,ultimaRespostaNome:response.nome});
          if (['concluir','devolver'].includes(action)) Object.assign(changes,{passagemAbertaId:null,resolvidoEm:now});
          tx.update(divRef,changes);
        }
        if (nextPassRef) tx.set(nextPassRef,{
          chave:data.chave,divergenciaId:divRef.id,setor:sector,
          compradorId:sector==='comercial'?buyerId:'',compradorNome:buyerName,
          inicioEm:now,fimEm:null,criadoPor:state.user.uid,criadoPorNome:opName,
          chamadoInfradeskId:data.chamadoInfradeskId||''
        });
        if (action==='responder') tx.update(currentPassRef,{
          fimEm:now,fechadoPor:state.user.uid,fechamento:'resposta',
          respostaId:response.id,respostaNome:response.nome,atribuicaoTempo:attribution
        });
        tx.set(eventRef,{
          chave:data.chave,divergenciaId:divRef.id,acao:action,
          setor:action==='responder'?(prior?.setorAtual||prior?.setor):forwarding?sector:(prior?.setorAtual||prior?.setor),
          compradorId:forwarding?buyerId:(prior?.compradorAtualId||prior?.compradorId||''),
          compradorNome:forwarding?buyerName:(prior?.compradorAtualNome||prior?.compradorNome||''),
          respostaId:action==='responder'?response.id:'',respostaNome:action==='responder'?response.nome:'',
          atribuicaoTempo:action==='responder'?attribution:'',
          passagemId:action==='responder'?(prior?.passagemAbertaId||''):(nextPassRef?.id||''),
          texto:details,chamadoInfradeskId:data.chamadoInfradeskId||'',
          usuarioId:state.user.uid,usuarioNome:opName,usuarioEmail:state.user.email||'',criadoEm:now
        });
      });
      alertUser(action==='responder'?'Resposta registrada e relógio encerrado.':action==='abrir'?'Divergência aberta e encaminhada.':'Evento gravado com sucesso.');
      close(true);
    } catch(e) {
      console.error('[Comercial V2.3.1] Erro ao salvar:',e);
      alertUser(e?.code==='permission-denied'?'Acesso negado. Publique as novas regras do Firestore antes do teste.':(e.message||'Falha ao salvar'),true);
    } finally {state.busy=false;$('#cv-save').disabled=!canRecord();$('#cv-save').textContent='Salvar ocorrência';}
  }
  function addButton(card) {
    if ($('.comercial-v2-button',card)) return;
    if (!extract(card)) return; // Sem Firebase. Apenas lê o HTML do Infradesk.
    const toolbar=$('.toolbar-atendente',card)||$('.list-toolbar',card)||card;
    const button=document.createElement('button');
    button.type='button';button.className='comercial-v2-button';button.title='Registrar divergências e respostas no Comercial';
    const icon=document.createElement('img');icon.src=ICON;icon.alt='Comercial';button.append(icon);
    button.onclick=e=>{e.preventDefault();e.stopPropagation();openCard(card);};
    const xabuia=$('.xabuia-card-btn',toolbar);
    if(xabuia)xabuia.insertAdjacentElement('afterend',button);else toolbar.append(button);
  }
  function scan() { $$('.chamado-item[data-chamado-id]').forEach(addButton); }
  let timer=null;
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(scan,400);});
  auth.onAuthStateChanged(user=>{
    if (!user || state.user?.uid!==user.uid) {
      state.user=user;state.profile=null;state.profileAt=0;
      state.catalog.expiresAt=0;state.buyers.clear();
    }
    renderSession();
  });
  function boot() {
    createUI();scan();observer.observe(document.body,{childList:true,subtree:true});
    console.info('[Comercial V2.3.1] Pronto. Nenhuma consulta automática de Firestore por card.');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
