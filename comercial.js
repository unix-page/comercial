// ==UserScript==
// @name         Comercial • Infradesk → Divergências NF
// @namespace    comercial/infradesk
// @version      1.0.1
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
  const COMERCIAL_VERSION = window.__COMERCIAL_REMOTE_VERSION__ || '1.0.1-loader-ready';
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
    em_tratamento: 'Em tratamento',
    resolvido: 'Resolvido',
    cancelado: 'Cancelado'
  };

  const state = {
    authReady: false,
    user: null,
    profile: null,
    profileLoading: null,
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
    return `nf_${hashText(`${TIPO_CHAMADO}:${digitsOnly(chave)}:${fila}:${tipoDivergencia}`)}`;
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

    const cache = readCache();
    const now = Date.now();
    const entry = cache[key] || { cachedAt: now, tickets: [] };
    const tickets = Array.isArray(entry.tickets) ? entry.tickets : [];

    const compact = {
      ...ticket,
      atualizadoEmMs: ticket.atualizadoEmMs || Date.now(),
      ultimaOcorrenciaEmMs: ticket.ultimaOcorrenciaEmMs || Date.now()
    };

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

    showToast('Lista de divergências atualizada.', 'success');
  }

  async function createDefaultConfig() {
    await saveDivergenciasConfig(cloneData(DEFAULT_DIVERGENCIAS));
  }

  async function addDivergenceType() {
    if (!isAdmin()) return showToast('Somente admin pode criar tipo de divergência.', 'error');

    const filaRaw = prompt('Criar tipo em qual fila? Digite: compras ou cadastro', $('#comercial-fila')?.value || 'compras');
    const fila = safeDocPart(filaRaw || '');
    if (!['compras', 'cadastro'].includes(fila)) return showToast('Fila inválida. Use compras ou cadastro.', 'error');

    const nome = normalizeText(prompt(`Nome do novo tipo para ${fila}:`) || '');
    if (!nome) return;

    const config = normalizeDivergenciasConfig(state.divergenciasConfig || DEFAULT_DIVERGENCIAS);
    const id = safeDocPart(nome);
    if (config[fila].tipos.some((item) => item.id === id)) {
      showToast('Esse tipo já existe.', 'error');
      return;
    }

    config[fila].tipos.push({ id, nome });
    await saveDivergenciasConfig(config);

    const filaSelect = $('#comercial-fila');
    if (filaSelect) filaSelect.value = fila;
    renderDivergenciaOptions();

    const tipoSelect = $('#comercial-tipo-divergencia');
    if (tipoSelect) tipoSelect.value = id;
  }

  async function deleteSelectedDivergenceType() {
    if (!isAdmin()) return showToast('Somente admin pode excluir tipo de divergência.', 'error');

    const fila = $('#comercial-fila')?.value || 'compras';
    const tipo = $('#comercial-tipo-divergencia')?.value || '';
    if (!tipo) return showToast('Selecione um tipo para excluir.', 'error');

    const tipoNome = $('#comercial-tipo-divergencia')?.selectedOptions?.[0]?.textContent || tipo;
    if (!confirm(`Excluir o tipo "${tipoNome}" da fila ${fila}?`)) return;

    const config = normalizeDivergenciasConfig(state.divergenciasConfig || DEFAULT_DIVERGENCIAS);
    config[fila].tipos = config[fila].tipos.filter((item) => item.id !== tipo);

    if (!config[fila].tipos.length) {
      showToast('A fila precisa ter pelo menos um tipo.', 'error');
      return;
    }

    await saveDivergenciasConfig(config);
  }

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

  function activeLinkedCompradorIds() {
    const fornecedor = state.activeFornecedor || {};
    const ids = [];

    if (Array.isArray(fornecedor.compradorIds)) {
      fornecedor.compradorIds.forEach((id) => {
        const clean = normalizeText(id);
        if (clean && !ids.includes(clean)) ids.push(clean);
      });
    }

    // Compatibilidade com a primeira versão, que gravava compradores dentro do fornecedor.
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
  }

  function renderCompradorSelect() {
    const select = $('#comercial-comprador');
    const hint = $('#comercial-comprador-hint');
    const deleteBtn = $('#comercial-delete-buyer');
    if (!select) return;

    const todos = allCompradores();
    const linkedIds = activeLinkedCompradorIds();
    const linked = linkedIds.map(compradorById).filter(Boolean);
    const usingLinkedList = linked.length > 0;
    const options = usingLinkedList ? linked : todos;

    select.innerHTML = '';

    const empty = document.createElement('option');
    empty.value = '';
    if (usingLinkedList) empty.textContent = options.length > 1 ? 'Selecione o comprador vinculado' : 'Comprador vinculado ao CNPJ';
    else empty.textContent = todos.length ? 'Selecione comprador para vincular ao CNPJ' : 'Nenhum comprador cadastrado';
    select.appendChild(empty);

    options.forEach((comprador) => {
      const opt = document.createElement('option');
      opt.value = comprador.id;
      opt.textContent = comprador.nome;
      opt.dataset.nome = comprador.nome;
      opt.dataset.linked = linkedIds.includes(comprador.id) ? '1' : '0';
      select.appendChild(opt);
    });

    if (options.length === 1) {
      select.value = options[0].id;
    } else {
      select.value = '';
    }

    if (hint) {
      if (usingLinkedList && options.length === 1) {
        hint.textContent = '1 comprador vinculado ao CNPJ: já deixei selecionado.';
      } else if (usingLinkedList && options.length > 1) {
        hint.textContent = 'Mais de 1 comprador vinculado ao CNPJ: escolha quem vai tratar.';
      } else if (!todos.length) {
        hint.textContent = '';
      } else if (todos.length === 1) {
        hint.textContent = '1 comprador cadastrado no sistema; ao salvar/vincular ele será ligado ao CNPJ.';
      } else {
        hint.textContent = 'Nenhum comprador vinculado ainda; selecione um comprador e clique em Vincular.';
      }
    }

    if (deleteBtn) deleteBtn.style.display = isAdmin() ? '' : 'none';
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

  async function linkSelectedBuyerToActiveSupplier() {
    if (!state.user || !state.profile) return showToast('Entre no Comercial antes de vincular comprador.', 'error');

    const compradorId = $('#comercial-comprador')?.value || '';
    if (!compradorId) return showToast('Selecione um comprador para vincular ao CNPJ.', 'error');

    await persistFornecedorBuyerLink(compradorId, false);
  }

  async function addBuyerForActiveSupplier() {
    const data = state.activeData;
    if (!data) return showToast('Nenhum card ativo.', 'error');

    if (!state.user || !state.profile) {
      showToast('Entre no Comercial antes de cadastrar comprador.', 'error');
      return;
    }

    const nome = normalizeText(prompt('Nome do novo comprador:') || '');
    if (!nome) return;

    let compradorId = `${safeDocPart(nome)}_${hashText(nome).slice(0, 6)}`;
    const existing = allCompradores().find((item) => normalizeAscii(item.nome) === normalizeAscii(nome));

    try {
      if (existing) {
        compradorId = existing.id;
      } else {
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

        await loadCompradoresConfig(true);
      }

      await persistFornecedorBuyerLink(compradorId, true);
      renderCompradorSelect();
      const select = $('#comercial-comprador');
      if (select) select.value = compradorId;
      showToast(existing ? 'Comprador já existia e foi vinculado ao CNPJ.' : 'Comprador criado e vinculado ao CNPJ.', 'success');
    } catch (error) {
      console.error('[Comercial] Erro ao cadastrar comprador:', error);
      showToast(error?.code === 'permission-denied' ? 'Permissão negada para cadastrar comprador. Atualize as regras.' : (error.message || 'Erro ao cadastrar comprador.'), 'error');
    }
  }

  async function deleteSelectedBuyer() {
    if (!isAdmin()) return showToast('Somente admin pode excluir comprador da lista.', 'error');

    const compradorId = $('#comercial-comprador')?.value || '';
    if (!compradorId) return showToast('Selecione um comprador para excluir.', 'error');

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
      showToast('Comprador excluído da lista.', 'success');
    } catch (error) {
      console.error('[Comercial] Erro ao excluir comprador:', error);
      showToast(error?.code === 'permission-denied' ? 'Permissão negada. Somente admin pode excluir comprador.' : (error.message || 'Erro ao excluir comprador.'), 'error');
    }
  }

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
      .comercial-box{clear:both;margin:9px 0 10px;padding:0;border:1px solid rgba(219,39,119,.20);background:#fff;border-radius:12px;color:#172033;font-size:12px;line-height:1.35;overflow:hidden;box-shadow:0 10px 22px rgba(15,23,42,.10)}
      .comercial-box-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;font-weight:900;color:#fff;background:linear-gradient(135deg,#db2777,#f97316)}
      .comercial-box-title{display:inline-flex;align-items:center;gap:6px;min-width:0}
      .comercial-box-title img{width:18px;height:18px;border-radius:5px;flex:0 0 auto}
      .comercial-chip{display:inline-flex;align-items:center;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:900;background:rgba(255,255,255,.96);color:#be185d;border:1px solid rgba(255,255,255,.65);white-space:nowrap}
      .comercial-box-body{padding:8px 9px 9px;background:#fff7ed;border-left:4px solid #db2777}
      .comercial-last-text{margin-top:3px;padding:6px 7px;border-radius:9px;background:#fff;border:1px solid #fed7aa;color:#334155;overflow-wrap:anywhere;white-space:pre-wrap}
      .comercial-box small{color:#64748b;display:block;margin-top:5px}
      .comercial-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:999999;display:none;align-items:center;justify-content:center;padding:20px}
      .comercial-overlay.open{display:flex}
      .comercial-modal{width:min(640px,calc(100vw - 32px));max-height:calc(100vh - 36px);background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.22);overflow:auto;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .comercial-modal-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:#fff;z-index:2}
      .comercial-modal-head img{width:34px;height:34px;border-radius:10px}
      .comercial-modal-head h3{margin:0;font-size:16px;color:#172033}
      .comercial-modal-head p{margin:2px 0 0;color:#687386;font-size:12px}
      .comercial-close{margin-left:auto;border:0;border-radius:10px;background:#f1f5f9;width:34px;height:34px;font-size:18px;line-height:1;cursor:pointer}
      .comercial-modal-body{padding:12px;display:grid;gap:8px}
      .comercial-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .comercial-grid-3{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}
      .comercial-info{border:1px solid #fbcfe8;background:#fdf2f8;color:#831843;padding:8px 10px;border-radius:10px;font-size:11px;line-height:1.35}
      .comercial-field{display:grid;gap:4px}
      .comercial-field label{font-weight:800;color:#687386;font-size:11px}
      .comercial-field select,.comercial-field input,.comercial-field textarea{width:100%;border:1px solid #dfe7f0;border-radius:10px;padding:7px 9px;outline:none;color:#172033;background:#fff;font-size:12px}
      .comercial-field textarea{min-height:56px;resize:vertical}
      .comercial-field select:focus,.comercial-field input:focus,.comercial-field textarea:focus{border-color:#db2777;box-shadow:0 0 0 3px rgba(219,39,119,.12)}
      .comercial-field small{font-size:11px;color:#64748b}
      .comercial-actions{display:flex;gap:8px;justify-content:flex-end;padding:8px 12px 12px;position:sticky;bottom:0;background:#fff;border-top:1px solid #eef2f7}
      .comercial-btn{border:0;border-radius:10px;padding:8px 12px;font-weight:800;min-height:34px;cursor:pointer;font-size:12px}
      .comercial-btn.primary{background:#db2777;color:#fff}
      .comercial-btn.ghost{background:#f8fafc;border:1px solid #dfe7f0;color:#172033}
      .comercial-btn.warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412}
      .comercial-btn.small{min-height:34px;padding:8px 10px;font-size:12px}
      .comercial-btn.round{width:34px;padding:0;font-size:18px}
      .comercial-btn:disabled{opacity:.6;cursor:not-allowed}
      .comercial-authbar{padding:8px 10px;border-radius:10px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;font-size:11px}
      .comercial-authbar.ok{background:#ecfdf3;color:#067647;border-color:#bbf7d0}
      .comercial-login-panel{display:none;border:1px solid #fbcfe8;background:#fdf2f8;border-radius:10px;padding:8px 10px;gap:8px}
      .comercial-login-panel.open{display:grid}
      .comercial-login-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .comercial-login-actions,.comercial-config-actions{display:flex;gap:8px;flex-wrap:wrap}
      .comercial-config-actions{padding:8px 10px;border:1px dashed #f9a8d4;background:#fff7fb;border-radius:10px}
      .comercial-toast{position:fixed;top:18px;right:18px;z-index:1000000;background:#111827;color:#fff;padding:12px 14px;border-radius:12px;box-shadow:0 18px 45px rgba(15,23,42,.18);max-width:min(420px,calc(100vw - 36px));display:none}
      .comercial-toast.open{display:block}
      .comercial-toast.success{background:#067647}
      .comercial-toast.error{background:#b42318}
      .comercial-buyer-actions{display:flex;gap:6px;align-items:end;flex-wrap:wrap}.comercial-buyer-actions .comercial-btn{white-space:nowrap}@media(max-width:760px){.comercial-grid,.comercial-grid-3,.comercial-login-grid{grid-template-columns:1fr}.comercial-actions{flex-wrap:wrap}}
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
          <div>
            <h3 id="comercial-modal-title">Abrir Comercial</h3>
            <p>${TIPO_CHAMADO_NOME}</p>
          </div>
          <button id="comercial-close" class="comercial-close" type="button">×</button>
        </div>

        <div class="comercial-modal-body">
          <div id="comercial-authbar" class="comercial-authbar">Verificando login...</div>

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

          <div id="comercial-config-actions" class="comercial-config-actions" style="display:none">
            <button id="comercial-create-default-list" class="comercial-btn warn small" type="button">Criar lista padrão no Firebase</button>
            <button id="comercial-add-type" class="comercial-btn ghost small" type="button">+ Novo tipo</button>
            <button id="comercial-delete-type" class="comercial-btn ghost small" type="button">Excluir tipo selecionado</button>
          </div>

          <div class="comercial-grid">
            <div class="comercial-field">
              <label for="comercial-fornecedor">Fornecedor</label>
              <input id="comercial-fornecedor" type="text" readonly>
            </div>

            <div class="comercial-field">
              <label for="comercial-categoria">Tipo real da nota</label>
              <input id="comercial-categoria" type="text" readonly>
            </div>
          </div>

          <div id="comercial-comprador-wrap" class="comercial-grid-3">
            <div class="comercial-field">
              <label for="comercial-comprador">Comprador</label>
              <select id="comercial-comprador"></select>
              <small id="comercial-comprador-hint"></small>
            </div>
            <div class="comercial-buyer-actions">
              <button id="comercial-link-buyer" class="comercial-btn ghost small" type="button" title="Vincular comprador selecionado ao CNPJ">Vincular</button>
              <button id="comercial-add-buyer" class="comercial-btn primary round" type="button" title="Criar comprador e vincular ao CNPJ">+</button>
              <button id="comercial-delete-buyer" class="comercial-btn ghost small" type="button" title="Excluir comprador da lista geral">Excluir</button>
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
    $('#comercial-add-buyer').addEventListener('click', addBuyerForActiveSupplier);
    $('#comercial-link-buyer').addEventListener('click', linkSelectedBuyerToActiveSupplier);
    $('#comercial-delete-buyer').addEventListener('click', deleteSelectedBuyer);
    $('#comercial-create-default-list').addEventListener('click', createDefaultConfig);
    $('#comercial-add-type').addEventListener('click', addDivergenceType);
    $('#comercial-delete-type').addEventListener('click', deleteSelectedDivergenceType);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeModal();
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
    const authbar = $('#comercial-authbar');
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
      authbar.className = 'comercial-authbar';
      authbar.innerHTML = 'Entre com Google ou e-mail/senha do Comercial.';
      saveBtn.disabled = true;
      renderConfigControls();
      return;
    }

    if (!state.profile) {
      authbar.className = 'comercial-authbar';
      authbar.innerHTML = `Logado como <strong>${escapeHtml(state.user.email)}</strong>, aguardando perfil Comercial.`;
      saveBtn.disabled = true;
      renderConfigControls();
      return;
    }

    if (state.profile.ativo === false) {
      authbar.className = 'comercial-authbar';
      authbar.innerHTML = 'Sua conta Comercial está bloqueada.';
      saveBtn.disabled = true;
      renderConfigControls();
      return;
    }

    if (!canOpenTicket()) {
      authbar.className = 'comercial-authbar';
      authbar.innerHTML = `Logado como <strong>${escapeHtml(state.profile.nome || state.user.email)}</strong>, mas este perfil não abre divergência pelo Infradesk.`;
      saveBtn.disabled = true;
      renderConfigControls();
      return;
    }

    authbar.className = 'comercial-authbar ok';
    authbar.innerHTML = `Salvando como <strong>${escapeHtml(state.profile.nome || state.user.email)}</strong> • Perfil: <strong>${escapeHtml(state.profile.papel || '—')}</strong>.`;
    saveBtn.disabled = false;
    renderConfigControls();
  }

  function renderConfigControls() {
    const box = $('#comercial-config-actions');
    if (!box) return;

    box.style.display = isAdmin() ? 'flex' : 'none';

    const defaultBtn = $('#comercial-create-default-list');
    if (defaultBtn) defaultBtn.style.display = state.divergenciasConfigExists ? 'none' : '';
  }

  function renderFilaOptions() {
    const select = $('#comercial-fila');
    if (!select) return;

    const config = normalizeDivergenciasConfig(state.divergenciasConfig || DEFAULT_DIVERGENCIAS);
    const previous = select.value || 'compras';

    select.innerHTML = '';
    Object.entries(config).forEach(([fila, def]) => {
      const opt = document.createElement('option');
      opt.value = fila;
      opt.textContent = def.nome || fila;
      select.appendChild(opt);
    });

    select.value = config[previous] ? previous : 'compras';
    renderBuyerRequirement();
  }

  function renderDivergenciaOptions() {
    const select = $('#comercial-tipo-divergencia');
    const fila = $('#comercial-fila')?.value || 'compras';
    if (!select) return;

    const config = normalizeDivergenciasConfig(state.divergenciasConfig || DEFAULT_DIVERGENCIAS);
    const tipos = config[fila]?.tipos || [];

    const previous = select.value;
    select.innerHTML = '';

    tipos.forEach((tipo) => {
      const opt = document.createElement('option');
      opt.value = tipo.id;
      opt.textContent = tipo.nome;
      select.appendChild(opt);
    });

    if (tipos.some((item) => item.id === previous)) select.value = previous;
  }

  function renderCategoriaOptions(value) {
    const input = $('#comercial-categoria');
    if (!input) return;
    input.value = canonicalCategoria(value) || '—';
  }

  function renderBuyerRequirement() {
    const fila = $('#comercial-fila')?.value || 'compras';
    const wrap = $('#comercial-comprador-wrap');
    if (!wrap) return;

    wrap.style.display = fila === 'compras' ? 'grid' : 'none';
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
    const tickets = cachedTickets(data.chave);

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
    const count = tickets.length;
    const status = top.status || 'aberto';
    const label = STATUS_LABELS[status] || status;

    const resumo = tickets
      .slice(0, 3)
      .map((ticket) => {
        const comprador = ticket.compradorNome ? ` • ${ticket.compradorNome}` : '';
        return `${ticket.filaNome || ticket.fila || '—'} / ${ticket.tipoDivergenciaNome || ticket.tipoDivergencia || '—'}${comprador}`;
      })
      .join('\n');

    box.className = `comercial-box comercial-status-${String(status).replace(/[^a-z0-9_-]/gi, '_')}`;
    box.innerHTML = `
      <div class="comercial-box-head">
        <span class="comercial-box-title"><img src="${COMERCIAL_ICON_URL}" alt=""> Comercial</span>
        <span class="comercial-chip">${escapeHtml(label)}${count > 1 ? ` • ${count}` : ''}</span>
      </div>
      <div class="comercial-box-body">
        <div><strong>Divergência registrada</strong></div>
        <div class="comercial-last-text">${escapeHtml(resumo)}</div>
        <small>${escapeHtml(top.ultimaOcorrenciaTexto || 'Registrado no Comercial.')} • ${escapeHtml(formatDate(top.ultimaOcorrenciaEm || top.atualizadoEm))}</small>
      </div>
    `;
  }

  /********************************************************************
   * MODAL E LOGIN
   ********************************************************************/
  async function openModal(card) {
    if (!isTargetCard(card)) {
      showToast('O Comercial está habilitado apenas na coluna Em Análise Terceiro.', 'error');
      return;
    }

    state.activeCard = card;
    state.activeData = parseCard(card);
    state.activeFornecedor = null;
    state.activeFornecedorRef = null;

    if (!state.activeData.chave || state.activeData.chave.length !== 44) {
      showToast('Não encontrei uma chave NF-e de 44 dígitos neste card.', 'error');
      return;
    }

    $('#comercial-info').innerHTML = renderActiveDataInfo(state.activeData);
    $('#comercial-fornecedor').value = state.activeData.fornecedorNome || '';
    $('#comercial-comment').value = '';
    renderCategoriaOptions(state.activeData.categoriaFornecedor);

    if (state.user && !state.profile) await loadProfileIfNeeded(false);

    renderAuthInfo();

    await loadDivergenciasConfig(false);
    await loadCompradoresConfig(false);
    renderFilaOptions();
    renderDivergenciaOptions();
    renderConfigControls();

    $('#comercial-overlay').classList.add('open');

    if (state.user && state.profile) {
      await loadFornecedorCompradores(state.activeData);
    } else {
      renderCompradorSelect();
    }

    setTimeout(() => $('#comercial-tipo-divergencia')?.focus(), 50);
  }

  function renderActiveDataInfo(data) {
    return `
      <div><strong>Chamado:</strong> ${escapeHtml(data.chamadoId || '—')} • <strong>Status:</strong> ${escapeHtml(data.statusInfradesk || '—')}</div>
      <div><strong>Chave:</strong> ${escapeHtml(data.chave)}</div>
      <div><strong>NF:</strong> ${escapeHtml(data.numeroNf || '—')} • <strong>CNPJ:</strong> ${escapeHtml(data.cnpj || '—')}</div>
      <div><strong>Empresa:</strong> ${escapeHtml(data.empresa || '—')}</div>
      <div><strong>Fornecedor:</strong> ${escapeHtml(data.fornecedorTexto || data.fornecedorNome || '—')} • <strong>Tipo da nota:</strong> ${escapeHtml(data.categoriaFornecedor || '—')}</div>
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

      await auth.signOut();

      state.user = null;
      state.profile = null;
      state.profileLoading = null;
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
      showToast('Divergência de Compras exige comprador. Escolha ou cadastre pelo botão +.', 'error');
      $('#comercial-comprador')?.focus();
      return;
    }

    const categoriaFornecedor = $('#comercial-categoria')?.value || data.categoriaFornecedor || '';

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
        saveBtn.textContent = 'Salvando...';
      }

      const docId = comercialDocId(data.chave, divergence.fila, divergence.tipoDivergencia);
      const ref = db.collection('comercial_chamados').doc(docId);
      const snap = await ref.get();
      const exists = snap.exists;
      const now = firebase.firestore.FieldValue.serverTimestamp();

      const basePayload = {
        tipoChamado: TIPO_CHAMADO,
        chamadoInfradeskId: data.chamadoId || '',
        chave: data.chave,
        chaveBusca: `${TIPO_CHAMADO}:${digitsOnly(data.chave)}`,
        numeroNf: data.numeroNf || '',
        cnpj: data.cnpj || '',
        empresa: data.empresa || '',
        fornecedorId: data.fornecedorId || '',
        fornecedorNome: data.fornecedorNome || '',
        fornecedorTexto: data.fornecedorTexto || '',
        categoriaFornecedor,
        tipoNota: categoriaFornecedor,
        fila: divergence.fila,
        filaNome: divergence.filaNome,
        tipoDivergencia: divergence.tipoDivergencia,
        tipoDivergenciaNome: divergence.tipoDivergenciaNome,
        compradorId: divergence.fila === 'compras' ? comprador.compradorId : '',
        compradorNome: divergence.fila === 'compras' ? comprador.compradorNome : '',
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
          status: 'aberto',
          abertoPor: state.user.uid,
          abertoPorNome: selectedUserName(),
          abertoPorEmail: state.user.email,
          abertoPorPapel: state.profile?.papel || '',
          criadoEm: now,
          ocorrenciasCount: 1
        });
      } else {
        await ref.update({
          ...basePayload,
          ocorrenciasCount: firebase.firestore.FieldValue.increment(1)
        });
      }

      await ref.collection('historico').add({
        texto: comment,
        tipo: exists ? 'observacao' : 'criacao',
        fila: divergence.fila,
        filaNome: divergence.filaNome,
        tipoDivergencia: divergence.tipoDivergencia,
        tipoDivergenciaNome: divergence.tipoDivergenciaNome,
        compradorId: divergence.fila === 'compras' ? comprador.compradorId : '',
        compradorNome: divergence.fila === 'compras' ? comprador.compradorNome : '',
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
        status: 'aberto',
        ultimaOcorrenciaEm: new Date(),
        atualizadoEm: new Date(),
        ultimaOcorrenciaEmMs: Date.now(),
        atualizadoEmMs: Date.now()
      };

      rememberTicket(localTicket);

      if (card) renderCardBox(card, cachedTickets(data.chave));

      showToast(exists ? 'Ocorrência adicionada no Comercial.' : 'Divergência aberta no Comercial.', 'success');
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
