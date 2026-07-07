// ==UserScript==
// @name         Comercial • Infradesk → Divergências NF
// @namespace    comercial/infradesk
// @version      1.0.6
// @description  Comercial Infradesk: abre divergências comerciais/cadastro no Firebase, com login Google/e-mail e loader page-context.
// @author       Comercial
// @match        https://*.infradesk.app/backend/chamados/painel*
// @match        https://*.infradesk.app/backend/chamados*
// @run-at       document-end
// @icon         https://unix-page.github.io/comercial/comercial.png
// @homepageURL  https://unix-page.github.io/comercial/
// @updateURL    https://unix-page.github.io/comercial/comercial.js
// @downloadURL  https://unix-page.github.io/comercial/comercial.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.__COMERCIAL_APP_RUNNING__) {
    console.warn('[Comercial] Já existe uma instância ativa nesta página. Ignorando segunda carga.');
    return;
  }

  window.__COMERCIAL_APP_RUNNING__ = true;
  window.__COMERCIAL_APP_STARTED_AT__ = Date.now();
  window.__COMERCIAL_APP_EXECUTION_MODE__ = window.__COMERCIAL_REMOTE_LOADER_ACTIVE__ ? 'loader-page-context' : 'tampermonkey-direto';

  /********************************************************************
   * CONFIGURAÇÕES
   ********************************************************************/
  const COMERCIAL_VERSION = window.__COMERCIAL_REMOTE_VERSION__ || '1.0.6-chave-unica';
  const COMERCIAL_ICON_URL = 'https://unix-page.github.io/comercial/comercial.png';
  const COMERCIAL_UPDATE_URL = 'https://unix-page.github.io/comercial/comercial.js';

  const COMERCIAL_TARGET_STATUS_ID = '6';
  const COMERCIAL_TARGET_STATUS_DESC = 'em analise terceiro';

  const TIPO_CHAMADO = 'nf_divergencia_comercial';
  const TIPO_CHAMADO_NOME = 'NF • Divergência Comercial';

  const COMERCIAL_FIREBASE_APP_NAME = 'comercial-divergencias-app';

  const COMERCIAL_PROFILE_CACHE_PREFIX = 'comercial_profile_v1_';
  const COMERCIAL_PROFILE_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

  const COMERCIAL_CACHE_KEY = 'comercial_chamados_cache_v1';
  const COMERCIAL_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
  const MAX_VISIBLE_ACTIVE_MONITORS = 12;
  const MAX_VISIBLE_LOOKUPS_PER_SCAN = 10;
  const COMERCIAL_CHAVE_LOOKUP_TTL_MS = 1000 * 60 * 2;

  const firebaseConfig = {
    apiKey: 'AIzaSyBpWLYK1cejNpUAo5NMk8ecSSQrYMVf6-0',
    authDomain: 'comercial-divergencias.firebaseapp.com',
    projectId: 'comercial-divergencias',
    storageBucket: 'comercial-divergencias.firebasestorage.app',
    messagingSenderId: '602637992147',
    appId: '1:602637992147:web:fc930856cc72f598a31426'
  };

    const DEFAULT_DIVERGENCIAS = {
    compras: {
      nome: 'Compras',
      tipos: [
        { id: 'nota_sem_pedido', nome: 'Nota sem pedido' },
        { id: 'item_sem_pedido', nome: 'Item sem pedido' },
        { id: 'valor_divergente', nome: 'Valor divergente' }
      ]
    },
    cadastro: {
      nome: 'Cadastro',
      tipos: [
        { id: 'produto_nao_cadastrado', nome: 'Produto não cadastrado' },
        { id: 'fornecedor_sem_cadastro', nome: 'Fornecedor sem cadastro' }
      ]
    }
  };

  const STATUS_LABELS = {
    aberto: 'Aberto',
    reaberto: 'Reaberto',
    em_tratamento: 'Em tratamento',
    informacoes_divergentes: 'Informação divergente',
    pedido_corrigido: 'Pedido corrigido',
    pronto: 'Pronto',
    devolver_recusar: 'Devolver e recusar',

    // Compatibilidade com versões antigas do site.
    resolvido: 'Resolvido',
    cancelado: 'Cancelado'
  };

  const ACTIVE_STATUS_VALUES = ['aberto', 'reaberto', 'em_tratamento'];
  const FINAL_STATUS_VALUES = ['informacoes_divergentes', 'pedido_corrigido', 'pronto', 'devolver_recusar', 'resolvido', 'cancelado'];

  const state = {
    authReady: false,
    user: null,
    profile: null,
    profileLoading: null,
    ticketDocUnsubs: new Map(),
    userTicketsByChave: new Map(),
    userTicketsById: new Map(),
    chaveLookupAt: new Map(),
    chaveLookupPromises: new Map(),
    activeCard: null,
    activeData: null,
    activeFornecedor: null,
    activeFornecedorRef: null,
    divergenciasConfig: null,
    divergenciasConfigExists: false,
    divergenciasLoading: null,
    compradoresConfig: null,
    compradoresLoading: null,
    isSaving: false,
    scanTimer: null
  };

  /********************************************************************
   * FIREBASE
   * Usamos APP NOMEADO para não misturar com o Firebase do Xabuia.
   ********************************************************************/
  function getComercialFirebaseApp() {
    try {
      return firebase.app(COMERCIAL_FIREBASE_APP_NAME);
    } catch (_) {
      return firebase.initializeApp(firebaseConfig, COMERCIAL_FIREBASE_APP_NAME);
    }
  }

  const app = getComercialFirebaseApp();
  const auth = firebase.auth(app);
  const db = firebase.firestore(app);
  auth.languageCode = 'pt-BR';

  auth.onAuthStateChanged((user) => {
    state.authReady = true;
    state.user = user || null;
    state.profile = user ? readCachedProfile(user.uid) : null;
    state.profileLoading = null;
    state.userTicketsByChave.clear();
    state.userTicketsById.clear();
    state.chaveLookupAt.clear();
    state.chaveLookupPromises.clear();
    stopAllTicketMonitors();

    if (!user) {
      state.profile = null;
      state.activeFornecedor = null;
      state.activeFornecedorRef = null;
      state.compradoresConfig = null;
    }

    renderAuthInfo();
    scanCards();
  });

  /********************************************************************
   * UTILITÁRIOS
   ********************************************************************/
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function digitsOnly(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeAscii(value) {
    return normalizeText(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeStatusText(value) {
    return normalizeAscii(value);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function safeDocPart(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'item';
  }

  function hashText(value) {
    let hash = 0x811c9dc5;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isActiveComercialStatus(status) {
    return ACTIVE_STATUS_VALUES.includes(String(status || ''));
  }

  function isFinalComercialStatus(status) {
    return FINAL_STATUS_VALUES.includes(String(status || ''));
  }

  function selectedUserName() {
    return state.profile?.nome || state.user?.displayName || state.user?.email || 'Usuário';
  }

  function isAdmin() {
    return state.profile?.ativo !== false && state.profile?.papel === 'admin';
  }

  function canOpenTicket() {
    if (!state.user || !state.profile || state.profile.ativo === false) return false;
    return state.profile.papel === 'admin' || state.profile.papel === 'crf' || state.profile.podeAbrir === true;
  }

  function canTreatFila(fila) {
    if (!state.user || !state.profile || state.profile.ativo === false) return false;
    if (state.profile.papel === 'admin') return true;
    return Array.isArray(state.profile.filasTratamento) && state.profile.filasTratamento.includes(fila);
  }

  function statusAfterInfradeskOccurrence(existsBefore, previousStatus) {
    const current = String(previousStatus || '');
    if (!existsBefore) return 'aberto';
    if (isActiveComercialStatus(current)) return current;
    return 'reaberto';
  }

  function historyTypeForStatus(status, existsBefore, previousStatus = '') {
    if (!existsBefore && status === 'aberto') return 'criacao';
    if (status === 'reaberto' && previousStatus !== 'reaberto') return 'reabertura';
    return existsBefore ? 'observacao' : 'criacao';
  }

  function ticketStatusPayload(status) {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const payload = { status, atualizadoEm: now };

    if (status === 'reaberto') {
      payload.reabertoPor = state.user.uid;
      payload.reabertoPorNome = selectedUserName();
      payload.reabertoPorEmail = state.user.email;
      payload.reabertoEm = now;
      payload.operadorTratamentoId = null;
      payload.operadorTratamentoNome = null;
      payload.operadorTratamentoEmail = null;
      payload.tratamentoIniciadoEm = null;
    }

    if (status === 'aberto') {
      payload.operadorTratamentoId = null;
      payload.operadorTratamentoNome = null;
      payload.operadorTratamentoEmail = null;
      payload.tratamentoIniciadoEm = null;
    }

    return payload;
  }

  function canonicalCategoria(value) {
    // Categoria/tipo da nota vem direto do card do Infradesk.
    // Não transformamos em lista fixa, porque é o tipo real que controla o SLA.
    return normalizeText(value || '');
  }

  function parseNfeKey(chave) {
    const digits = digitsOnly(chave);
    if (digits.length !== 44) return null;

    const numeroRaw = digits.slice(25, 34);
    const numero = Number.parseInt(numeroRaw, 10);

    return {
      chave: digits,
      cnpj: digits.slice(6, 20),
      modelo: digits.slice(20, 22),
      serie: digits.slice(22, 25),
      numero: Number.isFinite(numero) ? String(numero) : numeroRaw
    };
  }

  function cleanFornecedorName(text) {
    return normalizeText(text)
      .replace(/^#?\d+\s+/, '')
      .replace(/^#?\d+$/, '')
      .trim();
  }

  function parseFornecedor(card) {
    const link = $('.item-data-fornecedor', card);
    const href = link?.getAttribute('href') || '';
    const hrefId = href.match(/\/fornecedores\/contato\/(\d+)/i)?.[1] || '';
    const rawText = normalizeText(link?.textContent || '');
    const textId = rawText.match(/#\s*(\d+)/)?.[1] || '';
    const fornecedorId = hrefId || textId || '';
    const fornecedorNome = cleanFornecedorName(rawText) || rawText || 'Fornecedor não identificado';

    return { fornecedorId, fornecedorNome, fornecedorTexto: rawText };
  }

  function parseCard(card) {
    const fullText = card.innerText || '';
    const directMatch = fullText.match(/\b\d{44}\b/);
    const chave = directMatch ? directMatch[0] : '';
    const parsed = parseNfeKey(chave);
    const fornecedor = parseFornecedor(card);

    const categoriaRaw = normalizeText(
      $('.item-subcategoria', card)?.getAttribute('title') ||
      $('.item-subcategoria', card)?.textContent ||
      ''
    );

    return {
      chamadoId: card.getAttribute('data-chamado-id') || '',
      chave,
      parsed,
      numeroNf: parsed?.numero || '',
      cnpj: parsed?.cnpj || '',
      empresa: normalizeText($('.item-data-empresa', card)?.textContent || ''),
      fornecedorId: fornecedor.fornecedorId,
      fornecedorNome: fornecedor.fornecedorNome,
      fornecedorTexto: fornecedor.fornecedorTexto,
      categoriaFornecedor: canonicalCategoria(categoriaRaw),
      statusInfradesk: normalizeText(card.closest('ul[data-status-descricao]')?.getAttribute('data-status-descricao') || ''),
      ultimaDescricao: normalizeText($('.item-ultima-descricao-copy', card)?.textContent || ''),
      aberturaTexto: normalizeText($('.item-data-abertura', card)?.textContent || '')
    };
  }

  function cardStatusInfo(card) {
    const ul = card?.closest?.('ul.list-status-chamados[data-status-id], ul[data-status-id]');
    const statusId = normalizeText(ul?.getAttribute('data-status-id') || '');
    const statusDesc = normalizeStatusText(ul?.getAttribute('data-status-descricao') || '');
    return { ul, statusId, statusDesc };
  }

  function isTargetCard(card) {
    const info = cardStatusInfo(card);
    return info.statusId === COMERCIAL_TARGET_STATUS_ID || info.statusDesc.includes(COMERCIAL_TARGET_STATUS_DESC);
  }

  function targetCards() {
    return $$('.chamado-item[data-chamado-id]').filter((card) => isTargetCard(card));
  }

  function comercialDocId(chave, fila, tipoDivergencia) {
    // Compatibilidade com versões antigas que criavam um documento por chave+fila+tipo.
    return `nf_${hashText(`${TIPO_CHAMADO}:${digitsOnly(chave)}:${fila}:${tipoDivergencia}`)}`;
  }

  function comercialDocIdUnico(chave) {
    // V1.0.6: documento canônico por chave NF-e.
    // Isso impede abrir a mesma nota duas vezes daqui pra frente.
    return `nf_${hashText(`${TIPO_CHAMADO}:${digitsOnly(chave)}`)}`;
  }

  function typedChaveBusca(chave) {
    return `${TIPO_CHAMADO}:${digitsOnly(chave)}`;
  }

  function fornecedorDocId(data) {
    // O vínculo de comprador é por CNPJ da NF, não só pelo cadastro interno do fornecedor.
    // Assim um mesmo fornecedor pode ter compradores diferentes conforme o CNPJ da nota.
    if (data?.cnpj) return `cnpj_${safeDocPart(data.cnpj)}`;
    if (data?.fornecedorId) return `fornecedor_${safeDocPart(data.fornecedorId)}`;
    return `fornecedor_${hashText(data?.fornecedorNome || data?.fornecedorTexto || 'sem-fornecedor')}`;
  }

  /********************************************************************
   * CACHE LOCAL
   ********************************************************************/
  function readCache() {
    try { return JSON.parse(localStorage.getItem(COMERCIAL_CACHE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  function writeCache(cache) {
    try { localStorage.setItem(COMERCIAL_CACHE_KEY, JSON.stringify(cache || {})); } catch (_) {}
  }

  function cacheKey(chave) {
    const clean = digitsOnly(chave);
    return clean ? `chave:${clean}` : '';
  }

  function rememberTicket(ticket) {
    const key = cacheKey(ticket?.chave);
    if (!key || !ticket?.id) return;

    const now = Date.now();
    const compact = {
      ...ticket,
      atualizadoEmMs: toMillis(ticket.atualizadoEm) || Number(ticket.atualizadoEmMs || 0) || now,
      ultimaOcorrenciaEmMs: toMillis(ticket.ultimaOcorrenciaEm) || Number(ticket.ultimaOcorrenciaEmMs || 0) || toMillis(ticket.atualizadoEm) || now
    };

    rememberTicketInMaps(compact);

    const cache = readCache();
    const entry = cache[key] || { cachedAt: now, tickets: [] };
    const tickets = Array.isArray(entry.tickets) ? entry.tickets : [];

    const nextTickets = [compact, ...tickets.filter((item) => item?.id !== ticket.id)].slice(0, 8);
    cache[key] = { cachedAt: now, tickets: nextTickets };

    Object.keys(cache).forEach((itemKey) => {
      if (!cache[itemKey]?.cachedAt || now - Number(cache[itemKey].cachedAt) > COMERCIAL_CACHE_TTL_MS) delete cache[itemKey];
    });

    writeCache(cache);
  }

  function cachedTickets(chave) {
    const key = cacheKey(chave);
    if (!key) return [];

    const entry = readCache()[key];
    if (!entry || Date.now() - Number(entry.cachedAt || 0) > COMERCIAL_CACHE_TTL_MS) return [];

    return Array.isArray(entry.tickets) ? entry.tickets : [];
  }

  function clearCachedTicketsForChave(chave) {
    const clean = digitsOnly(chave || '');
    const key = cacheKey(clean);

    if (key) {
      const cache = readCache();
      if (cache[key]) {
        delete cache[key];
        writeCache(cache);
      }
    }

    state.userTicketsByChave.delete(clean);

    for (const [id, ticket] of state.userTicketsById.entries()) {
      if (digitsOnly(ticket?.chave || '') === clean) state.userTicketsById.delete(id);
    }

    state.chaveLookupAt.delete(clean);
  }

  function forgetTicketFromCache(chave, ticketId) {
    const clean = digitsOnly(chave || '');
    const id = String(ticketId || '');
    if (!clean || !id) return;

    const key = cacheKey(clean);
    if (key) {
      const cache = readCache();
      const entry = cache[key];
      if (entry && Array.isArray(entry.tickets)) {
        entry.tickets = entry.tickets.filter((ticket) => ticket?.id !== id);
        if (entry.tickets.length) cache[key] = entry;
        else delete cache[key];
        writeCache(cache);
      }
    }

    const list = state.userTicketsByChave.get(clean) || [];
    const next = list.filter((ticket) => ticket?.id !== id);
    if (next.length) state.userTicketsByChave.set(clean, next);
    else state.userTicketsByChave.delete(clean);

    state.userTicketsById.delete(id);
  }

  function rememberTicketInMaps(ticket) {
    if (!ticket?.id) return;

    state.userTicketsById.set(ticket.id, ticket);

    const clean = digitsOnly(ticket.chave || '');
    if (!clean) return;

    const list = state.userTicketsByChave.get(clean) || [];
    const next = [ticket, ...list.filter((item) => item?.id !== ticket.id)].slice(0, 12);
    state.userTicketsByChave.set(clean, next);
  }

  function ticketRecencyMs(ticket) {
    return toMillis(ticket?.ultimaOcorrenciaEm)
      || Number(ticket?.ultimaOcorrenciaEmMs || 0)
      || toMillis(ticket?.atualizadoEm)
      || Number(ticket?.atualizadoEmMs || 0)
      || toMillis(ticket?.criadoEm)
      || 0;
  }

  function knownTickets(chave) {
    const clean = digitsOnly(chave || '');
    const fromMap = clean ? (state.userTicketsByChave.get(clean) || []) : [];
    const fromCache = cachedTickets(clean);
    const byId = new Map();

    [...fromMap, ...fromCache].forEach((ticket) => {
      if (ticket?.id && !byId.has(ticket.id)) byId.set(ticket.id, ticket);
    });

    return [...byId.values()].sort((a, b) => {
      const activeDiff = Number(isActiveComercialStatus(b.status)) - Number(isActiveComercialStatus(a.status));
      if (activeDiff !== 0) return activeDiff;
      return ticketRecencyMs(b) - ticketRecencyMs(a);
    });
  }

  function cardsWithChave(chave) {
    const clean = digitsOnly(chave || '');
    if (!clean) return [];
    return targetCards().filter((card) => digitsOnly(parseCard(card).chave) === clean);
  }

  function renderCardsForChave(chave) {
    cardsWithChave(chave).forEach(renderCardFromKnownTickets);
  }

  function uniqueVisibleChaves() {
    const seen = new Set();
    const out = [];

    targetCards().forEach((card) => {
      const chave = digitsOnly(parseCard(card).chave);
      if (chave && !seen.has(chave)) {
        seen.add(chave);
        out.push(chave);
      }
    });

    return out;
  }

  function chooseMainTicketForChave(tickets = []) {
    const list = tickets.filter((ticket) => ticket?.id);
    if (!list.length) return null;

    return [...list].sort((a, b) => {
      const activeDiff = Number(isActiveComercialStatus(b.status)) - Number(isActiveComercialStatus(a.status));
      if (activeDiff !== 0) return activeDiff;

      const finalDiff = Number(isFinalComercialStatus(a.status)) - Number(isFinalComercialStatus(b.status));
      if (finalDiff !== 0) return finalDiff;

      return ticketRecencyMs(b) - ticketRecencyMs(a);
    })[0];
  }

  function shouldMonitorTicket(ticket) {
    return !!(ticket?.id && ticket?.chave && isActiveComercialStatus(ticket.status));
  }

  function startTicketMonitor(ref, seedTicket = null) {
    if (!ref || !seedTicket?.id || !shouldMonitorTicket(seedTicket)) return;
    if (state.ticketDocUnsubs.has(ref.id)) return;

    const unsub = ref.onSnapshot((snap) => {
      if (!snap.exists) {
        const currentUnsub = state.ticketDocUnsubs.get(ref.id);
        if (currentUnsub) {
          try { currentUnsub(); } catch (_) {}
          state.ticketDocUnsubs.delete(ref.id);
        }
        return;
      }

      const ticket = { id: snap.id, ...snap.data() };
      rememberTicketInMaps(ticket);
      rememberTicket(ticket);
      renderCardsForChave(ticket.chave);

      if (!isActiveComercialStatus(ticket.status)) {
        const currentUnsub = state.ticketDocUnsubs.get(ref.id);
        if (currentUnsub) {
          try { currentUnsub(); } catch (_) {}
          state.ticketDocUnsubs.delete(ref.id);
        }
      }
    }, (error) => {
      console.warn('[Comercial] Monitor do chamado falhou:', error);
      const currentUnsub = state.ticketDocUnsubs.get(ref.id);
      if (currentUnsub) {
        try { currentUnsub(); } catch (_) {}
        state.ticketDocUnsubs.delete(ref.id);
      }
    });

    state.ticketDocUnsubs.set(ref.id, unsub);
  }

  function stopAllTicketMonitors() {
    state.ticketDocUnsubs.forEach((unsub) => {
      try { unsub(); } catch (_) {}
    });
    state.ticketDocUnsubs.clear();
  }

  function syncVisibleKnownMonitors() {
    if (!state.user || !state.profile) {
      stopAllTicketMonitors();
      return;
    }

    const desired = new Map();

    for (const card of targetCards()) {
      if (desired.size >= MAX_VISIBLE_ACTIVE_MONITORS) break;

      const data = parseCard(card);
      for (const ticket of knownTickets(data.chave)) {
        if (desired.size >= MAX_VISIBLE_ACTIVE_MONITORS) break;
        if (!shouldMonitorTicket(ticket)) continue;

        const ref = db.collection('comercial_chamados').doc(ticket.id);
        desired.set(ref.id, { ref, ticket });
      }
    }

    state.ticketDocUnsubs.forEach((unsub, id) => {
      if (!desired.has(id)) {
        try { unsub(); } catch (_) {}
        state.ticketDocUnsubs.delete(id);
      }
    });

    desired.forEach(({ ref, ticket }) => startTicketMonitor(ref, ticket));
  }

  function renderTargetCardsFromKnownTickets() {
    targetCards().forEach(renderCardFromKnownTickets);
  }

  async function readTicketRefIfExists(ref) {
    try {
      const snap = await ref.get();
      return snap.exists ? { ref, ticket: { id: snap.id, ...snap.data() } } : null;
    } catch (error) {
      console.warn('[Comercial] Não consegui ler chamado por referência:', error);
      return null;
    }
  }

  async function lookupTicketsByChave(chave, force = false) {
    const clean = digitsOnly(chave || '');
    if (!clean || !state.user || !state.profile) return [];

    const nowMs = Date.now();
    const last = Number(state.chaveLookupAt.get(clean) || 0);

    if (!force && last && nowMs - last < COMERCIAL_CHAVE_LOOKUP_TTL_MS) {
      return knownTickets(clean);
    }

    if (state.chaveLookupPromises.has(clean)) {
      return state.chaveLookupPromises.get(clean);
    }

    const task = (async () => {
      state.chaveLookupAt.set(clean, Date.now());

      const found = new Map();
      const staleIds = [];

      const addTicket = (ticket) => {
        if (ticket?.id && !found.has(ticket.id)) {
          found.set(ticket.id, ticket);
          rememberTicket(ticket);
        }
      };

      const canonicalRef = db.collection('comercial_chamados').doc(comercialDocIdUnico(clean));
      const canonical = await readTicketRefIfExists(canonicalRef);
      if (canonical?.ticket) addTicket(canonical.ticket);

      // Verifica tickets do cache local. Se o documento foi apagado no Firebase,
      // o cache local é removido para não tentar atualizar registro inexistente.
      for (const cached of knownTickets(clean).slice(0, 8)) {
        if (!cached?.id || found.has(cached.id)) continue;
        const checked = await readTicketRefIfExists(db.collection('comercial_chamados').doc(cached.id));
        if (checked?.ticket) addTicket(checked.ticket);
        else staleIds.push(cached.id);
      }

      try {
        const snap = await db.collection('comercial_chamados')
          .where('chaveBusca', '==', typedChaveBusca(clean))
          .limit(8)
          .get();

        snap.forEach((docSnap) => addTicket({ id: docSnap.id, ...docSnap.data() }));
      } catch (error) {
        console.warn('[Comercial] Consulta por chaveBusca falhou:', error);
      }

      if (found.size === 0) {
        clearCachedTicketsForChave(clean);
      } else {
        staleIds.forEach((id) => forgetTicketFromCache(clean, id));
      }

      renderCardsForChave(clean);
      syncVisibleKnownMonitors();

      return [...found.values()];
    })().finally(() => {
      state.chaveLookupPromises.delete(clean);
    });

    state.chaveLookupPromises.set(clean, task);
    return task;
  }

  function syncVisibleCardLookups(force = false) {
    if (!state.user || !state.profile || state.profile.ativo === false) return;

    uniqueVisibleChaves()
      .slice(0, MAX_VISIBLE_LOOKUPS_PER_SCAN)
      .forEach((chave) => {
        lookupTicketsByChave(chave, force).catch((error) => {
          console.warn('[Comercial] Lookup visível falhou:', error);
        });
      });
  }

  async function findExistingTicketForSave(chave) {
    const clean = digitsOnly(chave || '');

    // Força consulta no banco. O localStorage nunca decide sozinho se existe chamado.
    const freshTickets = await lookupTicketsByChave(clean, true);

    const mainTicket = chooseMainTicketForChave(freshTickets);

    if (mainTicket?.id) {
      return {
        exists: true,
        ref: db.collection('comercial_chamados').doc(mainTicket.id),
        ticket: mainTicket
      };
    }

    clearCachedTicketsForChave(clean);
    const ref = db.collection('comercial_chamados').doc(comercialDocIdUnico(clean));
    return { exists: false, ref, ticket: null };
  }

  /********************************************************************
   * PERFIL
   ********************************************************************/
  function profileCacheKey(uid) {
    return `${COMERCIAL_PROFILE_CACHE_PREFIX}${uid || 'anon'}`;
  }

  function readCachedProfile(uid) {
    if (!uid) return null;
    try {
      const raw = localStorage.getItem(profileCacheKey(uid));
      const entry = raw ? JSON.parse(raw) : null;
      if (!entry?.profile || !entry.cachedAt) return null;
      if (Date.now() - Number(entry.cachedAt) > COMERCIAL_PROFILE_CACHE_TTL_MS) return null;
      return entry.profile;
    } catch (_) {
      return null;
    }
  }

  function writeCachedProfile(uid, profile) {
    if (!uid || !profile) return;
    try {
      localStorage.setItem(profileCacheKey(uid), JSON.stringify({ cachedAt: Date.now(), profile }));
    } catch (_) {}
  }

  async function loadProfileIfNeeded(force = false) {
    if (!state.user) return null;
    if (!force && state.profile) return state.profile;

    if (!force) {
      const cached = readCachedProfile(state.user.uid);
      if (cached) {
        state.profile = cached;
        return state.profile;
      }
    }

    if (state.profileLoading) return state.profileLoading;

    state.profileLoading = (async () => {
      try {
        const snap = await db.collection('usuarios').doc(state.user.uid).get();
        state.profile = snap.exists ? { id: snap.id, ...snap.data() } : null;
        writeCachedProfile(state.user.uid, state.profile);
        return state.profile;
      } catch (error) {
        console.warn('[Comercial] Erro ao carregar perfil:', error);
        return null;
      } finally {
        state.profileLoading = null;
      }
    })();

    return state.profileLoading;
  }

  /********************************************************************
   * CONFIGURAÇÃO DE DIVERGÊNCIAS
   ********************************************************************/
  async function loadDivergenciasConfig(force = false) {
    if (!force && state.divergenciasConfig) return state.divergenciasConfig;
    if (state.divergenciasLoading) return state.divergenciasLoading;

    state.divergenciasLoading = (async () => {
      try {
        if (!state.user || !state.profile) {
          state.divergenciasConfig = cloneData(DEFAULT_DIVERGENCIAS);
          state.divergenciasConfigExists = false;
          return state.divergenciasConfig;
        }

        const snap = await db.collection('config').doc('divergencias').get();

        if (snap.exists && snap.data()?.filas) {
          state.divergenciasConfig = normalizeDivergenciasConfig(snap.data().filas);
          state.divergenciasConfigExists = true;
        } else {
          state.divergenciasConfig = cloneData(DEFAULT_DIVERGENCIAS);
          state.divergenciasConfigExists = false;
        }

        return state.divergenciasConfig;
      } catch (error) {
        console.warn('[Comercial] Não consegui carregar config/divergencias. Usando lista padrão:', error);
        state.divergenciasConfig = cloneData(DEFAULT_DIVERGENCIAS);
        state.divergenciasConfigExists = false;
        return state.divergenciasConfig;
      } finally {
        state.divergenciasLoading = null;
      }
    })();

    return state.divergenciasLoading;
  }

  function normalizeDivergenciasConfig(config) {
    const source = config || {};
    const out = cloneData(DEFAULT_DIVERGENCIAS);

    ['compras', 'cadastro'].forEach((fila) => {
      if (source[fila]?.nome) out[fila].nome = normalizeText(source[fila].nome);
      if (Array.isArray(source[fila]?.tipos)) {
        out[fila].tipos = source[fila].tipos
          .map((item) => ({
            id: safeDocPart(item?.id || item?.nome || ''),
            nome: normalizeText(item?.nome || item?.id || '')
          }))
          .filter((item) => item.id && item.nome);
      }
    });

    return out;
  }

  async function saveDivergenciasConfig(config) {
    if (!isAdmin()) {
      showToast('Somente admin pode alterar a lista de divergências.', 'error');
      return;
    }

    const finalConfig = normalizeDivergenciasConfig(config);

    await db.collection('config').doc('divergencias').set({
      filas: finalConfig,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      atualizadoPor: state.user.uid,
      atualizadoPorEmail: state.user.email
    }, { merge: false });

    state.divergenciasConfig = finalConfig;
    state.divergenciasConfigExists = true;
    renderFilaOptions();
    renderDivergenciaOptions();
    renderConfigControls();

    renderTypeManager();
    showToast('Lista de divergências atualizada.', 'success');
  }

  async function createDefaultConfig() {
    await saveDivergenciasConfig(cloneData(DEFAULT_DIVERGENCIAS));
    renderTypeManager();
  }

  function openTypeManager() {
    if (!isAdmin()) return showToast('Somente admin pode gerenciar tipos de divergência.', 'error');
    renderTypeManager();
    $('#comercial-type-manager-overlay')?.classList.add('open');
    setTimeout(() => $('#comercial-type-new-name')?.focus(), 80);
  }

  function closeTypeManager() {
    $('#comercial-type-manager-overlay')?.classList.remove('open');
  }

  function currentTypeManagerFila() {
    const raw = $('#comercial-type-manager-fila')?.value || $('#comercial-fila')?.value || 'compras';
    return ['compras', 'cadastro'].includes(raw) ? raw : 'compras';
  }

  function renderTypeManager() {
    const filaSelect = $('#comercial-type-manager-fila');
    const list = $('#comercial-type-manager-list');
    const defaultBtn = $('#comercial-create-default-list');
    if (!filaSelect || !list) return;

    const config = normalizeDivergenciasConfig(state.divergenciasConfig || DEFAULT_DIVERGENCIAS);
    const currentMainFila = $('#comercial-fila')?.value || 'compras';

    if (!filaSelect.dataset.ready) {
      filaSelect.innerHTML = '';
      Object.entries(config).forEach(([fila, def]) => {
        const opt = document.createElement('option');
        opt.value = fila;
        opt.textContent = def.nome || fila;
        filaSelect.appendChild(opt);
      });
      filaSelect.dataset.ready = '1';
    }

    if (!filaSelect.value) filaSelect.value = currentMainFila;
    if (!config[filaSelect.value]) filaSelect.value = 'compras';

    const fila = currentTypeManagerFila();
    const tipos = config[fila]?.tipos || [];
    list.innerHTML = '';

    if (defaultBtn) defaultBtn.style.display = state.divergenciasConfigExists ? 'none' : '';

    tipos.forEach((tipo) => {
      const row = document.createElement('div');
      row.className = 'comercial-manager-row';
      row.innerHTML = `
        <span class="comercial-manager-name">${escapeHtml(tipo.nome)}</span>
        <button class="comercial-manager-delete" type="button" data-fila="${escapeHtml(fila)}" data-tipo="${escapeHtml(tipo.id)}" title="Excluir tipo">Excluir</button>
      `;
      list.appendChild(row);
    });

    if (!tipos.length) {
      list.innerHTML = '<div class="comercial-manager-empty">Nenhum tipo cadastrado para esta fila.</div>';
    }
  }

  async function addDivergenceTypeFromManager() {
    if (!isAdmin()) return showToast('Somente admin pode criar tipo de divergência.', 'error');

    const fila = currentTypeManagerFila();
    const input = $('#comercial-type-new-name');
    const nome = normalizeText(input?.value || '');
    if (!nome) {
      input?.focus();
      return showToast('Digite o nome do novo tipo.', 'error');
    }

    const config = normalizeDivergenciasConfig(state.divergenciasConfig || DEFAULT_DIVERGENCIAS);
    const id = safeDocPart(nome);

    if (config[fila].tipos.some((item) => item.id === id || normalizeAscii(item.nome) === normalizeAscii(nome))) {
      showToast('Esse tipo já existe nesta fila.', 'error');
      return;
    }

    config[fila].tipos.push({ id, nome });
    await saveDivergenciasConfig(config);

    // V1.0.4: criar tipo no gerenciador NÃO seleciona automaticamente no formulário principal.
    // O usuário escolhe manualmente a fila e o tipo para evitar abertura acidental.
    renderFilaOptions();
    renderDivergenciaOptions();

    if (input) input.value = '';
    const filaSelect = $('#comercial-type-manager-fila');
    if (filaSelect) filaSelect.value = fila;
    renderTypeManager();
  }

  async function deleteDivergenceTypeFromManager(fila, tipo) {
    if (!isAdmin()) return showToast('Somente admin pode excluir tipo de divergência.', 'error');
    const config = normalizeDivergenciasConfig(state.divergenciasConfig || DEFAULT_DIVERGENCIAS);
    if (!config[fila]) return;

    const current = config[fila].tipos.find((item) => item.id === tipo);
    if (!current) return;

    if (config[fila].tipos.length <= 1) {
      showToast('A fila precisa ter pelo menos um tipo.', 'error');
      return;
    }

    if (!confirm(`Excluir o tipo "${current.nome}" da fila ${config[fila].nome || fila}?`)) return;

    config[fila].tipos = config[fila].tipos.filter((item) => item.id !== tipo);
    await saveDivergenciasConfig(config);
    renderTypeManager();
  }

  // Mantidos como atalhos/fallback, mas agora abrem o gerenciador bonito.
  async function addDivergenceType() { openTypeManager(); }
  async function deleteSelectedDivergenceType() { openTypeManager(); }

  /********************************************************************
   * COMPRADORES E VÍNCULO POR CNPJ
   ********************************************************************/
  async function loadCompradoresConfig(force = false) {
    if (!force && Array.isArray(state.compradoresConfig)) return state.compradoresConfig;
    if (state.compradoresLoading) return state.compradoresLoading;

    state.compradoresLoading = (async () => {
      try {
        if (!state.user || !state.profile) {
          state.compradoresConfig = [];
          return state.compradoresConfig;
        }

        const snap = await db.collection('compradores').get();
        state.compradoresConfig = snap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((item) => item && item.ativo !== false && normalizeText(item.nome))
          .sort((a, b) => normalizeText(a.nome).localeCompare(normalizeText(b.nome), 'pt-BR'));

        return state.compradoresConfig;
      } catch (error) {
        console.warn('[Comercial] Não consegui carregar lista de compradores:', error);
        state.compradoresConfig = [];
        return state.compradoresConfig;
      } finally {
        state.compradoresLoading = null;
      }
    })();

    return state.compradoresLoading;
  }

  function allCompradores() {
    return (state.compradoresConfig || [])
      .filter((item) => item && item.ativo !== false && normalizeText(item.nome));
  }

  function compradorById(id) {
    return allCompradores().find((item) => String(item.id) === String(id)) || null;
  }

  function compradorNameExistsExact(nome) {
    const clean = normalizeText(nome).toLowerCase();
    return allCompradores().some((item) => normalizeText(item.nome).toLowerCase() === clean);
  }

  function activeLinkedCompradorIds() {
    const fornecedor = state.activeFornecedor || {};
    const ids = [];

    if (Array.isArray(fornecedor.compradorIds)) {
      fornecedor.compradorIds.forEach((id) => {
        const clean = normalizeText(id);
        if (clean && !ids.includes(clean)) ids.push(clean);
      });
    }

    if (Array.isArray(fornecedor.compradores)) {
      fornecedor.compradores.forEach((item) => {
        const clean = normalizeText(item?.id || '');
        if (clean && item?.ativo !== false && !ids.includes(clean)) ids.push(clean);
      });
    }

    return ids;
  }

  async function loadFornecedorCompradores(data) {
    state.activeFornecedor = null;
    state.activeFornecedorRef = null;

    const docId = fornecedorDocId(data);
    const ref = db.collection('fornecedores').doc(docId);
    state.activeFornecedorRef = ref;

    try {
      const snap = await ref.get();

      state.activeFornecedor = snap.exists
        ? { id: snap.id, ...snap.data() }
        : {
          id: docId,
          cnpj: data.cnpj || '',
          fornecedorId: data.fornecedorId || '',
          fornecedorNome: data.fornecedorNome || '',
          fornecedorTexto: data.fornecedorTexto || '',
          tipoNota: data.categoriaFornecedor || '',
          compradorIds: []
        };

      if (!Array.isArray(state.activeFornecedor.compradorIds)) state.activeFornecedor.compradorIds = [];
    } catch (error) {
      console.warn('[Comercial] Não consegui carregar vínculo de compradores do CNPJ:', error);
      state.activeFornecedor = {
        id: docId,
        cnpj: data.cnpj || '',
        fornecedorId: data.fornecedorId || '',
        fornecedorNome: data.fornecedorNome || '',
        fornecedorTexto: data.fornecedorTexto || '',
        tipoNota: data.categoriaFornecedor || '',
        compradorIds: []
      };
    }

    renderCompradorSelect();
    renderBuyerManager();
  }

  function renderCompradorSelect() {
    const select = $('#comercial-comprador');
    if (!select) return;

    const linkedIds = activeLinkedCompradorIds();
    const linked = linkedIds.map(compradorById).filter(Boolean);

    select.innerHTML = '';

    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = linked.length ? 'Escolha comprador vinculado' : 'Nenhum comprador vinculado ao CNPJ';
    select.appendChild(empty);

    linked.forEach((comprador) => {
      const opt = document.createElement('option');
      opt.value = comprador.id;
      opt.textContent = comprador.nome;
      opt.dataset.nome = comprador.nome;
      opt.dataset.linked = '1';
      select.appendChild(opt);
    });

    select.value = linked.length === 1 ? linked[0].id : '';
  }

  async function persistFornecedorBuyerLink(compradorId, silent = false) {
    const data = state.activeData;
    if (!data) {
      if (!silent) showToast('Nenhum card ativo.', 'error');
      return false;
    }

    const comprador = compradorById(compradorId);
    if (!comprador) {
      if (!silent) showToast('Comprador inválido ou não cadastrado.', 'error');
      return false;
    }

    if (!state.activeFornecedorRef) {
      state.activeFornecedorRef = db.collection('fornecedores').doc(fornecedorDocId(data));
    }

    const linkedIds = activeLinkedCompradorIds();
    const nextIds = linkedIds.includes(comprador.id) ? linkedIds : [...linkedIds, comprador.id];

    const payload = {
      cnpj: data.cnpj || '',
      fornecedorId: data.fornecedorId || '',
      fornecedorNome: data.fornecedorNome || '',
      fornecedorTexto: data.fornecedorTexto || '',
      tipoNota: data.categoriaFornecedor || '',
      compradorIds: nextIds,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      atualizadoPor: state.user.uid,
      atualizadoPorEmail: state.user.email
    };

    try {
      await state.activeFornecedorRef.set(payload, { merge: true });
      state.activeFornecedor = { ...(state.activeFornecedor || {}), ...payload, compradorIds: nextIds };
      renderCompradorSelect();
      renderBuyerManager();
      const select = $('#comercial-comprador');
      if (select) select.value = comprador.id;
      if (!silent) showToast('Comprador vinculado ao CNPJ.', 'success');
      return true;
    } catch (error) {
      console.error('[Comercial] Erro ao vincular comprador ao CNPJ:', error);
      if (!silent) showToast(error?.code === 'permission-denied' ? 'Permissão negada para vincular comprador. Atualize as regras.' : (error.message || 'Erro ao vincular comprador.'), 'error');
      return false;
    }
  }

  function openBuyerManager() {
    if (!state.user || !state.profile) return showToast('Entre no Comercial antes de gerenciar compradores.', 'error');
    renderBuyerManager();
    $('#comercial-buyer-manager-overlay')?.classList.add('open');
    setTimeout(() => $('#comercial-buyer-new-name')?.focus(), 80);
  }

  function closeBuyerManager() {
    $('#comercial-buyer-manager-overlay')?.classList.remove('open');
  }

  function renderBuyerManager() {
    const list = $('#comercial-buyer-manager-list');
    const scope = $('#comercial-buyer-manager-scope');
    if (!list) return;

    const compradores = allCompradores();
    const linkedIds = activeLinkedCompradorIds();
    const hasActiveCnpj = !!state.activeData?.cnpj;

    if (scope) {
      scope.textContent = hasActiveCnpj
        ? `CNPJ ${state.activeData.cnpj} • ${linkedIds.length} vinculado(s)`
        : 'Lista geral de compradores';
    }

    list.innerHTML = '';

    if (!compradores.length) {
      list.innerHTML = '<div class="comercial-manager-empty">Nenhum comprador cadastrado ainda.</div>';
      return;
    }

    compradores.forEach((comprador) => {
      const linked = linkedIds.includes(comprador.id);
      const row = document.createElement('div');
      row.className = `comercial-manager-row ${linked ? 'is-linked' : ''}`;
      row.innerHTML = `
        <span class="comercial-manager-name">${escapeHtml(comprador.nome)}${linked ? ' <em>vinculado</em>' : ''}</span>
        <span class="comercial-manager-row-actions">
          <button class="comercial-manager-link" type="button" data-comprador-id="${escapeHtml(comprador.id)}" ${!hasActiveCnpj || linked ? 'disabled' : ''}>Vincular</button>
          ${linked ? `<button class="comercial-manager-unlink" type="button" data-comprador-id="${escapeHtml(comprador.id)}">Desvincular</button>` : ''}
          ${isAdmin() ? `<button class="comercial-manager-delete" type="button" data-comprador-id="${escapeHtml(comprador.id)}" title="Excluir comprador da lista geral">Excluir</button>` : ''}
        </span>
      `;
      list.appendChild(row);
    });
  }

  async function addBuyerFromManager() {
    const data = state.activeData;
    if (!state.user || !state.profile) return showToast('Entre no Comercial antes de cadastrar comprador.', 'error');

    const input = $('#comercial-buyer-new-name');
    const nome = normalizeText(input?.value || '');
    if (!nome) {
      input?.focus();
      return showToast('Digite o nome do comprador.', 'error');
    }

    if (compradorNameExistsExact(nome)) {
      input?.focus();
      showToast('Já existe comprador com esse nome exato.', 'error');
      return;
    }

    const compradorId = `${safeDocPart(nome)}_${hashText(`${nome}:${Date.now()}`).slice(0, 6)}`;

    try {
      await db.collection('compradores').doc(compradorId).set({
        nome,
        nomeBusca: normalizeAscii(nome),
        ativo: true,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        criadoPor: state.user.uid,
        criadoPorEmail: state.user.email,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        atualizadoPor: state.user.uid,
        atualizadoPorEmail: state.user.email
      }, { merge: false });

      if (input) input.value = '';
      await loadCompradoresConfig(true);

      // V1.0.4: criar comprador NÃO vincula automaticamente ao CNPJ.
      // O comprador só aparece no select principal depois que o usuário clicar em Vincular.
      showToast('Comprador criado. Clique em Vincular para ligar ao CNPJ desta NF.', 'success');

      renderBuyerManager();
      renderCompradorSelect();
    } catch (error) {
      console.error('[Comercial] Erro ao cadastrar comprador:', error);
      showToast(error?.code === 'permission-denied' ? 'Permissão negada para cadastrar comprador. Atualize as regras.' : (error.message || 'Erro ao cadastrar comprador.'), 'error');
    }
  }

  async function linkBuyerFromManager(compradorId) {
    if (!compradorId) return;
    if (!state.activeData?.cnpj) return showToast('Abra um card com CNPJ para vincular comprador.', 'error');

    const linked = activeLinkedCompradorIds().includes(compradorId);
    if (!linked) {
      const ok = await persistFornecedorBuyerLink(compradorId, false);
      if (!ok) return;
    }

    const select = $('#comercial-comprador');
    if (select) select.value = compradorId;
    renderBuyerManager();
  }

  async function unlinkBuyerFromManager(compradorId) {
    if (!compradorId) return;
    if (!state.activeFornecedorRef) return showToast('Nenhum CNPJ ativo para desvincular.', 'error');

    const comprador = compradorById(compradorId);
    const nome = comprador?.nome || compradorId;

    if (!confirm(`Desvincular o comprador "${nome}" deste CNPJ?`)) return;

    try {
      const nextIds = activeLinkedCompradorIds().filter((id) => id !== compradorId);
      await state.activeFornecedorRef.set({
        compradorIds: nextIds,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        atualizadoPor: state.user.uid,
        atualizadoPorEmail: state.user.email
      }, { merge: true });

      state.activeFornecedor = { ...(state.activeFornecedor || {}), compradorIds: nextIds };
      renderCompradorSelect();
      renderBuyerManager();
      showToast('Comprador desvinculado deste CNPJ.', 'success');
    } catch (error) {
      console.error('[Comercial] Erro ao desvincular comprador:', error);
      showToast(error?.code === 'permission-denied' ? 'Permissão negada para desvincular comprador.' : (error.message || 'Erro ao desvincular comprador.'), 'error');
    }
  }

  async function deleteBuyerFromManager(compradorId) {
    if (!isAdmin()) return showToast('Somente admin pode excluir comprador da lista.', 'error');
    if (!compradorId) return;

    const comprador = compradorById(compradorId);
    const nome = comprador?.nome || compradorId;
    if (!confirm(`Excluir o comprador "${nome}" da lista geral?`)) return;

    try {
      await db.collection('compradores').doc(compradorId).update({
        ativo: false,
        excluidoEm: firebase.firestore.FieldValue.serverTimestamp(),
        excluidoPor: state.user.uid,
        excluidoPorEmail: state.user.email,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        atualizadoPor: state.user.uid,
        atualizadoPorEmail: state.user.email
      });

      if (state.activeFornecedorRef) {
        const nextIds = activeLinkedCompradorIds().filter((id) => id !== compradorId);
        await state.activeFornecedorRef.set({
          compradorIds: nextIds,
          atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
          atualizadoPor: state.user.uid,
          atualizadoPorEmail: state.user.email
        }, { merge: true });
        state.activeFornecedor = { ...(state.activeFornecedor || {}), compradorIds: nextIds };
      }

      await loadCompradoresConfig(true);
      renderCompradorSelect();
      renderBuyerManager();
      showToast('Comprador excluído da lista.', 'success');
    } catch (error) {
      console.error('[Comercial] Erro ao excluir comprador:', error);
      showToast(error?.code === 'permission-denied' ? 'Permissão negada. Somente admin pode excluir comprador.' : (error.message || 'Erro ao excluir comprador.'), 'error');
    }
  }

  // Atalhos antigos agora abrem o gerenciador visual.
  async function linkSelectedBuyerToActiveSupplier() { openBuyerManager(); }
  async function addBuyerForActiveSupplier() { openBuyerManager(); }
  async function deleteSelectedBuyer() { openBuyerManager(); }

  /********************************************************************
   * UI E ESTILOS
   ********************************************************************/
  function injectStyles() {
    if ($('#comercial-tm-style')) return;

    const style = document.createElement('style');
    style.id = 'comercial-tm-style';
    style.textContent = `
      .comercial-card-btn{width:24px!important;height:24px!important;padding:1px!important;border:1px solid #f9a8d4!important;background:#fdf2f8!important;border-radius:5px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;vertical-align:middle!important;margin-left:2px!important}
      .comercial-card-btn:hover{background:#fce7f3!important;border-color:#db2777!important}
      .comercial-card-btn img{width:18px!important;height:18px!important;display:block!important;border-radius:4px!important}
      .comercial-card-btn.comercial-missing-key{opacity:.35!important;filter:grayscale(1)!important}
      .comercial-box{clear:both;margin:5px 0 6px;padding:0;border:1px solid rgba(219,39,119,.18);background:#fff;border-radius:9px;color:#172033;font-size:10.5px;line-height:1.22;overflow:hidden;box-shadow:0 5px 12px rgba(15,23,42,.08)}
      .comercial-box-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 6px;font-weight:900;color:#fff;background:linear-gradient(135deg,#db2777,#f97316)}
      .comercial-box-title{display:inline-flex;align-items:center;gap:4px;min-width:0}
      .comercial-box-title img{width:14px;height:14px;border-radius:4px;flex:0 0 auto}
      .comercial-chip{display:inline-flex;align-items:center;border-radius:999px;padding:1px 6px;font-size:9px;font-weight:900;background:rgba(255,255,255,.96);color:#be185d;border:1px solid rgba(255,255,255,.65);white-space:nowrap}
      .comercial-box-body{padding:5px 6px 6px;background:#fff7ed;border-left:3px solid #db2777}
      .comercial-last-text{margin-top:0;padding:4px 5px;border-radius:7px;background:#fff;border:1px solid #fed7aa;color:#334155;overflow-wrap:anywhere;white-space:pre-wrap}
      .comercial-box small{color:#64748b;display:block;margin-top:3px;font-size:9.5px}
      .comercial-status-reaberto .comercial-box-head{background:linear-gradient(135deg,#f59e0b,#ea580c)}
      .comercial-status-em_tratamento .comercial-box-head{background:linear-gradient(135deg,#b54708,#f97316)}
      .comercial-status-informacoes_divergentes .comercial-box-head,.comercial-status-devolver_recusar .comercial-box-head,.comercial-status-cancelado .comercial-box-head{background:linear-gradient(135deg,#b42318,#ef4444)}
      .comercial-status-pedido_corrigido .comercial-box-head,.comercial-status-pronto .comercial-box-head,.comercial-status-resolvido .comercial-box-head{background:linear-gradient(135deg,#067647,#12b76a)}
      .comercial-status-em_tratamento .comercial-box-body{border-left-color:#f97316;background:#fff7ed}
      .comercial-status-informacoes_divergentes .comercial-box-body,.comercial-status-devolver_recusar .comercial-box-body,.comercial-status-cancelado .comercial-box-body{border-left-color:#ef4444;background:#fef3f2}
      .comercial-status-pedido_corrigido .comercial-box-body,.comercial-status-pronto .comercial-box-body,.comercial-status-resolvido .comercial-box-body{border-left-color:#12b76a;background:#ecfdf3}
      .comercial-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:999999;display:none;align-items:center;justify-content:center;padding:20px}
      .comercial-overlay.open{display:flex}
      .comercial-modal{width:min(610px,calc(100vw - 32px));max-height:calc(100vh - 36px);background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.22);overflow:auto;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .comercial-modal-head{display:flex;align-items:center;gap:10px;padding:9px 11px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:#fff;z-index:2}
      .comercial-modal-head img{width:32px;height:32px;border-radius:10px;flex:0 0 auto}
      .comercial-title-wrap{min-width:0;line-height:1.1}
      .comercial-modal-head h3{margin:0;font-size:15px;color:#172033}
      .comercial-modal-head p{margin:2px 0 0;color:#687386;font-size:11px}
      .comercial-head-auth{margin-left:auto;max-width:270px;border-radius:999px;padding:5px 9px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;font-size:11px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .comercial-head-auth.ok{background:#ecfdf3;color:#067647;border-color:#bbf7d0}
      .comercial-close{border:0;border-radius:10px;background:#f1f5f9;width:32px;height:32px;font-size:18px;line-height:1;cursor:pointer;flex:0 0 auto}
      .comercial-modal-body{padding:10px 12px;display:grid;gap:8px}
      .comercial-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .comercial-info{border:1px solid #fbcfe8;background:#fdf2f8;color:#831843;padding:7px 9px;border-radius:10px;font-size:10.5px;line-height:1.3}
      .comercial-field{display:grid;gap:4px}
      .comercial-field label{font-weight:800;color:#687386;font-size:11px}
      .comercial-field select,.comercial-field input,.comercial-field textarea{width:100%;border:1px solid #dfe7f0;border-radius:10px;padding:7px 9px;outline:none;color:#172033;background:#fff;font-size:12px}
      .comercial-field textarea{min-height:50px;resize:vertical}
      .comercial-field select:focus,.comercial-field input:focus,.comercial-field textarea:focus{border-color:#db2777;box-shadow:0 0 0 3px rgba(219,39,119,.12)}
      .comercial-section-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:7px 8px;border:1px dashed #f9a8d4;background:#fff7fb;border-radius:10px}
      .comercial-section-title{font-size:11px;font-weight:900;color:#831843;text-transform:uppercase;letter-spacing:.02em}
      .comercial-action-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .comercial-manage-actions{display:flex;gap:6px;align-items:center;justify-content:flex-start;flex-wrap:wrap;padding:6px 8px;border:1px dashed #f9a8d4;background:#fff7fb;border-radius:10px}
      .comercial-inline-select{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center}
      .comercial-manager-overlay{position:fixed;inset:0;z-index:1000002;background:rgba(15,23,42,.60);display:none;align-items:center;justify-content:center;padding:18px}
      .comercial-manager-overlay.open{display:flex}
      .comercial-manager-modal{width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 44px);overflow:auto;background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.30);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .comercial-manager-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid #eef2f7;position:sticky;top:0;background:#fff;z-index:1}
      .comercial-manager-head strong{font-size:14px;color:#172033}.comercial-manager-head small{display:block;color:#64748b;font-size:11px;margin-top:2px}
      .comercial-manager-body{padding:10px 12px;display:grid;gap:8px}.comercial-manager-grid{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:end}.comercial-manager-grid select,.comercial-manager-grid input{width:100%;border:1px solid #dfe7f0;border-radius:10px;padding:8px 9px;font-size:12px;outline:none}.comercial-manager-list{display:grid;gap:6px;max-height:280px;overflow:auto}.comercial-manager-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border:1px solid #eef2f7;background:#f8fafc;border-radius:10px}.comercial-manager-row.is-linked{background:#ecfdf3;border-color:#bbf7d0}.comercial-manager-name{font-size:12px;font-weight:800;color:#172033;min-width:0;overflow:hidden;text-overflow:ellipsis}.comercial-manager-name em{font-style:normal;margin-left:6px;color:#067647;font-size:10px}.comercial-manager-row-actions{display:flex;gap:5px;flex:0 0 auto}.comercial-manager-link,.comercial-manager-unlink,.comercial-manager-delete{border:0;border-radius:9px;padding:6px 8px;font-size:11px;font-weight:900;cursor:pointer}.comercial-manager-link{background:#db2777;color:#fff}.comercial-manager-unlink{background:#fef3c7;color:#92400e;border:1px solid #fde68a}.comercial-manager-link:disabled{opacity:.5;cursor:not-allowed}.comercial-manager-delete{background:#fff;border:1px solid #fecdd3;color:#9f1239}.comercial-manager-empty{font-size:12px;color:#64748b;padding:10px;border:1px dashed #cbd5e1;border-radius:10px;text-align:center}
      .comercial-actions{display:flex;gap:8px;justify-content:flex-end;padding:8px 12px 12px;position:sticky;bottom:0;background:#fff;border-top:1px solid #eef2f7}
      .comercial-btn{border:0;border-radius:10px;padding:8px 12px;font-weight:800;min-height:34px;cursor:pointer;font-size:12px}
      .comercial-btn.primary{background:#db2777;color:#fff}
      .comercial-btn.ghost{background:#f8fafc;border:1px solid #dfe7f0;color:#172033}
      .comercial-btn.warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412}
      .comercial-btn.small{min-height:32px;padding:7px 10px;font-size:12px}
      .comercial-btn.round{width:32px;padding:0;font-size:18px}
      .comercial-btn:disabled{opacity:.6;cursor:not-allowed}
      .comercial-authbar{display:none!important}
      .comercial-login-panel{display:none;border:1px solid #fbcfe8;background:#fdf2f8;border-radius:10px;padding:8px 10px;gap:8px}
      .comercial-login-panel.open{display:grid}
      .comercial-login-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .comercial-login-actions{display:flex;gap:8px;flex-wrap:wrap}
      .comercial-toast{position:fixed;top:18px;right:18px;z-index:1000000;background:#111827;color:#fff;padding:12px 14px;border-radius:12px;box-shadow:0 18px 45px rgba(15,23,42,.18);max-width:min(420px,calc(100vw - 36px));display:none}
      .comercial-toast.open{display:block}
      .comercial-toast.success{background:#067647}
      .comercial-toast.error{background:#b42318}
      @media(max-width:760px){.comercial-grid,.comercial-login-grid{grid-template-columns:1fr}.comercial-actions{flex-wrap:wrap}.comercial-head-auth{max-width:190px}}
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    if ($('#comercial-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'comercial-overlay';
    overlay.className = 'comercial-overlay';
    overlay.innerHTML = `
      <div class="comercial-modal" role="dialog" aria-modal="true" aria-labelledby="comercial-modal-title">
        <div class="comercial-modal-head">
          <img src="${COMERCIAL_ICON_URL}" alt="Comercial">
          <div class="comercial-title-wrap">
            <h3 id="comercial-modal-title">Abrir Comercial</h3>
            <p>${TIPO_CHAMADO_NOME}</p>
          </div>
          <div id="comercial-head-auth" class="comercial-head-auth">Verificando login...</div>
          <button id="comercial-close" class="comercial-close" type="button">×</button>
        </div>

        <div class="comercial-modal-body">
          <div id="comercial-login-panel" class="comercial-login-panel">
            <div class="comercial-login-grid">
              <div class="comercial-field">
                <label for="comercial-email-login">E-mail Comercial</label>
                <input id="comercial-email-login" type="email" autocomplete="email" placeholder="usuario@email.com">
              </div>
              <div class="comercial-field">
                <label for="comercial-password-login">Senha</label>
                <input id="comercial-password-login" type="password" autocomplete="current-password" placeholder="Senha">
              </div>
            </div>
            <div class="comercial-login-actions">
              <button id="comercial-login-email" class="comercial-btn primary small" type="button">Entrar</button>
              <button id="comercial-reset-password" class="comercial-btn ghost small" type="button">Definir/recuperar senha</button>
              <button id="comercial-google-login" class="comercial-btn ghost small" type="button">Conectar Google</button>
            </div>
            <small>Use e-mail/senha ou Google. O login é do projeto Comercial, separado do Xabuia.</small>
          </div>

          <div id="comercial-info" class="comercial-info"></div>

          <div class="comercial-grid">
            <div class="comercial-field">
              <label for="comercial-fila">Fila responsável</label>
              <select id="comercial-fila"></select>
            </div>

            <div class="comercial-field">
              <label for="comercial-tipo-divergencia">Tipo da divergência</label>
              <select id="comercial-tipo-divergencia"></select>
            </div>
          </div>

          <div id="comercial-manage-actions" class="comercial-manage-actions" style="display:none">
            <button id="comercial-open-type-manager" class="comercial-btn ghost small" type="button">Tipos de divergência</button>
            <button id="comercial-open-buyer-manager" class="comercial-btn ghost small" type="button">Compradores</button>
          </div>

          <div id="comercial-comprador-wrap" class="comercial-field">
            <label for="comercial-comprador">Comprador</label>
            <div class="comercial-inline-select">
              <select id="comercial-comprador"></select>
              <button id="comercial-link-buyer" class="comercial-btn ghost small" type="button" title="Abrir lista de compradores para vincular ao CNPJ">Vincular</button>
            </div>
          </div>

          <div class="comercial-field">
            <label for="comercial-comment">Observação</label>
            <textarea id="comercial-comment" placeholder="Ex.: Nota chegou sem pedido, item não cadastrado, divergência de valor..."></textarea>
          </div>
        </div>

        <div class="comercial-actions">
          <button id="comercial-login" class="comercial-btn ghost" type="button">Entrar no Comercial</button>
          <button id="comercial-logout" class="comercial-btn ghost" type="button">Sair</button>
          <button id="comercial-cancel" class="comercial-btn ghost" type="button">Cancelar</button>
          <button id="comercial-save" class="comercial-btn primary" type="button">Salvar Comercial</button>
        </div>
      </div>

      <div id="comercial-type-manager-overlay" class="comercial-manager-overlay" aria-hidden="true">
        <div class="comercial-manager-modal" role="dialog" aria-modal="true">
          <div class="comercial-manager-head">
            <div><strong>Tipos de divergência</strong><small>Escolha Compras/Cadastro, crie ou exclua tipos.</small></div>
            <button id="comercial-type-manager-close" class="comercial-close" type="button">×</button>
          </div>
          <div class="comercial-manager-body">
            <div class="comercial-grid">
              <div class="comercial-field">
                <label for="comercial-type-manager-fila">Fila</label>
                <select id="comercial-type-manager-fila"></select>
              </div>
              <div class="comercial-field">
                <label>&nbsp;</label>
                <button id="comercial-create-default-list" class="comercial-btn warn small" type="button">Criar lista padrão</button>
              </div>
            </div>
            <div class="comercial-manager-grid">
              <div class="comercial-field">
                <label for="comercial-type-new-name">Novo tipo</label>
                <input id="comercial-type-new-name" type="text" placeholder="Ex.: Pedido divergente">
              </div>
              <button id="comercial-add-type" class="comercial-btn primary small" type="button">+</button>
            </div>
            <div id="comercial-type-manager-list" class="comercial-manager-list"></div>
          </div>
        </div>
      </div>

      <div id="comercial-buyer-manager-overlay" class="comercial-manager-overlay" aria-hidden="true">
        <div class="comercial-manager-modal" role="dialog" aria-modal="true">
          <div class="comercial-manager-head">
            <div><strong>Compradores</strong><small id="comercial-buyer-manager-scope">Lista geral de compradores</small></div>
            <button id="comercial-buyer-manager-close" class="comercial-close" type="button">×</button>
          </div>
          <div class="comercial-manager-body">
            <div class="comercial-manager-grid">
              <div class="comercial-field">
                <label for="comercial-buyer-new-name">Novo comprador</label>
                <input id="comercial-buyer-new-name" type="text" placeholder="Nome do comprador">
              </div>
              <button id="comercial-add-buyer" class="comercial-btn primary small" type="button">+</button>
            </div>
            <div id="comercial-buyer-manager-list" class="comercial-manager-list"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    $('#comercial-close').addEventListener('click', closeModal);
    $('#comercial-cancel').addEventListener('click', closeModal);
    $('#comercial-login').addEventListener('click', toggleLoginPanel);
    $('#comercial-logout').addEventListener('click', logoutComercial);
    $('#comercial-login-email').addEventListener('click', loginWithEmailPassword);
    $('#comercial-reset-password').addEventListener('click', sendPasswordResetFromPanel);
    $('#comercial-google-login').addEventListener('click', loginGoogle);
    $('#comercial-save').addEventListener('click', saveActiveTicket);
    $('#comercial-fila').addEventListener('change', () => {
      renderDivergenciaOptions();
      renderBuyerRequirement();
    });
    $('#comercial-open-type-manager').addEventListener('click', openTypeManager);
    $('#comercial-open-buyer-manager').addEventListener('click', openBuyerManager);
    $('#comercial-link-buyer').addEventListener('click', openBuyerManager);

    $('#comercial-type-manager-close').addEventListener('click', closeTypeManager);
    $('#comercial-type-manager-fila').addEventListener('change', renderTypeManager);
    $('#comercial-create-default-list').addEventListener('click', createDefaultConfig);
    $('#comercial-add-type').addEventListener('click', addDivergenceTypeFromManager);
    $('#comercial-type-new-name').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addDivergenceTypeFromManager();
    });
    $('#comercial-type-manager-list').addEventListener('click', (event) => {
      const btn = event.target.closest('.comercial-manager-delete');
      if (btn) deleteDivergenceTypeFromManager(btn.dataset.fila, btn.dataset.tipo);
    });

    $('#comercial-buyer-manager-close').addEventListener('click', closeBuyerManager);
    $('#comercial-add-buyer').addEventListener('click', addBuyerFromManager);
    $('#comercial-buyer-new-name').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addBuyerFromManager();
    });
    $('#comercial-buyer-manager-list').addEventListener('click', (event) => {
      const link = event.target.closest('.comercial-manager-link');
      if (link) linkBuyerFromManager(link.dataset.compradorId);
      const unlink = event.target.closest('.comercial-manager-unlink');
      if (unlink) unlinkBuyerFromManager(unlink.dataset.compradorId);
      const del = event.target.closest('.comercial-manager-delete');
      if (del) deleteBuyerFromManager(del.dataset.compradorId);
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeModal();
      if (event.target?.id === 'comercial-type-manager-overlay') closeTypeManager();
      if (event.target?.id === 'comercial-buyer-manager-overlay') closeBuyerManager();
    });
  }

  function showToast(message, type = 'info') {
    let toast = $('#comercial-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'comercial-toast';
      toast.className = 'comercial-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `comercial-toast open ${type === 'success' ? 'success' : type === 'error' ? 'error' : ''}`;

    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('open'), 4500);
  }

  function renderAuthInfo() {
    const authbar = $('#comercial-head-auth') || $('#comercial-authbar');
    const loginBtn = $('#comercial-login');
    const logoutBtn = $('#comercial-logout');
    const saveBtn = $('#comercial-save');

    if (!authbar || !loginBtn || !saveBtn) return;

    loginBtn.style.display = state.user ? 'none' : '';
    if (logoutBtn) logoutBtn.style.display = state.user ? '' : 'none';

    if (state.user) {
      $('#comercial-login-panel')?.classList.remove('open');
    }

    if (!state.user) {
      authbar.className = 'comercial-head-auth';
      authbar.innerHTML = 'Entre no Comercial';
      saveBtn.disabled = true;
      renderConfigControls();
      return;
    }

    if (!state.profile) {
      authbar.className = 'comercial-head-auth';
      authbar.innerHTML = `Perfil pendente: ${escapeHtml(state.user.email)}`;
      saveBtn.disabled = true;
      renderConfigControls();
      return;
    }

    if (state.profile.ativo === false) {
      authbar.className = 'comercial-head-auth';
      authbar.innerHTML = 'Conta bloqueada';
      saveBtn.disabled = true;
      renderConfigControls();
      return;
    }

    if (!canOpenTicket()) {
      authbar.className = 'comercial-head-auth';
      authbar.innerHTML = `${escapeHtml(state.profile.nome || state.user.email)} • sem permissão`;
      saveBtn.disabled = true;
      renderConfigControls();
      return;
    }

    authbar.className = 'comercial-head-auth ok';
    authbar.innerHTML = `Salvando como ${escapeHtml(state.profile.nome || state.user.email)} • Perfil: ${escapeHtml(state.profile.papel || '—')}`;
    saveBtn.disabled = false;
    renderConfigControls();
  }

  function renderConfigControls() {
    const box = $('#comercial-manage-actions');
    if (!box) return;

    const logged = Boolean(state.user && state.profile && state.profile.ativo !== false);
    box.style.display = logged ? 'flex' : 'none';

    const typeBtn = $('#comercial-open-type-manager');
    if (typeBtn) typeBtn.style.display = isAdmin() ? '' : 'none';

    const buyerBtn = $('#comercial-open-buyer-manager');
    if (buyerBtn) buyerBtn.style.display = ($('#comercial-fila')?.value || '') === 'compras' ? '' : 'none';

    const defaultBtn = $('#comercial-create-default-list');
    if (defaultBtn) defaultBtn.style.display = state.divergenciasConfigExists ? 'none' : '';
  }

  function renderFilaOptions(preserve = true) {
    const select = $('#comercial-fila');
    if (!select) return;

    const config = normalizeDivergenciasConfig(state.divergenciasConfig || DEFAULT_DIVERGENCIAS);
    const previous = preserve ? (select.value || '') : '';

    select.innerHTML = '';

    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Selecione a fila';
    select.appendChild(empty);

    Object.entries(config).forEach(([fila, def]) => {
      const opt = document.createElement('option');
      opt.value = fila;
      opt.textContent = def.nome || fila;
      select.appendChild(opt);
    });

    select.value = config[previous] ? previous : '';
    renderBuyerRequirement();
  }

  function renderDivergenciaOptions(preserve = true) {
    const select = $('#comercial-tipo-divergencia');
    const fila = $('#comercial-fila')?.value || '';
    if (!select) return;

    const config = normalizeDivergenciasConfig(state.divergenciasConfig || DEFAULT_DIVERGENCIAS);
    const tipos = fila ? (config[fila]?.tipos || []) : [];

    const previous = preserve ? (select.value || '') : '';
    select.innerHTML = '';

    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = fila ? 'Selecione o tipo' : 'Selecione a fila primeiro';
    select.appendChild(empty);

    tipos.forEach((tipo) => {
      const opt = document.createElement('option');
      opt.value = tipo.id;
      opt.textContent = tipo.nome;
      select.appendChild(opt);
    });

    select.value = tipos.some((item) => item.id === previous) ? previous : '';
  }

  function renderCategoriaOptions(value) {
    const input = $('#comercial-categoria');
    if (!input) return;
    input.value = canonicalCategoria(value) || '—';
  }

  function renderBuyerRequirement() {
    const fila = $('#comercial-fila')?.value || '';
    const wrap = $('#comercial-comprador-wrap');
    if (wrap) wrap.style.display = fila === 'compras' ? 'grid' : 'none';
    renderConfigControls();
  }

  /********************************************************************
   * CARD DO INFRADESK
   ********************************************************************/
  function scanCards() {
    injectStyles();
    ensureModal();

    const cards = $$('.chamado-item[data-chamado-id]');

    cards.forEach((card) => {
      if (!isTargetCard(card)) {
        removeComercialUiFromCard(card);
        return;
      }

      if (card.dataset.comercialButtonReady !== '1') {
        card.dataset.comercialButtonReady = '1';
        addComercialButton(card);
      }

      cleanUnusedIcons(card);
      renderCardFromKnownTickets(card);
    });

    syncVisibleCardLookups(false);
    syncVisibleKnownMonitors();
  }

  function cleanUnusedIcons(card) {
    [
      'a.btn-sla-pausa',
      'button.btn-copy-resume',
      'a.btn-transferir',
      'a.btn-anexo'
    ].forEach((selector) => {
      $$(selector, card).forEach((el) => el.remove());
    });
  }

  function addComercialButton(card) {
    if ($('.comercial-card-btn', card)) return;

    const data = parseCard(card);
    const toolbar = $('.toolbar-atendente', card) || $('.list-toolbar', card) || card;
    const btn = document.createElement('button');

    btn.type = 'button';
    btn.className = `comercial-card-btn ${data.chave ? '' : 'comercial-missing-key'}`;
    btn.title = data.chave ? 'Abrir divergência Comercial' : 'Chave NF-e não encontrada no card';
    btn.innerHTML = `<img src="${COMERCIAL_ICON_URL}" alt="Comercial">`;

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openModal(card);
    });

    const xabuiaBtn = $('.xabuia-card-btn', toolbar) || $('.xabuia-card-btn', card);
    const anexoBtn = $('.btn-anexo', toolbar) || $('.btn-anexo', card);
    const feedbackBtn = $('a[title="Registrar Interação"]', toolbar);

    if (xabuiaBtn?.parentElement) {
      xabuiaBtn.insertAdjacentElement('afterend', btn);
    } else if (anexoBtn?.parentElement) {
      anexoBtn.insertAdjacentElement('beforebegin', btn);
    } else if (feedbackBtn?.parentElement) {
      feedbackBtn.insertAdjacentElement('afterend', btn);
    } else {
      toolbar.appendChild(btn);
    }
  }

  function removeComercialUiFromCard(card) {
    if (!card) return;
    $$('.comercial-card-btn', card).forEach((btn) => btn.remove());
    $$('.comercial-box', card).forEach((box) => box.remove());
    delete card.dataset.comercialButtonReady;
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

  function renderCardFromKnownTickets(card) {
    const data = parseCard(card);
    const tickets = knownTickets(data.chave);

    if (!tickets.length) {
      $('.comercial-box', card)?.remove();
      return;
    }

    renderCardBox(card, tickets);
  }

  function renderCardBox(card, tickets = []) {
    if (!tickets.length) return;

    const box = ensureCardBox(card);
    const top = tickets[0];
    const status = top.status || 'aberto';
    const label = STATUS_LABELS[status] || status;

    const comprador = top.compradorNome ? ` • ${top.compradorNome}` : '';
    const treating = top.operadorTratamentoNome ? ` • tratando: ${top.operadorTratamentoNome}` : '';
    const resumo = `${top.filaNome || top.fila || '—'} / ${top.tipoDivergenciaNome || top.tipoDivergencia || '—'}${comprador}${treating}`;

    const statusClass = String(status).replace(/[^a-z0-9_-]/gi, '_');
    box.className = `comercial-box comercial-status-${statusClass}`;
    box.innerHTML = `
      <div class="comercial-box-head">
        <span class="comercial-box-title"><img src="${COMERCIAL_ICON_URL}" alt=""> Comercial</span>
        <span class="comercial-chip">${escapeHtml(label)}</span>
      </div>
      <div class="comercial-box-body">
        <div class="comercial-last-text">${escapeHtml(resumo)}</div>
        <small>${escapeHtml(top.ultimaOcorrenciaTexto || 'Registrado no Comercial.')} • ${escapeHtml(formatDate(top.ultimaOcorrenciaEm || top.atualizadoEm))}</small>
      </div>
    `;
  }

  /********************************************************************
   * MODAL E LOGIN
   ********************************************************************/
  function resetModalFormForNewCard() {
    closeTypeManager();
    closeBuyerManager();

    state.activeFornecedor = null;
    state.activeFornecedorRef = null;
    state.isSaving = false;

    const info = $('#comercial-info');
    if (info) info.innerHTML = '';

    const comment = $('#comercial-comment');
    if (comment) comment.value = '';

    const fila = $('#comercial-fila');
    if (fila) fila.value = '';

    const tipo = $('#comercial-tipo-divergencia');
    if (tipo) {
      tipo.innerHTML = '<option value="">Selecione a fila primeiro</option>';
      tipo.value = '';
    }

    const comprador = $('#comercial-comprador');
    if (comprador) {
      comprador.innerHTML = '<option value="">Nenhum comprador vinculado ao CNPJ</option>';
      comprador.value = '';
    }

    const saveBtn = $('#comercial-save');
    if (saveBtn) {
      saveBtn.textContent = 'Salvar Comercial';
      saveBtn.disabled = !canOpenTicket();
    }
  }

  async function openModal(card) {
    if (!isTargetCard(card)) {
      showToast('O Comercial está habilitado apenas na coluna Em Análise Terceiro.', 'error');
      return;
    }

    resetModalFormForNewCard();

    state.activeCard = card;
    state.activeData = parseCard(card);
    state.activeFornecedor = null;
    state.activeFornecedorRef = null;

    if (!state.activeData.chave || state.activeData.chave.length !== 44) {
      showToast('Não encontrei uma chave NF-e de 44 dígitos neste card.', 'error');
      return;
    }

    $('#comercial-info').innerHTML = renderActiveDataInfo(state.activeData);

    if (state.user && !state.profile) await loadProfileIfNeeded(false);

    renderAuthInfo();

    await loadDivergenciasConfig(false);
    await loadCompradoresConfig(false);
    renderFilaOptions(false);
    renderDivergenciaOptions(false);
    renderConfigControls();
    renderCompradorSelect();

    $('#comercial-overlay').classList.add('open');

    if (state.user && state.profile) {
      // Ao abrir o formulário, a fonte da verdade é o Firestore.
      // Cache/localStorage só é usado depois que o documento foi confirmado no banco.
      await lookupTicketsByChave(state.activeData.chave, true);
      await loadFornecedorCompradores(state.activeData);
    } else {
      renderCompradorSelect();
    }

    setTimeout(() => $('#comercial-fila')?.focus(), 50);
  }

  function renderActiveDataInfo(data) {
    return `
      <div><strong>Chamado:</strong> ${escapeHtml(data.chamadoId || '—')} • <strong>Status:</strong> ${escapeHtml(data.statusInfradesk || '—')} • <strong>NF:</strong> ${escapeHtml(data.numeroNf || '—')} • <strong>CNPJ:</strong> ${escapeHtml(data.cnpj || '—')}</div>
      <div><strong>Fornecedor:</strong> ${escapeHtml(data.fornecedorTexto || data.fornecedorNome || '—')} • <strong>Tipo:</strong> ${escapeHtml(data.categoriaFornecedor || '—')} • <strong>Empresa:</strong> ${escapeHtml(data.empresa || '—')}</div>
      <div><strong>Chave:</strong> ${escapeHtml(data.chave)}</div>
    `;
  }

  function closeModal() {
    $('#comercial-overlay')?.classList.remove('open');
    state.activeCard = null;
    state.activeData = null;
    state.activeFornecedor = null;
    state.activeFornecedorRef = null;
    state.isSaving = false;
  }

  function toggleLoginPanel() {
    const panel = $('#comercial-login-panel');
    if (!panel) return;

    panel.classList.toggle('open');

    if (panel.classList.contains('open')) {
      setTimeout(() => $('#comercial-email-login')?.focus(), 60);
    }
  }

  function readEmailLoginFields() {
    return {
      email: String($('#comercial-email-login')?.value || '').trim(),
      password: String($('#comercial-password-login')?.value || '')
    };
  }

  async function loginWithEmailPassword() {
    if (loginWithEmailPassword.inProgress) return loginWithEmailPassword.inProgress;

    const { email, password } = readEmailLoginFields();
    if (!email) {
      $('#comercial-email-login')?.focus();
      showToast('Informe o e-mail do Comercial.', 'error');
      return;
    }

    if (!password) {
      $('#comercial-password-login')?.focus();
      showToast('Informe a senha do Comercial.', 'error');
      return;
    }

    const btn = $('#comercial-login-email');
    const originalText = btn?.textContent || 'Entrar';

    loginWithEmailPassword.inProgress = (async () => {
      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Entrando...';
        }

        await auth.signInWithEmailAndPassword(email, password);
        await loadProfileIfNeeded(true);
        renderAuthInfo();

        if (state.activeData) {
          await loadDivergenciasConfig(true);
          await loadCompradoresConfig(true);
          renderFilaOptions();
          renderDivergenciaOptions();
          await loadFornecedorCompradores(state.activeData);
        }

        showToast('Comercial conectado.', 'success');
      } catch (error) {
        const code = error?.code || '';
        const map = {
          'auth/invalid-credential': 'E-mail ou senha inválidos.',
          'auth/wrong-password': 'Senha inválida.',
          'auth/user-not-found': 'Não encontrei esse e-mail no Comercial.',
          'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
          'auth/network-request-failed': 'Falha de rede. Confira sua conexão.',
          'auth/operation-not-allowed': 'Login por e-mail/senha não está habilitado no Firebase Authentication.'
        };
        showToast(map[code] || error.message || 'Erro ao entrar no Comercial.', 'error');
      } finally {
        loginWithEmailPassword.inProgress = null;
        const currentBtn = $('#comercial-login-email');
        if (currentBtn) {
          currentBtn.disabled = false;
          currentBtn.textContent = originalText;
        }
      }
    })();

    return loginWithEmailPassword.inProgress;
  }

  async function sendPasswordResetFromPanel() {
    const { email } = readEmailLoginFields();

    if (!email) {
      $('#comercial-email-login')?.focus();
      showToast('Informe o e-mail para enviar o link de senha.', 'error');
      return;
    }

    const btn = $('#comercial-reset-password');
    const originalText = btn?.textContent || 'Definir/recuperar senha';

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Enviando...';
      }

      await auth.sendPasswordResetEmail(email);
      showToast('Enviei o link para definir/recuperar senha. Confira o e-mail.', 'success');
    } catch (error) {
      const code = error?.code || '';
      const map = {
        'auth/user-not-found': 'Não encontrei esse e-mail no Comercial.',
        'auth/invalid-email': 'E-mail inválido.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
        'auth/operation-not-allowed': 'Login por e-mail/senha não está habilitado no Firebase Authentication.'
      };
      showToast(map[code] || error.message || 'Erro ao enviar link de senha.', 'error');
    } finally {
      const currentBtn = $('#comercial-reset-password');
      if (currentBtn) {
        currentBtn.disabled = false;
        currentBtn.textContent = originalText;
      }
    }
  }

  async function loginGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
      await loadProfileIfNeeded(true);
      renderAuthInfo();

      if (state.activeData) {
        await loadDivergenciasConfig(true);
        renderFilaOptions();
        renderDivergenciaOptions();
        await loadFornecedorCompradores(state.activeData);
      }

      showToast('Conta Google conectada.', 'success');
    } catch (error) {
      const message = error?.code === 'auth/unauthorized-domain'
        ? 'Domínio do Infradesk não autorizado no Firebase Authentication.'
        : (error.message || 'Erro ao conectar Google.');

      showToast(message, 'error');
    }
  }

  async function logoutComercial() {
    const btn = $('#comercial-logout');
    const originalText = btn?.textContent || 'Sair';

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saindo...';
      }

      stopAllTicketMonitors();
      await auth.signOut();

      state.user = null;
      state.profile = null;
      state.profileLoading = null;
      state.userTicketsByChave.clear();
      state.userTicketsById.clear();
      state.activeFornecedor = null;
      state.activeFornecedorRef = null;
      state.compradoresConfig = null;

      renderAuthInfo();
      scanCards();
      showToast('Sessão Comercial encerrada neste navegador.', 'success');
    } catch (error) {
      showToast(error.message || 'Erro ao sair do Comercial.', 'error');
    } finally {
      const currentBtn = $('#comercial-logout');
      if (currentBtn) {
        currentBtn.disabled = false;
        currentBtn.textContent = originalText;
      }
    }
  }

  /********************************************************************
   * SALVAMENTO
   ********************************************************************/
  function selectedDivergence() {
    const fila = $('#comercial-fila')?.value || '';
    const tipo = $('#comercial-tipo-divergencia')?.value || '';
    const config = normalizeDivergenciasConfig(state.divergenciasConfig || DEFAULT_DIVERGENCIAS);
    const filaDef = config[fila];
    const tipoDef = filaDef?.tipos?.find((item) => item.id === tipo);

    return {
      fila,
      filaNome: filaDef?.nome || fila,
      tipoDivergencia: tipo,
      tipoDivergenciaNome: tipoDef?.nome || tipo
    };
  }

  function selectedComprador() {
    const select = $('#comercial-comprador');
    if (!select || !select.value) return { compradorId: '', compradorNome: '' };

    const opt = select.selectedOptions?.[0];
    return {
      compradorId: select.value,
      compradorNome: normalizeText(opt?.dataset?.nome || opt?.textContent || '')
    };
  }

  async function saveActiveTicket() {
    if (state.isSaving) return;

    const data = state.activeData;
    const card = state.activeCard;

    if (!data?.chave || data.chave.length !== 44) {
      showToast('Chave NF-e inválida.', 'error');
      return;
    }

    if (!state.user) {
      showToast('Conecte sua conta Comercial primeiro.', 'error');
      return;
    }

    if (!state.profile) await loadProfileIfNeeded(true);

    if (!canOpenTicket()) {
      showToast('Seu perfil não tem permissão para abrir divergência pelo Infradesk.', 'error');
      return;
    }

    const divergence = selectedDivergence();

    if (!divergence.fila || !divergence.tipoDivergencia) {
      showToast('Escolha a fila e o tipo da divergência.', 'error');
      return;
    }

    const comprador = selectedComprador();

    if (divergence.fila === 'compras' && !comprador.compradorNome) {
      showToast('Divergência de Compras exige comprador. Clique em Compradores para vincular ao CNPJ.', 'error');
      $('#comercial-comprador')?.focus();
      return;
    }

    const categoriaFornecedor = data.categoriaFornecedor || '';

    if (divergence.fila === 'compras' && comprador.compradorId && !activeLinkedCompradorIds().includes(comprador.compradorId)) {
      await persistFornecedorBuyerLink(comprador.compradorId, true);
    }

    const comment = normalizeText($('#comercial-comment')?.value || '') || `Divergência aberta: ${divergence.tipoDivergenciaNome}.`;
    const saveBtn = $('#comercial-save');
    const originalText = saveBtn?.textContent || 'Salvar Comercial';

    state.isSaving = true;

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Verificando chave...';
      }

      // V1.0.6:
      // Antes de criar, procura qualquer chamado já existente com a mesma chave.
      // Se existir, atualiza/reabre o mesmo documento. Se não existir, cria o ID canônico por chave.
      const lookup = await findExistingTicketForSave(data.chave);
      const ref = lookup.ref;
      const exists = lookup.exists;
      const previousTicket = lookup.ticket || null;
      const previousStatus = previousTicket?.status || '';
      const finalStatus = statusAfterInfradeskOccurrence(exists, previousStatus);
      const historyType = historyTypeForStatus(finalStatus, exists, previousStatus);
      const keepExistingClassification = exists && isActiveComercialStatus(previousStatus);
      const now = firebase.firestore.FieldValue.serverTimestamp();

      if (saveBtn) saveBtn.textContent = exists ? 'Atualizando...' : 'Criando...';

      const effectiveFila = keepExistingClassification ? (previousTicket.fila || divergence.fila) : divergence.fila;
      const effectiveFilaNome = keepExistingClassification ? (previousTicket.filaNome || divergence.filaNome) : divergence.filaNome;
      const effectiveTipo = keepExistingClassification ? (previousTicket.tipoDivergencia || divergence.tipoDivergencia) : divergence.tipoDivergencia;
      const effectiveTipoNome = keepExistingClassification ? (previousTicket.tipoDivergenciaNome || divergence.tipoDivergenciaNome) : divergence.tipoDivergenciaNome;
      const effectiveCompradorId = effectiveFila === 'compras'
        ? (keepExistingClassification ? (previousTicket.compradorId || comprador.compradorId || '') : comprador.compradorId)
        : '';
      const effectiveCompradorNome = effectiveFila === 'compras'
        ? (keepExistingClassification ? (previousTicket.compradorNome || comprador.compradorNome || '') : comprador.compradorNome)
        : '';

      const basePayload = {
        tipoChamado: TIPO_CHAMADO,
        chamadoInfradeskId: data.chamadoId || '',
        chamadosInfradeskIds: firebase.firestore.FieldValue.arrayUnion(data.chamadoId || ''),
        chave: data.chave,
        chaveBusca: typedChaveBusca(data.chave),
        chaveUnica: digitsOnly(data.chave),
        docUnicoPorChave: true,
        numeroNf: data.numeroNf || '',
        cnpj: data.cnpj || '',
        empresa: data.empresa || '',
        fornecedorId: data.fornecedorId || '',
        fornecedorNome: data.fornecedorNome || '',
        fornecedorTexto: data.fornecedorTexto || '',
        categoriaFornecedor,
        tipoNota: categoriaFornecedor,
        fila: effectiveFila,
        filaNome: effectiveFilaNome,
        tipoDivergencia: effectiveTipo,
        tipoDivergenciaNome: effectiveTipoNome,
        compradorId: effectiveCompradorId,
        compradorNome: effectiveCompradorNome,
        ultimaDescricaoInfradesk: data.ultimaDescricao || '',
        statusInfradesk: data.statusInfradesk || '',
        atualizadoEm: now,
        ultimaOcorrenciaTexto: comment,
        ultimaOcorrenciaUsuarioId: state.user.uid,
        ultimaOcorrenciaUsuarioNome: selectedUserName(),
        ultimaOcorrenciaUsuarioEmail: state.user.email,
        ultimaOcorrenciaEm: now
      };

      if (!exists) {
        await ref.set({
          ...basePayload,
          status: finalStatus,
          abertoPor: state.user.uid,
          abertoPorNome: selectedUserName(),
          abertoPorEmail: state.user.email,
          abertoPorPapel: state.profile?.papel || '',
          criadoEm: now,
          ocorrenciasCount: 1
        }, { merge: true });
      } else {
        await ref.update({
          ...basePayload,
          ...ticketStatusPayload(finalStatus),
          ocorrenciasCount: firebase.firestore.FieldValue.increment(1)
        });
      }

      await ref.collection('historico').add({
        texto: comment,
        tipo: historyType,
        status: finalStatus,
        fila: effectiveFila,
        filaNome: effectiveFilaNome,
        tipoDivergencia: effectiveTipo,
        tipoDivergenciaNome: effectiveTipoNome,
        compradorId: effectiveCompradorId,
        compradorNome: effectiveCompradorNome,
        chamadoInfradeskId: data.chamadoId || '',
        usuarioId: state.user.uid,
        usuarioNome: selectedUserName(),
        usuarioEmail: state.user.email,
        criadoEm: now
      });

      if (state.activeFornecedorRef) {
        await state.activeFornecedorRef.set({
          fornecedorId: data.fornecedorId || '',
          fornecedorNome: data.fornecedorNome || '',
          fornecedorTexto: data.fornecedorTexto || '',
          tipoNota: categoriaFornecedor,
          atualizadoEm: now,
          atualizadoPor: state.user.uid,
          atualizadoPorEmail: state.user.email
        }, { merge: true });
      }

      const localTicket = {
        id: ref.id,
        ...basePayload,
        status: finalStatus,
        ultimaOcorrenciaEm: new Date(),
        atualizadoEm: new Date(),
        ultimaOcorrenciaEmMs: Date.now(),
        atualizadoEmMs: Date.now()
      };

      rememberTicket(localTicket);
      if (shouldMonitorTicket(localTicket)) startTicketMonitor(ref, localTicket);

      // Alimenta todos os cards visíveis com a mesma chave, não só o card clicado.
      renderCardsForChave(data.chave);
      syncVisibleKnownMonitors();

      const msg = !exists
        ? 'Divergência aberta no Comercial.'
        : finalStatus === 'reaberto'
          ? 'Divergência existente reaberta no Comercial.'
          : 'Essa chave já tinha chamado no Comercial. Ocorrência adicionada no chamado existente.';

      showToast(msg, 'success');
      closeModal();
    } catch (error) {
      console.error('[Comercial] Erro ao salvar:', error);
      showToast(error?.code === 'permission-denied' ? 'Permissão negada pelo Firestore. Atualize as regras do Comercial.' : (error.message || 'Erro ao salvar divergência.'), 'error');
    } finally {
      state.isSaving = false;
      const currentBtn = $('#comercial-save');
      if (currentBtn) {
        currentBtn.disabled = !canOpenTicket();
        currentBtn.textContent = originalText;
      }
    }
  }

  /********************************************************************
   * OBSERVADOR DO KANBAN
   ********************************************************************/
  const observer = new MutationObserver(() => {
    window.clearTimeout(state.scanTimer);
    state.scanTimer = window.setTimeout(scanCards, 300);
  });

  function boot() {
    injectStyles();
    ensureModal();
    scanCards();

    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('focus', scanCards);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scanCards();
    });

    console.log(`[Comercial] v${COMERCIAL_VERSION} carregado. Login Google/e-mail, Firebase separado e loader page-context.`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();