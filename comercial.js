// ==UserScript==
// @name         Comercial • Infradesk • Registro de divergências V2.4.1
// @namespace    comercial/infradesk
// @version      2.4.1
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
    console.error('[Comercial V2.4.1] Firebase compat não encontrado. Confira o loader.');
    return;
  }
  window.__COMERCIAL_APP_RUNNING__ = true;
  window.__COMERCIAL_APP_VERSION__ = '2.4.1';

  const ICON = 'https://unix-page.github.io/comercial/comercial.png';
  const CONFIG = {
    apiKey: 'AIzaSyBpWLYK1cejNpUAo5NMk8ecSSQrYMVf6-0',
    authDomain: 'comercial-divergencias.firebaseapp.com',
    projectId: 'comercial-divergencias',
    storageBucket: 'comercial-divergencias.firebasestorage.app',
    messagingSenderId: '602637992147',
    appId: '1:602637992147:web:fc930856cc72f598a31426'
  };
  // Congela a mesma cópia do SDK para Auth, Provider e Firestore. O Xabuia
  // e outros userscripts podem substituir window.firebase depois da carga.
  const comercialFirebaseSDK = window.firebase;
  const ComercialGoogleAuthProvider = comercialFirebaseSDK.auth.GoogleAuthProvider;
  const APP_NAME = 'comercial-divergencias-app';
  let app;
  try { app = comercialFirebaseSDK.app(APP_NAME); }
  catch (_) { app = comercialFirebaseSDK.initializeApp(CONFIG, APP_NAME); }
  if (app.options?.projectId !== CONFIG.projectId || app.options?.appId !== CONFIG.appId) {
    console.error('[Comercial] Instância nomeada Firebase com configuração diferente.');
    return;
  }
  const auth = comercialFirebaseSDK.auth(app);
  const db = comercialFirebaseSDK.firestore(app);
  const FV = comercialFirebaseSDK.firestore.FieldValue;
  auth.languageCode = 'pt-BR';
  console.info('[Comercial Google] SDK isolado:', {
    app: app.name, projectId: app.options.projectId,
    sdkVersion: comercialFirebaseSDK.SDK_VERSION || 'compat'
  });
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const onlyDigits = s => String(s ?? '').replace(/\D/g, '');
  const trim = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const sectors = { fiscal:'Fiscal (Sicofe)', comercial:'Comercial', cadastro:'Cadastro' };
  const TTL = 15 * 60 * 1000;
  const CARD_CACHE_TTL = 5 * 60 * 1000;
  const CARD_CACHE_KEY = 'comercial_v2_card_cache';
  const state = {
    user: null, profile: null, profileAt: 0,
    catalog: { types: [], responses: [], expiresAt: 0 },
    buyers: new Map(),
    card: null, data: null, supplier: null,
    divergences: [], selected: null, busy: false,
    viewToken: 0, mode: 'abrir', autoDetails: '',
    visibleLookupBusy: false, visibleLookupAt: 0
  };

  function readCardCache() {
    try { return JSON.parse(localStorage.getItem(CARD_CACHE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeCardCache(cache) { try { localStorage.setItem(CARD_CACHE_KEY, JSON.stringify(cache || {})); } catch (_) {} }
  function cardCacheEntry(chave) {
    if (!chave) return null;
    const cache = readCardCache();
    const entry = cache[onlyDigits(chave)];
    if (!entry || !entry.cachedAt || (Date.now() - Number(entry.cachedAt) > CARD_CACHE_TTL)) return null;
    return entry;
  }
  function rememberCardSummary(chave, summary) {
    if (!chave) return;
    const key = onlyDigits(chave);
    const cache = readCardCache();
    cache[key] = { cachedAt: Date.now(), summary: summary || null };
    Object.keys(cache).forEach(k => { if (!cache[k]?.cachedAt || Date.now() - Number(cache[k].cachedAt) > CARD_CACHE_TTL) delete cache[k]; });
    writeCardCache(cache);
  }
  function latestMillis(value) { return value?.toMillis?.() || (value ? new Date(value).getTime() : 0) || 0; }
  // As versões anteriores criavam outros estados. A interface atual tem apenas
  // "Aberta" e "Respondida"; não regrava o histórico antigo.
  function isAnswered(d) {
    if (!d) return false;
    if (d.passagemAbertaId) return false;
    return ['respondida', 'concluida', 'devolucao'].includes(d.status)
      || (d.status === 'em_crf' && Boolean(d.ultimaRespostaId || d.ultimaRespostaNome));
  }
  function effectiveStatus(d) { return isAnswered(d) ? 'respondida' : 'aberta'; }
  function statusTitle(d) { return effectiveStatus(d) === 'respondida' ? 'Respondida' : 'Aberta'; }
  function cardStatusInfo(summary) {
    if (!summary) return {key:'', label:''};
    return summary.status === 'respondida'
      ? {key:'respondida', label:'Respondida'}
      : {key:'aberta', label:'Aberta'};
  }
  function summarizeDivergences(divs, chave = '') {
    if (!Array.isArray(divs) || !divs.length) return null;
    const ordered = [...divs].sort((a,b) => latestMillis(b.atualizadoEm || b.ultimaOcorrenciaEm || b.criadoEm) - latestMillis(a.atualizadoEm || a.ultimaOcorrenciaEm || a.criadoEm));
    const open = ordered.find(d => d.passagemAbertaId);
    const chosen = open || ordered[0];
    const setorKey = chosen?.setorAtual || chosen?.setor || '';
    const setorNome = sectors[setorKey] || setorKey || 'Setor';
    const comprador = trim(chosen?.compradorAtualNome || chosen?.compradorNome || '');
    const abertas = ordered.filter(d=>d.passagemAbertaId).length;
    const respondidas = ordered.filter(isAnswered).length;
    const footerParts = [];
    if (comprador) footerParts.push(comprador);
    if (abertas) footerParts.push(`${abertas} aberta(s)`);
    if (respondidas) footerParts.push(`${respondidas} respondida(s)`);
    return {
      chave: onlyDigits(chave || chosen?.chave || ''),
      status: abertas ? 'aberta' : 'respondida',
      statusText: abertas ? 'Aberta' : 'Respondida',
      tipoNome: trim(chosen?.tipoNome || 'Divergência'),
      setorNome, compradorNome:comprador,
      ultimaOcorrenciaTexto:trim(chosen?.ultimaOcorrenciaTexto || chosen?.ultimaRespostaNome || chosen?.tipoNome || 'Divergência registrada.'),
      atualizadoEm:chosen?.ultimaOcorrenciaEm || chosen?.atualizadoEm || chosen?.criadoEm || null,
      footer:footerParts.join(' • '), total:ordered.length
    };
  }
  function removeCardBox(card) {
    $('.comercial-box', card)?.remove();
    if (card) delete card.dataset.comercialStatus;
  }
  function ensureCardBox(card) {
    let box = $('.comercial-box', card);
    if (box) return box;
    box = document.createElement('div');
    box.className = 'comercial-box';
    const tags = $('.chamado-tags', card);
    if (tags?.parentElement) tags.insertAdjacentElement('afterend', box);
    else (card.children?.[0] || card).appendChild(box);
    return box;
  }
  function renderCardBox(card, summary) {
    if (!card) return;
    if (!summary) { removeCardBox(card); return; }
    const box = ensureCardBox(card);
    const info = cardStatusInfo(summary);
    card.dataset.comercialStatus = info.key;
    const when = timeString(summary.atualizadoEm);
    const fingerprint = [info.key, info.label, summary.tipoNome, summary.ultimaOcorrenciaTexto, when, summary.footer].join('|');
    // Evita reescrever o DOM em cada MutationObserver (loop de renderização).
    if (box.dataset.fingerprint === fingerprint) return;
    box.dataset.fingerprint = fingerprint;
    box.className = `comercial-box comercial-status-${String(info.key).replace(/[^a-z0-9_-]/gi,'_')}`;
    box.innerHTML = `
      <div class="comercial-box-head"><span class="comercial-box-title"><img src="${ICON}" alt=""> Comercial</span><span class="comercial-chip">${escape(info.label)}</span></div>
      <div class="comercial-box-body">
        <div><strong>${escape(summary.tipoNome || 'Divergência')}</strong></div>
        <div class="comercial-last-text">${escape(summary.ultimaOcorrenciaTexto || 'Divergência registrada.')}</div>
        <small>${escape(when)}${summary.footer ? ' • ' + escape(summary.footer) : ''}</small>
      </div>`;
  }
  function renderCardFromCache(card) {
    const data = extract(card);
    if (!data) return false;
    const entry = cardCacheEntry(data.chave);
    if (!entry) { removeCardBox(card); return false; }
    renderCardBox(card, entry.summary);
    return Boolean(entry.summary);
  }
  async function refreshVisibleCards(force = false) {
    if (state.visibleLookupBusy || !auth.currentUser || !canRecord()) return;
    // Apenas cards na tela, não todo o Kanban. Consulta no máximo 20 chaves sem cache.
    const cards = $$('.chamado-item[data-chamado-id]').filter(card => {
      const rect = card.getBoundingClientRect();
      return rect.bottom >= -350 && rect.top <= window.innerHeight + 350;
    });
    const keys = [...new Set(cards.map(extract).filter(Boolean).map(x => x.chave).filter(Boolean))]
      .filter(chave => force || !cardCacheEntry(chave)).slice(0, 20);
    if (!keys.length) return;
    state.visibleLookupBusy = true;
    try {
      for (let i=0;i<keys.length;i+=10) {
        const chunk = keys.slice(i,i+10);
        const snap = await db.collection('divergencias_v2').where('chave', 'in', chunk).get();
        const grouped = new Map();
        snap.docs.forEach(doc => {
          const row = { id:doc.id, ...doc.data() };
          const list = grouped.get(row.chave) || [];
          list.push(row);
          grouped.set(row.chave,list);
        });
        chunk.forEach(chave => rememberCardSummary(chave,summarizeDivergences(grouped.get(chave)||[],chave)));
      }
      cards.forEach(renderCardFromCache);
    } catch(e) {
      console.warn('[Comercial V2.4.1] Atualização de cards visíveis falhou:',e);
    } finally { state.visibleLookupBusy = false; }
  }

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
      fornecedorTexto: trim(supplierLink?.textContent || ''),
      fornecedorId: supplierLink?.getAttribute('href')?.match(/\/fornecedores\/contato\/(\d+)/i)?.[1] || '',
      // Mesmo seletor do Xabuia. A empresa é a loja/unidade mostrada no card.
      empresa: trim($('.item-data-empresa', card)?.textContent || ''),
      // Categoria ORIGINAL do card (não confundir com setor da divergência).
      categoriaNota: trim($('.item-subcategoria', card)?.getAttribute('title') || $('.item-subcategoria', card)?.textContent || ''),
      statusInfradesk: trim(card.closest('ul[data-status-descricao]')?.getAttribute('data-status-descricao') || ''),
      descricaoInfradesk: trim($('.item-ultima-descricao-copy',card)?.textContent || '')
    };
  }
  function timeString(ts) {
    if (!ts) return '—';
    const dt = ts.toDate?.() || (typeof ts.seconds === 'number' ? new Date(ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6)) : new Date(ts));
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
      .comercial-v2-button{width:24px!important;height:24px!important;padding:1px!important;border:1px solid #ec9dc7!important;background:#ffe9f3!important;border-radius:5px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;vertical-align:middle!important;margin-left:2px!important;cursor:pointer!important}
      .comercial-v2-button:hover{background:#ffd7e7!important;border-color:#d91e74!important}.comercial-v2-button img{width:18px!important;height:18px!important;display:block!important;border-radius:4px!important}
      .cv-backdrop{display:none;position:fixed;inset:0;z-index:2147483644;background:#111827a6;align-items:center;justify-content:center;padding:12px;font:13px system-ui,Arial;color:#18243a}
      .cv-backdrop.open{display:flex}.cv-window{background:#fff;width:min(710px,100%);max-height:94vh;overflow:auto;border-radius:15px;box-shadow:0 22px 70px #0006}
      .cv-header{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid #e5e7eb}.cv-header img{width:42px;height:42px;border-radius:12px}.cv-header strong{font-size:18px}.cv-header small{display:block;color:#687386}.cv-header button{margin-left:auto}
      .cv-content{display:grid;gap:12px;padding:18px}.cv-info{border:1px solid #dbeafe;background:#eff6ff;color:#1e3a8a;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.6;overflow-wrap:anywhere}
      .cv-content label{display:grid;gap:5px;font-size:12px;font-weight:700}.cv-content select,.cv-content input,.cv-content textarea{box-sizing:border-box;width:100%;padding:9px 10px;color:#162238;background:white;border:1px solid #d4dce9;border-radius:8px;font:13px system-ui}
      .cv-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cv-card{padding:10px 12px;border:1px solid #e6eaf1;border-radius:9px;background:#f8fafc;line-height:1.55}
      .cv-hint{font-size:11px;color:#65758b;line-height:1.5}.cv-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e6eaf1;flex-wrap:wrap}.cv-button{padding:9px 12px;border:1px solid #d6deea;background:white;color:#1a2941;border-radius:8px;font:700 12px system-ui;cursor:pointer}.cv-button:disabled{opacity:.55;cursor:not-allowed}.cv-button.primary{background:#d91e74;border-color:#d91e74;color:#fff}.cv-login{display:grid;gap:10px;padding:10px 12px;border:1px solid #dbeafe;background:#f8fafc;border-radius:12px}
      .cv-session{padding:10px 12px;border-radius:12px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.cv-session.ok{background:#ecfdf3;color:#067647;border-color:#bbf7d0}.cv-session b{color:inherit}.cv-session small{color:inherit;opacity:.9}
      .cv-login-entry{padding:10px 12px;border:1px solid #dbeafe;background:#f8fafc;border-radius:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.cv-login-entry span{font-size:11px;color:#64748b}
      .cv-login-help{font-size:11px;line-height:1.5;color:#64748b}
      .cv-description{font-size:11px;color:#66768c;font-weight:400}.cv-pill{display:inline-flex;padding:3px 8px;border-radius:30px;background:#fff0f6;color:#a51d62;font-size:11px;font-weight:700}.cv-hidden{display:none!important}
      .comercial-box{clear:both;margin:9px 0 10px;padding:0;border:1px solid rgba(217,30,116,.18);background:#fff;border-radius:12px;color:#172033;font-size:12px;line-height:1.35;overflow:hidden;box-shadow:0 10px 22px rgba(15,23,42,.10)}.comercial-box-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;font-weight:900;color:#fff;background:linear-gradient(135deg,#d91e74,#fb7185)}.comercial-box-title{display:inline-flex;align-items:center;gap:6px;min-width:0}.comercial-box-title img{width:18px;height:18px;border-radius:5px;flex:0 0 auto}.comercial-chip{display:inline-flex;align-items:center;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:900;background:rgba(255,255,255,.96);color:#be185d;border:1px solid rgba(255,255,255,.65);white-space:nowrap}.comercial-box-body{padding:8px 9px 9px;background:#f8fafc;border-left:4px solid #d91e74}.comercial-last-text{margin-top:3px;padding:6px 7px;border-radius:9px;background:#fff;border:1px solid #e2e8f0;color:#334155;overflow-wrap:anywhere;white-space:pre-wrap}.comercial-box small{color:#64748b;display:block;margin-top:5px}.comercial-box.comercial-status-em_crf .comercial-box-head{background:linear-gradient(135deg,#2563eb,#38bdf8)}.comercial-box.comercial-status-respondida .comercial-box-head{background:linear-gradient(135deg,#067647,#12b76a)}.comercial-box.comercial-status-concluida .comercial-box-head{background:linear-gradient(135deg,#067647,#12b76a)}.comercial-box.comercial-status-devolucao .comercial-box-head{background:linear-gradient(135deg,#b42318,#ef4444)}
      .chamado-item[data-comercial-status='aberta']{border-left:4px solid #d91e74!important}.chamado-item[data-comercial-status='em_crf']{border-left:4px solid #2563eb!important}.chamado-item[data-comercial-status='respondida']{border-left:4px solid #12b76a!important}.chamado-item[data-comercial-status='concluida']{border-left:4px solid #12b76a!important}.chamado-item[data-comercial-status='devolucao']{border-left:4px solid #ef4444!important}@media(max-width:620px){.cv-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
    const modal = document.createElement('div');
    modal.id = 'comercial-v2-modal'; modal.className = 'cv-backdrop';
    modal.innerHTML = `<div class="cv-window" role="dialog" aria-modal="true" aria-label="Comercial V2">
      <div class="cv-header"><img src="${ICON}" alt=""><div><strong>Abrir Comercial</strong><small>NF • Divergência Comercial</small></div><button class="cv-button" id="cv-close" type="button">✕</button></div>
      <div class="cv-content">
        <div class="cv-info" id="cv-info"></div>
        <a id="cv-history-link" class="cv-button" style="text-align:center;display:block;text-decoration:none" target="_blank" rel="noopener noreferrer" href="https://unix-page.github.io/comercial/">Ver linha do tempo completa desta NF ↗</a>
        <div class="cv-session"><div id="cv-session-text">Verificando login do Comercial...</div><button type="button" class="cv-button cv-hidden" id="cv-logout">Sair / trocar conta</button></div>
        <div id="cv-login-entry" class="cv-login-entry cv-hidden"><button type="button" id="cv-login-toggle" class="cv-button primary">Entrar no Comercial</button><span>Login independente do Infradesk e do Xabuia.</span></div>
        <div id="cv-login" class="cv-login cv-hidden">
          <strong id="cv-login-status">Entre com a conta do Comercial</strong>
          <div id="cv-login-fields"></div>
          <div><button class="cv-button primary" id="cv-email-login" type="button">Entrar com e-mail</button> <button class="cv-button" id="cv-google-login" type="button">Entrar com Google</button> <button class="cv-button" id="cv-reset-password" type="button">Definir/recuperar senha</button></div>
          <span class="cv-login-help">Informe as credenciais do <b>Comercial</b>, não as do Infradesk. Os campos só aparecem quando você abre o login para evitar preenchimento automático de outra conta.</span>
        </div>
        <div id="cv-form" class="cv-hidden" style="display:grid;gap:12px">
          <label>Divergência da nota<select id="cv-div"><option value="">+ Nova divergência</option></select></label>
          <div id="cv-current" class="cv-card cv-hidden"></div>
          <div class="cv-grid" id="cv-target"><label>Setor responsável<select id="cv-sector"><option value="">Selecione</option><option value="comercial">Comercial</option><option value="fiscal">Fiscal (Sicofe)</option><option value="cadastro">Cadastro</option></select></label><label id="cv-type-wrap">Tipo de divergência<select id="cv-type"><option value="">Selecione</option></select></label></div>
          <label id="cv-buyer-wrap">Comprador responsável<select id="cv-buyer"><option value="">Selecione</option></select></label>
          <label id="cv-response-wrap" class="cv-hidden">Resposta recebida do setor<select id="cv-response"><option value="">Selecione uma resposta</option></select></label>
          <label id="cv-details-wrap"><span id="cv-details-title">Observação / detalhes (opcional)</span><textarea id="cv-text" rows="3" placeholder="Observação adicional, se necessário..."></textarea><span id="cv-description-preview" class="cv-description"></span></label>
          <p class="cv-hint" id="cv-hint">Registrar no Comercial não altera o chamado original do Infradesk.</p>
        </div>
      </div>
      <div class="cv-buttons"><button type="button" class="cv-button" id="cv-refresh">Atualizar dados desta nota</button><button type="button" class="cv-button" id="cv-cancel">Cancelar</button><button type="button" class="cv-button primary" id="cv-save">Salvar ocorrência</button></div>
    </div>`;
    document.body.appendChild(modal);
    $('#cv-close').onclick = close;
    $('#cv-cancel').onclick = close;
    $('#cv-div').onchange = renderSelected;
    $('#cv-sector').onchange = () => { renderTypes(); renderBuyers(); };
    $('#cv-type').onchange = fillTypeDescription;
    $('#cv-response').onchange = renderResponseDetailRequirement;
    $('#cv-login-toggle').onclick = toggleLoginPanel;
    $('#cv-google-login').onclick = loginGoogle;
    $('#cv-email-login').onclick = loginWithEmail;
    $('#cv-reset-password').onclick = resetPassword;
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
  function clearLoginFields() {
    $('#cv-login')?.classList.add('cv-hidden');
    $('#cv-login-fields')?.replaceChildren(); // Senha não permanece no DOM.
  }
  function mountLoginFields() {
    const slot = $('#cv-login-fields');
    if (!slot) return;
    slot.innerHTML = `<div class="cv-grid">
      <label>E-mail Comercial<input id="cv-email" name="comercial_login_email_independente" type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" readonly placeholder="nome@empresa.com.br"></label>
      <label>Senha Comercial<input id="cv-pass" name="comercial_login_senha_independente" type="password" autocomplete="new-password" readonly placeholder="Senha cadastrada no Comercial"></label>
    </div>`;
    for (const input of [$('#cv-email'), $('#cv-pass')]) {
      if (!input) continue;
      input.value = '';
      input.dataset.manual = '0';
      input.addEventListener('focus', () => { input.value = ''; input.readOnly = false; }, { once: true });
      input.addEventListener('beforeinput', e => {
        if (['insertText','insertCompositionText','insertFromPaste','insertFromDrop'].includes(e.inputType)) input.dataset.manual='1';
      });
      input.addEventListener('keydown', e => {
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) input.dataset.manual='1';
      });
      input.addEventListener('paste', () => { input.dataset.manual='1'; });
      input.addEventListener('drop', () => { input.dataset.manual='1'; });
    }
    $('#cv-pass')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); loginWithEmail(); }
    });
  }
  function toggleLoginPanel() {
    const panel=$('#cv-login');
    if (!panel) return;
    if (!panel.classList.contains('cv-hidden')) { clearLoginFields(); return; }
    mountLoginFields();
    panel.classList.remove('cv-hidden');
  }
  function emailError(e) {
    const messages={
      'auth/invalid-credential':'E-mail ou senha inválidos. Se você usa apenas Google, utilize Definir/recuperar senha.',
      'auth/wrong-password':'Senha incorreta.',
      'auth/user-not-found':'Usuário não encontrado neste projeto Comercial.',
      'auth/invalid-email':'E-mail inválido.',
      'auth/too-many-requests':'Muitas tentativas. Tente novamente mais tarde.',
      'auth/operation-not-allowed':'Login por senha não habilitado no Firebase Authentication.',
      'auth/network-request-failed':'Falha de rede ou conexão bloqueada.'
    };
    return messages[e?.code] || e?.message || 'Não foi possível entrar com e-mail.';
  }
  function emailFields() {
    return { email: String($('#cv-email')?.value || '').trim(), password:String($('#cv-pass')?.value || '') };
  }
  async function loginWithEmail() {
    if (loginWithEmail.inProgress) return loginWithEmail.inProgress;
    const {email,password}=emailFields();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || $('#cv-email')?.dataset.manual !== '1') {
      alertUser('Digite o e-mail do Comercial, não o sugerido automaticamente pelo Infradesk.',true);
      $('#cv-email')?.focus();return;
    }
    if (!password || $('#cv-pass')?.dataset.manual !== '1') {
      alertUser('Digite a senha cadastrada no Comercial.',true);
      $('#cv-pass')?.focus();return;
    }
    const button=$('#cv-email-login'); if(button) button.disabled=true;
    loginWithEmail.inProgress=auth.signInWithEmailAndPassword(email,password)
      .then(async()=>{clearLoginFields();await loadProfile(true);await loadForm();alertUser('Conta Comercial conectada.');})
      .catch(e=>{console.error('[Comercial E-mail]',e);alertUser(emailError(e),true);})
      .finally(()=>{loginWithEmail.inProgress=null;if(button)button.disabled=false;});
    return loginWithEmail.inProgress;
  }
  async function resetPassword() {
    const {email}=emailFields();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || $('#cv-email')?.dataset.manual !== '1') {
      alertUser('Digite manualmente o e-mail do Comercial para receber o link.',true);
      $('#cv-email')?.focus();return;
    }
    const button=$('#cv-reset-password');if(button)button.disabled=true;
    try { await auth.sendPasswordResetEmail(email);alertUser('Se a conta permitir recuperação, verifique a caixa de entrada deste e-mail.'); }
    catch(e) { console.error('[Comercial Recuperar Senha]',e);alertUser(emailError(e),true); }
    finally {if(button)button.disabled=false;}
  }
  function loginGoogle() {
    // Abertura do popup acontece diretamente no clique, SEM await anterior.
    if (loginGoogle.inProgress) return loginGoogle.inProgress;
    const button=$('#cv-google-login');
    try {
      const provider=new ComercialGoogleAuthProvider();
      provider.setCustomParameters({prompt:'select_account'});
      console.info('[Comercial Google] Login:',{app:app.name,projectId:app.options.projectId,
        sdkVersion:comercialFirebaseSDK.SDK_VERSION||'compat',globalSdkTrocado:window.firebase!==comercialFirebaseSDK});
      if(button)button.disabled=true;
      const popup=auth.signInWithPopup(provider);
      loginGoogle.inProgress=popup.then(async()=>{
        clearLoginFields();await loadProfile(true);await loadForm();alertUser('Conta Google conectada ao Comercial.');
      }).catch(e=>{
        console.error('[Comercial Google] Falha:',{code:e?.code,message:e?.message,app:app.name,
          sdkGlobalTrocado:window.firebase!==comercialFirebaseSDK});
        alertUser(googleError(e),true);
      }).finally(()=>{loginGoogle.inProgress=null;if(button)button.disabled=false;});
      return loginGoogle.inProgress;
    } catch(e) {if(button)button.disabled=false;console.error('[Comercial Google] Falha antes do popup:',e);alertUser(googleError(e),true);}
  }
  function googleError(e) {
    const messages={
      'auth/argument-error':'Conflito entre cópias do Firebase. Veja o Console [Comercial Google].',
      'auth/popup-blocked':'Popup bloqueado. Autorize janelas para o Infradesk.',
      'auth/unauthorized-domain':'Domínio não autorizado no Firebase Authentication: '+location.hostname,
      'auth/popup-closed-by-user':'Janela de login fechada antes de concluir.',
      'auth/cancelled-popup-request':'Já há um login Google em andamento.',
      'auth/web-storage-unsupported':'Armazenamento do navegador bloqueado para autenticação.',
      'auth/network-request-failed':'Falha de rede ou bloqueio de conexão.',
      'auth/operation-not-allowed':'Login Google desabilitado no projeto Firebase.'
    };
    return messages[e?.code] || e?.message || 'Não foi possível entrar com Google.';
  }
  function close(force = false) {
    if (state.busy && force !== true) return;
    $('#comercial-v2-modal')?.classList.remove('open');
    clearLoginFields();
    state.card = null; state.data = null; state.selected = null; state.viewToken++;
  }
  async function openCard(card) {
    const data = extract(card);
    if (!data) { alertUser('Chave de NF-e ausente ou inválida. Confira os 44 dígitos.',true); return; }
    const token = ++state.viewToken;
    state.card = card; state.data = data; state.selected = null; state.autoDetails = '';
    $('#cv-info').innerHTML = `<div><b>Chave:</b> ${escape(data.chave)}</div>
      <div><b>NF:</b> ${escape(data.numeroNf)} • <b>CNPJ:</b> ${escape(data.cnpj)}</div>
      <div><b>Infradesk:</b> ${escape(data.chamadoInfradeskId||'—')} • ${escape(data.statusInfradesk||'—')}</div>
      <div><b>Empresa:</b> ${escape(data.empresa||'—')}</div>
      <div><b>Categoria da nota:</b> ${escape(data.categoriaNota||'—')}</div>
      <div><b>Fornecedor:</b> ${escape(data.fornecedorTexto||data.fornecedorNome||'—')}</div>`;
    $('#cv-text').value = '';
    $('#cv-history-link').href = 'https://unix-page.github.io/comercial/?nf=' + encodeURIComponent(data.chave);
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
    const bar = line?.closest?.('.cv-session');
    if (!line) return;
    const logout = $('#cv-logout');
    logout?.classList.toggle('cv-hidden', !user);
    if (!user) {
      bar?.classList.remove('ok');
      line.textContent = 'Entre com Google ou e-mail/senha do Comercial.';
      return;
    }
    const nome = trim(profile?.nome || user.displayName || user.email || 'Usuário');
    const email = trim(user.email || '');
    const papel = trim(profile?.papel || 'sem perfil');
    bar?.classList.toggle('ok', Boolean(profile && profile.ativo !== false));
    line.replaceChildren();
    const strong = document.createElement('b');
    strong.textContent = 'Salvando como ' + nome;
    const small = document.createElement('small');
    small.textContent = email ? `${email} • Perfil: ${papel}` : `Perfil: ${papel}`;
    line.append(strong, small);
  }
  async function loadForm() {
    const allowed = canRecord();
    renderSession();
    $('#cv-login-entry').classList.toggle('cv-hidden', !!(state.user && state.profile && state.profile.ativo !== false));
    if (state.user) clearLoginFields();
    $('#cv-form').classList.toggle('cv-hidden',!allowed);
    $('#cv-save').disabled = !allowed;
    $('#cv-login-status').textContent = !state.user ? 'Entre no Comercial' : !state.profile ? 'Conta conectada sem perfil em usuarios. Use Sair / trocar conta para escolher outra.' : state.profile.ativo === false ? 'Conta inativa' : 'Este perfil não pode registrar eventos';
    if (!allowed) return;
    await Promise.all([loadCatalog(),loadNote()]);
    const summary = summarizeDivergences(state.divergences, state.data?.chave);
    rememberCardSummary(state.data?.chave, summary);
    renderCardBox(state.card, summary);
    const dropdown=$('#cv-div');
    dropdown.replaceChildren(new Option('+ Abrir nova divergência',''));
    for (const d of state.divergences) {
      const label = `${d.tipoNome||'Divergência'} • ${statusTitle(d)} • ${d.compradorNome||sectors[d.setor]||'—'}`;
      dropdown.add(new Option(label,d.id));
    }
    renderSelected();
  }
  function renderSelected() {
    state.selected = state.divergences.find(d=>d.id===$('#cv-div').value) || null;
    state.autoDetails = '';
    $('#cv-text').value = '';
    $('#cv-response').value = '';
    const d = state.selected;
    const box = $('#cv-current');
    box.classList.toggle('cv-hidden',!d);
    if (d) {
      const set = d.setorAtual || d.setor;
      box.innerHTML = `<b>Divergência:</b> ${escape(d.tipoNome||'—')} <span class="cv-pill">${escape(statusTitle(d))}</span><br><b>Setor:</b> ${escape(sectors[set]||set||'—')} • <b>Comprador:</b> ${escape(d.compradorAtualNome||d.compradorNome||'—')}<br><b>Passagem:</b> ${d.passagemAbertaId ? 'aguardando resposta (tempo contando)' : 'encerrada (relógio parado)'} • <b>Última ocorrência:</b> ${escape(timeString(d.ultimaOcorrenciaEm))}${isAnswered(d) ? `<br><b>Resposta:</b> ${escape(d.ultimaRespostaNome || 'Registrada')}` : ''}`;
      $('#cv-sector').value = set || '';
    } else {
      $('#cv-sector').value = '';
    }
    renderMode();
  }
  function renderMode() {
    const d = state.selected;
    // Sem menu Próxima ação: divergência nova abre; divergência aberta recebe
    // resposta; divergência já respondida é apenas leitura.
    const closed = Boolean(d && !d.passagemAbertaId);
    const mode = state.mode = !d ? 'abrir' : closed ? 'visualizar' : 'responder';
    const opening = mode === 'abrir';
    const responding = mode === 'responder';
    $('#cv-target').classList.toggle('cv-hidden',!opening);
    $('#cv-type-wrap').classList.toggle('cv-hidden',!opening);
    $('#cv-response-wrap').classList.toggle('cv-hidden',!responding);
    $('#cv-buyer-wrap').classList.toggle('cv-hidden',!opening || $('#cv-sector').value!=='comercial');
    $('#cv-details-wrap').classList.toggle('cv-hidden',closed);
    $('#cv-save').classList.toggle('cv-hidden',closed);
    $('#cv-save').disabled = closed || !canRecord();
    $('#cv-save').textContent = opening ? 'Abrir divergência' : 'Registrar resposta';
    $('#cv-text').required = false;
    $('#cv-details-title').textContent = 'Observação / detalhes (opcional)';
    $('#cv-text').placeholder = 'Observação adicional, se necessário...';
    $('#cv-description-preview').textContent = '';
    if (opening) { renderTypes(); renderBuyers(); fillTypeDescription(); }
    if (responding) renderResponses();
    $('#cv-hint').textContent = closed
      ? 'Esta divergência já foi respondida; o relógio está encerrado. Para outro problema, use “+ Abrir nova divergência”. O histórico está disponível no painel Comercial.'
      : responding
        ? 'Selecione qualquer resposta ativa deste setor. Salvar encerra a ocorrência e para o relógio, independentemente do nome da resposta.'
        : 'Abrir a divergência inicia a contagem do setor. O Comercial não altera o chamado original no Infradesk.';
    if (responding && $('#cv-response').options.length <= 1) {
      $('#cv-hint').textContent = 'Nenhuma resposta ativa deste setor foi encontrada em respostas_v2. Cadastre a resposta no admin.html para encerrar o relógio.';
    }
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
    $('#cv-buyer-wrap').classList.toggle('cv-hidden',sector!=='comercial' || state.mode!=='abrir');
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
    const responses=state.catalog.responses.filter(r=>r.ativo!==false && r.setor===sector)
      .sort((a,b)=>trim(a.nome).localeCompare(trim(b.nome),'pt-BR'));
    select.replaceChildren(new Option(responses.length ? 'Selecione a resposta do setor' : 'Nenhuma resposta ativa cadastrada para este setor',''));
    responses.forEach(r=>select.add(new Option(r.nome,r.id)));
    if (!responses.length) $('#cv-hint').textContent = 'Não há respostas ativas deste setor em respostas_v2. Cadastre-as pelo admin.html antes de registrar o retorno.';
    renderResponseDetailRequirement();
  }
  async function save() {
    if (state.busy || !canRecord() || !state.data) return;
    const action=state.mode, old=state.selected, data=state.data;
    if (!['abrir','responder'].includes(action)) {
      return alertUser('Esta ocorrência já foi respondida. Para outro problema, abra uma nova divergência.',true);
    }
    const sector=$('#cv-sector').value, typeId=$('#cv-type').value;
    const buyerId=$('#cv-buyer').value, responseId=$('#cv-response').value;
    let details=trim($('#cv-text').value);
    const opening=action==='abrir';
    const type=state.catalog.types.find(x=>x.id===typeId);
    const buyer=state.buyers.get(buyerId)?.value || null;
    const response=state.catalog.responses.find(x=>x.id===responseId);
    if (opening && old) return alertUser('Selecione “+ Abrir nova divergência”.',true);
    if (!opening && (!old || !old.passagemAbertaId)) return alertUser('Esta divergência não tem relógio aberto. Atualize os dados.',true);
    if (opening && (!type || type.ativo===false || type.setor!==sector)) return alertUser('Escolha um tipo de divergência ativo deste setor.',true);
    if (opening && !sectors[sector]) return alertUser('Escolha o setor responsável.',true);
    if (opening && sector==='comercial' && (!buyer || buyer.ativo===false || !(state.supplier?.compradorIds||[]).includes(buyerId))) {
      return alertUser('Selecione um comprador ativo vinculado ao CNPJ.',true);
    }
    const responseSector=old?.setorAtual||old?.setor;
    if (!opening && (!response || response.ativo===false || response.setor!==responseSector)) {
      return alertUser('Escolha uma resposta ativa do setor responsável.',true);
    }
    if (!opening && isDevolverResponse(response) && !details) {
      return alertUser('Para Devolver e recusar, informe obrigatoriamente o motivo.',true);
    }
    if (!details) details = opening
      ? `Divergência aberta: ${type.nome}.`
      : `Resposta recebida: ${response.nome}.`;

    state.busy=true;
    $('#cv-save').disabled=true;
    $('#cv-save').textContent='Gravando...';
    const noteRef=db.collection('notas_v2').doc(data.chave);
    const divRef=old?db.collection('divergencias_v2').doc(old.id):db.collection('divergencias_v2').doc();
    const eventRef=db.collection('eventos_v2').doc();
    const nextPassRef=opening?db.collection('passagens_v2').doc():null;
    const currentPassRef=!opening&&old?.passagemAbertaId?db.collection('passagens_v2').doc(old.passagemAbertaId):null;
    const attribution=!opening&&erroCrf(response)?'crf_erro':(responseSector||sector);
    try {
      await db.runTransaction(async tx=>{
        // Leituras antes de gravar. Uma resposta e o fechamento do relógio são atômicos.
        const nSnap=await tx.get(noteRef);
        const dSnap=old?await tx.get(divRef):null;
        const pSnap=currentPassRef?await tx.get(currentPassRef):null;
        const supplierRef=db.collection('fornecedores_v2').doc(data.cnpj);
        const supplierSnap=!state.supplier?await tx.get(supplierRef):null;
        const prior=dSnap?.data()||null;
        if (!opening) {
          if (!dSnap?.exists) throw Error('Divergência não encontrada. Atualize a nota.');
          if (Number(prior.revisao||0)!==Number(old.revisao||0) || String(prior.passagemAbertaId||'')!==String(old.passagemAbertaId||'')) {
            throw Error('Outro operador já movimentou esta divergência. Atualize a nota.');
          }
          if (!prior.passagemAbertaId || !pSnap?.exists || pSnap.data().fimEm) {
            throw Error('A passagem já foi encerrada. Atualize a nota.');
          }
        }
        const now=FV.serverTimestamp();
        const opName=trim(state.profile?.nome||state.user.displayName||state.user.email);
        const supplierName=state.supplier?.razaoSocial||supplierSnap?.data()?.razaoSocial||data.fornecedorNome;
        if (!state.supplier && !supplierSnap?.exists) tx.set(supplierRef,{
          cnpj:data.cnpj,razaoSocial:data.fornecedorNome,nomeInfradesk:data.fornecedorNome,
          origemRazaoSocial:'infradesk',compradorIds:[],ativo:true,criadoEm:now,atualizadoEm:now
        });
        const noteData={
          chave:data.chave,cnpj:data.cnpj,numeroNf:data.numeroNf,serie:data.serie,
          fornecedorNome:supplierName,nomeInfradesk:data.fornecedorNome,
          fornecedorTexto:data.fornecedorTexto||data.fornecedorNome,
          empresa:data.empresa||'',statusInfradesk:data.statusInfradesk||'',
          ...(data.categoriaNota?{categoriaNota:data.categoriaNota,categoriaFornecedor:data.categoriaNota,tipoNota:data.categoriaNota}:{}),
          ultimaAcao:action,ultimaOcorrenciaTexto:details,atualizadoEm:now,versao:2
        };
        if (data.chamadoInfradeskId) noteData.chamadosInfradeskIds=FV.arrayUnion(data.chamadoInfradeskId);
        if (!nSnap.exists) tx.set(noteRef,{...noteData,criadoEm:now,divergenciasCount:opening?1:0});
        else tx.update(noteRef,{...noteData,...(opening?{divergenciasCount:FV.increment(1)}:{})});

        const buyerName=opening&&sector==='comercial'?(buyer?.nome||''):'';
        if (opening) {
          tx.set(divRef,{
            chave:data.chave,cnpj:data.cnpj,numeroNf:data.numeroNf,fornecedorNome:supplierName,
            criadoEm:now,atualizadoEm:now,abertoPor:state.user.uid,abertoPorNome:opName,
            setor:sector,tipoId:typeId,tipoNome:type.nome,categoriaNota:data.categoriaNota||'',
            compradorId:buyerId,compradorNome:buyerName,
            setorAtual:sector,compradorAtualId:buyerId,compradorAtualNome:buyerName,
            status:'aberta',passagemAbertaId:nextPassRef.id,passagensCount:1,revisao:1,
            ultimaOcorrenciaTexto:details,ultimaOcorrenciaEm:now
          });
          tx.set(nextPassRef,{
            chave:data.chave,divergenciaId:divRef.id,setor:sector,
            compradorId:sector==='comercial'?buyerId:'',compradorNome:buyerName,
            inicioEm:now,fimEm:null,criadoPor:state.user.uid,criadoPorNome:opName,
            chamadoInfradeskId:data.chamadoInfradeskId||''
          });
        } else {
          tx.update(divRef,{
            atualizadoEm:now,ultimaOcorrenciaTexto:details,ultimaOcorrenciaEm:now,
            status:'respondida',passagemAbertaId:null,
            ultimaRespostaId:response.id,ultimaRespostaNome:response.nome,encerradoEm:now,
            ...(data.categoriaNota&&!prior.categoriaNota?{categoriaNota:data.categoriaNota}:{}),
            revisao:FV.increment(1)
          });
          tx.update(currentPassRef,{
            fimEm:now,fechadoPor:state.user.uid,fechamento:'resposta',
            respostaId:response.id,respostaNome:response.nome,atribuicaoTempo:attribution
          });
        }
        tx.set(eventRef,{
          chave:data.chave,divergenciaId:divRef.id,acao:action,
          setor:opening?sector:responseSector,
          compradorId:opening?buyerId:(prior?.compradorAtualId||prior?.compradorId||''),
          compradorNome:opening?buyerName:(prior?.compradorAtualNome||prior?.compradorNome||''),
          respostaId:opening?'':response.id,respostaNome:opening?'':response.nome,
          atribuicaoTempo:opening?'':attribution,
          passagemId:opening?nextPassRef.id:(prior?.passagemAbertaId||''),
          texto:details,chamadoInfradeskId:data.chamadoInfradeskId||'',
          empresa:data.empresa||'',categoriaNota:data.categoriaNota||nSnap.data()?.categoriaNota||'',
          usuarioId:state.user.uid,usuarioNome:opName,usuarioEmail:state.user.email||'',criadoEm:now
        });
      });
      await loadNote();
      const summary=summarizeDivergences(state.divergences,state.data?.chave);
      rememberCardSummary(state.data?.chave,summary);
      renderCardBox(state.card,summary);
      alertUser(opening?'Divergência aberta. O relógio iniciou.':'Resposta registrada. Divergência respondida; relógio encerrado.');
      close(true);
    } catch(e) {
      console.error('[Comercial V2.4.1] Erro ao salvar:',e);
      alertUser(e?.code==='permission-denied'?'Acesso negado. Verifique as regras do Firestore.':(e.message||'Falha ao salvar'),true);
    } finally {
      state.busy=false;
      $('#cv-save').disabled=!canRecord();
      $('#cv-save').textContent=state.mode==='abrir'?'Abrir divergência':'Registrar resposta';
    }
  }
  function addButton(card) {
    if ($('.comercial-v2-button',card)) return;
    if (!extract(card)) return; // Sem Firebase. Apenas lê o HTML do Infradesk.
    const toolbar=$('.toolbar-atendente',card)||$('.list-toolbar',card)||card;
    const button=document.createElement('button');
    button.type='button';button.className='comercial-v2-button';button.title='Abrir Comercial';
    const icon=document.createElement('img');icon.src=ICON;icon.alt='Comercial';button.append(icon);
    button.onclick=e=>{e.preventDefault();e.stopPropagation();openCard(card);};
    const anchor=$('.btn-anexo', toolbar);
    if(anchor?.parentElement) anchor.insertAdjacentElement('beforebegin', button);
    else toolbar.append(button);
    renderCardFromCache(card);
  }
  function scan() { $$('.chamado-item[data-chamado-id]').forEach(card => { addButton(card); renderCardFromCache(card); }); }
  let timer=null;
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{scan();refreshVisibleCards(false);},500);});
  window.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(()=>{scan();refreshVisibleCards(false);},450);},{passive:true});
  auth.onAuthStateChanged(async user=>{
    if (!user || state.user?.uid!==user.uid) {
      state.user=user;state.profile=null;state.profileAt=0;
      state.catalog.expiresAt=0;state.buyers.clear();
    }
    // Uma leitura do próprio perfil quando o usuário entra; sem monitoramento constante.
    try { if(user) await loadProfile(); } catch(e) { console.warn('[Comercial] Perfil não carregado:',e); }
    renderSession();
    if (user && state.profile) void refreshVisibleCards(false);
  });
  function boot() {
    createUI();scan();observer.observe(document.body,{childList:true,subtree:true});
    console.info('[Comercial V2.4.1] Pronto. Cards consultam apenas chaves visíveis, sem listeners em tempo real.');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
