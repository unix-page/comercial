// ==UserScript==
// @name         Xabuia • Infradesk → Firestore manual econômico
// @namespace    xabuia/infradesk
// @version      3.2.18
// @description  Xabuia Infradesk compatível com outros aplicativos Firebase na mesma página, login híbrido e modo econômico.
// @author       Xabuia
// @match        https://*.infradesk.app/backend/chamados/painel*
// @match        https://*.infradesk.app/backend/chamados*
// @run-at       document-end
// @icon         https://chamadossicofe-design.github.io/xabuia/xabuia.png
// @homepageURL  https://chamadossicofe-design.github.io/xabuia/
// @updateURL    https://chamadossicofe-design.github.io/xabuia/xabuiaasp.js
// @downloadURL  https://chamadossicofe-design.github.io/xabuia/xabuiaasp.js
// @grant        none
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.__XABUIA_APP_RUNNING__) {
    console.warn('[Xabuia] Já existe uma instância do Xabuia ativa nesta página. Ignorando segunda carga.');
    return;
  }
  window.__XABUIA_APP_RUNNING__ = true;
  window.__XABUIA_APP_STARTED_AT__ = Date.now();
  window.__XABUIA_APP_EXECUTION_MODE__ = window.__XABUIA_REMOTE_LOADER_ACTIVE ? 'loader-page-context' : 'tampermonkey-direto';

  /********************************************************************
   * CONFIGURAÇÕES
   ********************************************************************/
  const XABUIA_VERSION = window.__XABUIA_REMOTE_VERSION || '3.2.18-campainha-compacta';
  const XABUIA_ICON_URL = 'https://chamadossicofe-design.github.io/xabuia/xabuia.png';
  const XABUIA_BLIN_URL = 'https://chamadossicofe-design.github.io/xabuia/blin.mp3';
  const XABUIA_UPDATE_URL = 'https://chamadossicofe-design.github.io/xabuia/xabuiaasp.js';
  const XABUIA_VERSION_CHECK_EVERY_MS = 1000 * 60 * 60 * 4; // 4 horas = até 6 verificações por dia
  const XABUIA_UPDATE_CACHE_KEY = 'xabuia_force_update_cache_v1';
  const BOOTSTRAP_ADMIN_EMAIL = 'chamadossicofe@gmail.com';
  const XABUIA_CACHE_KEY = 'xabuia_tm_cache_v23_manual';
  const XABUIA_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
  const XABUIA_PROFILE_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
  const XABUIA_PROFILE_CACHE_PREFIX = 'xabuia_tm_profile_v23_';
  const XABUIA_TARGET_STATUS_ID = '6';
  const XABUIA_TARGET_STATUS_DESC = 'em analise terceiro';

  const firebaseConfig = {
    apiKey: 'AIzaSyADfd6RhNN6rj6qX1judbjevvh-ZwMwmJE',
    authDomain: 'chamadossicofe-36fbe.firebaseapp.com',
    projectId: 'chamadossicofe-36fbe',
    storageBucket: 'chamadossicofe-36fbe.firebasestorage.app',
    messagingSenderId: '81395419196',
    appId: '1:81395419196:web:8322d61652f6240b49db39'
  };

  /********************************************************************
   * TRAVA DE ATUALIZAÇÃO OBRIGATÓRIA
   * Lê o MESMO xabuiaasp.js publicado no GitHub Pages.
   * Se existir @version maior, bloqueia o uso até atualizar.
   ********************************************************************/
  const versionGateState = {
    blocked: false,
    latestVersion: '',
    checking: null
  };

  function readUpdateCache() {
    try { return JSON.parse(localStorage.getItem(XABUIA_UPDATE_CACHE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  function writeUpdateCache(data) {
    try { localStorage.setItem(XABUIA_UPDATE_CACHE_KEY, JSON.stringify(data || {})); } catch (_) {}
  }

  function extractMetaVersion(scriptText) {
    const match = String(scriptText || '').match(/\/\/\s*@version\s+([^\s]+)/i);
    return match ? match[1].trim() : '';
  }

  function compareVersions(installed, latest) {
    const a = String(installed || '0').match(/\d+/g)?.map(Number) || [0];
    const b = String(latest || '0').match(/\d+/g)?.map(Number) || [0];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      const left = a[i] || 0;
      const right = b[i] || 0;
      if (left > right) return 1;
      if (left < right) return -1;
    }
    return 0;
  }

  function cacheBustUrl(url) {
    return `${url}${String(url).includes('?') ? '&' : '?'}xabuia_update_check=${Date.now()}`;
  }

  function copyUpdateUrlToClipboard() {
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(XABUIA_UPDATE_URL, 'text');
      else navigator.clipboard?.writeText?.(XABUIA_UPDATE_URL);
    } catch (_) {}
  }

  function openUpdateUrl() {
    copyUpdateUrlToClipboard();
    // Abre o link oficial sem passar pela tela intermediária do Tampermonkey.
    // Em alguns Chrome/Tampermonkey, script_installation.php gera chrome-extension://... quebrado.
    window.open(XABUIA_UPDATE_URL, '_blank', 'noopener,noreferrer');
  }

  function getRemoteScriptText(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest indisponível. Atualize/reinstale o script Xabuia.'));
        return;
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url: cacheBustUrl(url),
        nocache: true,
        revalidate: true,
        timeout: 15000,
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache'
        },
        onload(response) {
          if (response.status >= 200 && response.status < 300 && response.responseText) {
            resolve(response.responseText);
          } else {
            reject(new Error(`Não consegui consultar a versão publicada. HTTP ${response.status}`));
          }
        },
        onerror() { reject(new Error('Falha de rede ao consultar a versão publicada.')); },
        ontimeout() { reject(new Error('Tempo esgotado ao consultar a versão publicada.')); }
      });
    });
  }

  function xabuiaIsUpdateBlocked() {
    // V3.2.9: teste híbrido sem trava obrigatória interna.
    // Mantém @updateURL/@downloadURL para o Tampermonkey atualizar, mas não bloqueia o uso.
    return false;
  }

  function removeXabuiaUiForUpdateBlock() {
    document.querySelectorAll('.xabuia-card-btn,.xabuia-box').forEach((el) => el.remove());
    const modal = document.getElementById('xabuia-overlay');
    if (modal) modal.classList.remove('open');
  }

  function showXabuiaUpdateBlock(latestVersion = '') {
    versionGateState.blocked = true;
    if (latestVersion) versionGateState.latestVersion = latestVersion;
    removeXabuiaUiForUpdateBlock();

    let overlay = document.getElementById('xabuia-force-update-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'xabuia-force-update-overlay';
      overlay.innerHTML = `
        <div class="xabuia-force-update-card">
          <img src="${XABUIA_ICON_URL}" alt="Xabuia">
          <h2>Atualização obrigatória do Xabuia</h2>
          <p>Existe uma versão nova publicada. Para evitar erro e manter todos no mesmo padrão, esta versão instalada foi bloqueada.</p>
          <div class="xabuia-force-update-versions">
            <span>Instalada: <strong id="xabuia-installed-version"></strong></span>
            <span>Publicada: <strong id="xabuia-latest-version"></strong></span>
          </div>
          <button id="xabuia-update-now" type="button">Abrir link oficial e copiar URL</button>
          <button id="xabuia-reload-after-update" type="button">Já atualizei, recarregar página</button>
          <small>Se abrir apenas o código, clique no ícone do Tampermonkey e use Verificar atualizações. O link oficial já foi copiado para facilitar.</small>
        </div>
      `;

      const style = document.createElement('style');
      style.id = 'xabuia-force-update-style';
      style.textContent = `
        #xabuia-force-update-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.78);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        .xabuia-force-update-card{width:min(480px,calc(100vw - 32px));background:#fff;border-radius:22px;box-shadow:0 28px 80px rgba(0,0,0,.34);padding:24px;text-align:center;color:#172033}
        .xabuia-force-update-card img{width:62px;height:62px;border-radius:16px;margin-bottom:10px}
        .xabuia-force-update-card h2{font-size:22px;margin:6px 0 8px;color:#111827}
        .xabuia-force-update-card p{font-size:14px;line-height:1.45;color:#475569;margin:0 0 14px}
        .xabuia-force-update-versions{display:grid;gap:6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:10px;margin:12px 0 16px;text-align:left;font-size:13px}
        .xabuia-force-update-card button{width:100%;border:0;border-radius:14px;min-height:44px;padding:10px 14px;font-weight:900;cursor:pointer;margin-top:8px}
        #xabuia-update-now{background:#155eef;color:#fff}
        #xabuia-reload-after-update{background:#f8fafc;color:#172033;border:1px solid #dfe7f0}
        .xabuia-force-update-card small{display:block;color:#64748b;margin-top:12px;font-size:12px}
      `;
      document.head.appendChild(style);
      document.body.appendChild(overlay);

      document.getElementById('xabuia-update-now')?.addEventListener('click', () => {
        openUpdateUrl();
      });

      document.getElementById('xabuia-reload-after-update')?.addEventListener('click', () => {
        window.location.reload();
      });
    }

    const installedEl = document.getElementById('xabuia-installed-version');
    const latestEl = document.getElementById('xabuia-latest-version');
    if (installedEl) installedEl.textContent = XABUIA_VERSION || 'desconhecida';
    if (latestEl) latestEl.textContent = versionGateState.latestVersion || latestVersion || 'consultando...';
  }

  function clearXabuiaUpdateBlockIfCurrent() {
    const cache = readUpdateCache();
    const latest = versionGateState.latestVersion || cache.latestVersion || '';
    if (!latest || compareVersions(XABUIA_VERSION, latest) >= 0) {
      versionGateState.blocked = false;
      document.getElementById('xabuia-force-update-overlay')?.remove();
    }
  }

  async function checkXabuiaLatestVersion(force = false) {
    const cache = readUpdateCache();
    const now = Date.now();

    if (!force && cache.lastCheckAt && now - Number(cache.lastCheckAt) < XABUIA_VERSION_CHECK_EVERY_MS) {
      if (xabuiaIsUpdateBlocked()) showXabuiaUpdateBlock(cache.latestVersion || '');
      return cache.latestVersion || '';
    }

    if (versionGateState.checking) return versionGateState.checking;

    versionGateState.checking = (async () => {
      try {
        const remoteText = await getRemoteScriptText(XABUIA_UPDATE_URL);
        const latestVersion = extractMetaVersion(remoteText);

        if (!latestVersion) throw new Error('Não encontrei @version no arquivo publicado.');

        console.log(`[Xabuia] Atualização consultada no GitHub. Instalada: ${XABUIA_VERSION}. Publicada: ${latestVersion}.`);

        writeUpdateCache({ lastCheckAt: now, latestVersion });
        versionGateState.latestVersion = latestVersion;

        if (compareVersions(XABUIA_VERSION, latestVersion) < 0) {
          showXabuiaUpdateBlock(latestVersion);
          return latestVersion;
        }

        clearXabuiaUpdateBlockIfCurrent();
        return latestVersion;
      } catch (error) {
        console.warn('[Xabuia] Verificação de atualização falhou:', error);
        if (xabuiaIsUpdateBlocked()) showXabuiaUpdateBlock(versionGateState.latestVersion || cache.latestVersion || '');
        return cache.latestVersion || '';
      } finally {
        versionGateState.checking = null;
      }
    })();

    return versionGateState.checking;
  }

  const TIPO_CHAMADO = 'nf_caminhao_porta';
  const TIPO_CHAMADO_NOME = 'NF • Caminhão na porta';
  const ACTIVE_STATUS_VALUES = ['aberto', 'reaberto', 'em_tratamento'];
  const FINAL_STATUS_VALUES = ['informacoes_divergentes', 'devolver_recusar', 'finalizado'];
  const MAX_VISIBLE_ACTIVE_MONITORS = 8;

  const STATUS_LABELS = {
    aberto: 'Aberto',
    reaberto: 'Reaberto',
    em_tratamento: 'Em tratamento',
    informacoes_divergentes: 'Informações divergentes',
    devolver_recusar: 'Devolver e recusar',
    finalizado: 'Finalizado'
  };

  const state = {
    authReady: false,
    user: null,
    profile: null,
    profileLoading: null,
    ticketDocUnsubs: new Map(),
    userTicketsByChaveBusca: new Map(),
    userTicketsByChave: new Map(),
    activeCard: null,
    activeData: null,
    activeTicketLookup: null,
    isSaving: false,
    scanTimer: null
  };

  /********************************************************************
   * FIREBASE
   ********************************************************************/
  // V3.2.17: congelamos a referência ao SDK compat que foi carregado pelo Loader.
  // O InfraDesk e outras extensões podem sobrescrever window.firebase DEPOIS do
  // carregamento, gerando um provedor de outra cópia do SDK e auth/argument-error.
  // IMPORTANTÍSSIMO: Auth e GoogleAuthProvider devem vir da MESMA referência.
  const xabuiaFirebaseSDK = firebase;
  const XabuiaGoogleAuthProvider = xabuiaFirebaseSDK.auth.GoogleAuthProvider;
  const XABUIA_NAMED_APP = 'xabuia-chamadossicofe';

  function isCorrectXabuiaFirebaseApp(candidate) {
    return Boolean(candidate && candidate.options
      && candidate.options.projectId === firebaseConfig.projectId
      && candidate.options.appId === firebaseConfig.appId);
  }

  function getXabuiaFirebaseApp() {
    let defaultApp = null;
    try { defaultApp = xabuiaFirebaseSDK.app(); } catch (_) {}

    // Mantém a instância padrão do próprio Xabuia, incluindo a sessão que já
    // estava gravada nos navegadores. NÃO forçamos ninguém a refazer login.
    if (isCorrectXabuiaFirebaseApp(defaultApp)) return defaultApp;

    // Quando não existe [DEFAULT], conservamos o comportamento anterior.
    if (!defaultApp) return xabuiaFirebaseSDK.initializeApp(firebaseConfig);

    // Outra aplicação ocupa [DEFAULT]: cria uma aplicação com nome exclusivo.
    // Nunca reutiliza acidentalmente Firebase de outro projeto.
    let named = null;
    try { named = xabuiaFirebaseSDK.app(XABUIA_NAMED_APP); } catch (_) {}
    if (named) {
      if (!isCorrectXabuiaFirebaseApp(named)) {
        throw new Error('[Xabuia] Configuração divergente na instância Firebase nomeada.');
      }
      return named;
    }
    return xabuiaFirebaseSDK.initializeApp(firebaseConfig, XABUIA_NAMED_APP);
  }

  const app = getXabuiaFirebaseApp();
  const auth = xabuiaFirebaseSDK.auth(app);
  const db = xabuiaFirebaseSDK.firestore(app);
  auth.languageCode = 'pt-BR';
  console.info('[Xabuia Google] Firebase inicializado:', {
    sdkVersion: xabuiaFirebaseSDK.SDK_VERSION || 'compat',
    appName: app.name,
    projectId: app.options?.projectId,
    authAppName: auth.app?.name
  });

  auth.onAuthStateChanged((user) => {
    state.authReady = true;
    state.user = user || null;
    state.profile = user ? readCachedProfile(user.uid) : null;
    state.userTicketsByChaveBusca.clear();
    state.userTicketsByChave.clear();
    state.activeTicketLookup = null;
    stopAllTicketMonitors();

    // Modo v23: ficar logado no Google não abre listener no Firestore.
    // A página só mostra os ícones. Perfil/chamado só são lidos quando o usuário clica no Xabuia
    // ou quando existe cache local de chamado ativo já aberto por ele.
    if (!user) clearAllCardBoxes();

    if (user) {
      try { localStorage.removeItem('xabuia_google_redirect_login_pending'); } catch (_) {}
    }

    renderAuthInfo();
    scanCards();
    refreshTmNotificationsForUser();
    // Se o usuário ativou avisos ontem e não há perfil no cache, busca só o próprio perfil.
    // Sem opt-in não consulta nada; preserva o modo econômico.
    if (state.user && !state.profile && localStorage.getItem(tmNotifKey()) === '1') {
      void loadProfileIfNeeded(false);
    }
  });

  // V3.2.9: login principal por e-mail/senha sem popup. Google redirect mantido como opção secundária: o login Google do Tampermonkey passa a usar redirecionamento direto.
  // Isso evita popup fantasma, bloqueador de popup e auth/cancelled-popup-request.
  async function finishGoogleRedirectIfNeeded() {
    try {
      const pendingRaw = localStorage.getItem('xabuia_google_redirect_login_pending');
      const pending = pendingRaw ? JSON.parse(pendingRaw) : null;
      const pendingRecent = pending?.at && (Date.now() - Number(pending.at)) < (1000 * 60 * 10);

      const result = await auth.getRedirectResult();
      if (result?.user) {
        state.user = result.user;
        try { localStorage.removeItem('xabuia_google_redirect_login_pending'); } catch (_) {}
        await loadProfileIfNeeded(false);
        renderAuthInfo();
        showToast('Conta Google conectada.', 'success');
        return;
      }

      if (pendingRecent && state.user) {
        try { localStorage.removeItem('xabuia_google_redirect_login_pending'); } catch (_) {}
        renderAuthInfo();
        showToast('Conta Google conectada.', 'success');
      }
    } catch (error) {
      try { localStorage.removeItem('xabuia_google_redirect_login_pending'); } catch (_) {}
      console.warn('[Xabuia] Erro ao finalizar redirecionamento Google:', error);
      if (error?.code === 'auth/unauthorized-domain') {
        showToast('Domínio do Infradesk não autorizado no Firebase Authentication.', 'error');
      } else if (error?.message) {
        showToast(`Erro ao concluir login Google: ${error.message}`, 'error');
      }
    }
  }

  // V3.2.9: sem redirect automático; Google volta a usar popup simples igual ao 3.0.

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
        refreshTmNotificationsForUser();
        return state.profile;
      } catch (error) {
        console.warn('[Xabuia] Erro ao carregar perfil:', error);
        return null;
      } finally {
        state.profileLoading = null;
      }
    })();

    return state.profileLoading;
  }

  function isActiveXabuiaStatus(status) {
    return ACTIVE_STATUS_VALUES.includes(String(status || ''));
  }

  function shouldMonitorTicket(ticket) {
    return !!(ticket?.id && ticket?.chave && isActiveXabuiaStatus(ticket.status));
  }

  function rememberTicketInMaps(ticket) {
    if (!ticket) return;
    const chave = digitsOnly(ticket.chave || '');
    const chaveBusca = ticket.chaveBusca || (chave ? typedChaveBusca(chave) : '');
    if (chaveBusca) state.userTicketsByChaveBusca.set(chaveBusca, ticket);
    if (chave) state.userTicketsByChave.set(chave, ticket);
  }

  function startTicketMonitor(ref, seedTicket = null) {
    if (!ref || !seedTicket?.id || !shouldMonitorTicket(seedTicket)) return;
    if (state.ticketDocUnsubs.has(ref.id)) return;

    const unsub = ref.onSnapshot((snap) => {
      if (!snap.exists) {
        state.ticketDocUnsubs.get(ref.id)?.();
        state.ticketDocUnsubs.delete(ref.id);
        return;
      }

      const ticket = { id: snap.id, ...snap.data() };
      rememberTicketInMaps(ticket);
      rememberTicket(ticket);
      renderTargetCardsFromKnownTickets();

      // Quando sair dos status ativos, mostra o último status recebido e para de ouvir.
      if (!isActiveXabuiaStatus(ticket.status)) {
        const currentUnsub = state.ticketDocUnsubs.get(ref.id);
        if (currentUnsub) {
          try { currentUnsub(); } catch (_) {}
          state.ticketDocUnsubs.delete(ref.id);
        }
      }
    }, (error) => {
      console.warn('[Xabuia] Monitor do chamado falhou:', error);
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
    if (!state.user || !state.profile?.organizacaoId) {
      stopAllTicketMonitors();
      return;
    }

    const desired = new Map();
    for (const card of targetCards()) {
      if (desired.size >= MAX_VISIBLE_ACTIVE_MONITORS) break;
      const data = parseCard(card);
      const ticket = lookupKnownTicket(data.chave);
      if (!shouldMonitorTicket(ticket)) continue;
      const ref = db.collection('chamados').doc(ticket.id);
      desired.set(ref.id, { ref, ticket });
    }

    state.ticketDocUnsubs.forEach((unsub, id) => {
      if (!desired.has(id)) {
        try { unsub(); } catch (_) {}
        state.ticketDocUnsubs.delete(id);
      }
    });

    desired.forEach(({ ref, ticket }) => startTicketMonitor(ref, ticket));
  }

  /********************************************************************
   * UTILITÁRIOS
   ********************************************************************/
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function digitsOnly(value) { return String(value || '').replace(/\D+/g, ''); }
  function normalizeText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  function normalizeStatusText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
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
      .slice(0, 60) || 'item';
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
  function ticketDocId(orgId, chaveBusca) { return `${safeDocPart(orgId)}_${hashText(chaveBusca)}`; }
  function keySearchValue(value) { const digits = digitsOnly(value); return digits || normalizeText(value).toLowerCase(); }
  function typedChaveBusca(chave) { return `${TIPO_CHAMADO}:${keySearchValue(chave)}`; }
  function legacyChaveBusca(chave) { return keySearchValue(chave); }
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
  function selectedUserName() { return state.profile?.nome || state.user?.displayName || state.user?.email || 'Usuário'; }
  function canOpenFromInfradesk() {
    return Boolean(state.user && state.profile && state.profile.ativo !== false && state.profile.papel === 'usuario' && state.profile.organizacaoId);
  }

  function parseNfeKey(chave) {
    const digits = digitsOnly(chave);
    if (digits.length !== 44) return null;
    const numeroRaw = digits.slice(25, 34);
    const numero = Number.parseInt(numeroRaw, 10);
    return { chave: digits, cnpj: digits.slice(6, 20), modelo: digits.slice(20, 22), serie: digits.slice(22, 25), numero: Number.isFinite(numero) ? String(numero) : numeroRaw };
  }

  function parseCard(card) {
    const fullText = card.innerText || '';
    const directMatch = fullText.match(/\b\d{44}\b/);
    const chave = directMatch ? directMatch[0] : '';
    const parsed = parseNfeKey(chave);
    const id = card.getAttribute('data-chamado-id') || '';
    const empresa = normalizeText($('.item-data-empresa', card)?.textContent || '');
    const fornecedor = normalizeText($('.item-data-fornecedor', card)?.textContent || '');
    const subcategoria = normalizeText($('.item-subcategoria', card)?.getAttribute('title') || $('.item-subcategoria', card)?.textContent || '');
    const statusInfradesk = normalizeText(card.closest('ul[data-status-descricao]')?.getAttribute('data-status-descricao') || '');
    const ultimaDescricao = normalizeText($('.item-ultima-descricao-copy', card)?.textContent || '');
    return { id, numero: id, chave, parsed, empresa, fornecedor, subcategoria, statusInfradesk, ultimaDescricao };
  }

  function cardStatusInfo(card) {
    const ul = card?.closest?.('ul.list-status-chamados[data-status-id], ul[data-status-id]');
    const statusId = normalizeText(ul?.getAttribute('data-status-id') || '');
    const statusDesc = normalizeStatusText(ul?.getAttribute('data-status-descricao') || '');
    return { ul, statusId, statusDesc };
  }
  function isTargetCard(card) {
    const info = cardStatusInfo(card);
    return info.statusId === XABUIA_TARGET_STATUS_ID || info.statusDesc.includes(XABUIA_TARGET_STATUS_DESC);
  }
  function targetCards() { return $$('.chamado-item[data-chamado-id]').filter((card) => isTargetCard(card)); }
  function hasTargetCards() { return targetCards().length > 0; }

  function primaryRefForKey(chave) {
    if (!state.profile?.organizacaoId) return null;
    return db.collection('chamados').doc(ticketDocId(state.profile.organizacaoId, typedChaveBusca(chave)));
  }
  function legacyRefForKey(chave) {
    if (!state.profile?.organizacaoId) return null;
    return db.collection('chamados').doc(ticketDocId(state.profile.organizacaoId, legacyChaveBusca(chave)));
  }
  function lookupKnownTicket(chave) {
    const clean = digitsOnly(chave);
    return state.userTicketsByChaveBusca.get(typedChaveBusca(clean))
      || state.userTicketsByChaveBusca.get(legacyChaveBusca(clean))
      || state.userTicketsByChave.get(clean)
      || cachedTicket(clean);
  }

  function profileCacheKey(uid) { return `${XABUIA_PROFILE_CACHE_PREFIX}${uid || 'anon'}`; }
  function readCachedProfile(uid) {
    if (!uid) return null;
    try {
      const raw = localStorage.getItem(profileCacheKey(uid));
      const entry = raw ? JSON.parse(raw) : null;
      if (!entry?.profile || !entry.cachedAt) return null;
      if (Date.now() - Number(entry.cachedAt) > XABUIA_PROFILE_CACHE_TTL_MS) return null;
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

  /********************************************************************
   * CACHE LOCAL
   ********************************************************************/
  function readCache() {
    try { return JSON.parse(localStorage.getItem(XABUIA_CACHE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeCache(cache) { try { localStorage.setItem(XABUIA_CACHE_KEY, JSON.stringify(cache || {})); } catch (_) {} }
  function cacheKey(chave) { return state.profile?.organizacaoId && chave ? `${state.profile.organizacaoId}|${digitsOnly(chave)}` : ''; }
  function rememberTicket(ticket) {
    const chave = digitsOnly(ticket?.chave || '');
    const key = cacheKey(chave);
    if (!key) return;
    const cache = readCache();
    const now = Date.now();
    cache[key] = {
      cachedAt: now,
      orgId: state.profile.organizacaoId,
      chave,
      ticket: {
        ...ticket,
        atualizadoEmMs: toMillis(ticket.atualizadoEm) || now,
        ultimaOcorrenciaEmMs: toMillis(ticket.ultimaOcorrenciaEm) || toMillis(ticket.atualizadoEm) || now
      }
    };
    Object.keys(cache).forEach((itemKey) => {
      if (!cache[itemKey]?.cachedAt || now - cache[itemKey].cachedAt > XABUIA_CACHE_TTL_MS) delete cache[itemKey];
    });
    writeCache(cache);
  }
  function cachedTicket(chave) {
    const key = cacheKey(chave);
    if (!key) return null;
    const entry = readCache()[key];
    if (!entry || !entry.ticket || Date.now() - Number(entry.cachedAt || 0) > XABUIA_CACHE_TTL_MS) return null;
    return {
      ...entry.ticket,
      __fromCache: true,
      atualizadoEm: entry.ticket.atualizadoEmMs ? new Date(entry.ticket.atualizadoEmMs) : entry.ticket.atualizadoEm,
      ultimaOcorrenciaEm: entry.ticket.ultimaOcorrenciaEmMs ? new Date(entry.ticket.ultimaOcorrenciaEmMs) : entry.ticket.ultimaOcorrenciaEm
    };
  }

  function forgetTicket(chave, ticketId = '') {
    const clean = digitsOnly(chave || '');
    if (clean) {
      state.userTicketsByChave.delete(clean);
      state.userTicketsByChaveBusca.delete(typedChaveBusca(clean));
      state.userTicketsByChaveBusca.delete(legacyChaveBusca(clean));

      const key = cacheKey(clean);
      if (key) {
        const cache = readCache();
        if (cache[key]) {
          delete cache[key];
          writeCache(cache);
        }
      }

      removeCardBoxByChave(clean);
    }

    if (ticketId) {
      for (const [key, ticket] of state.userTicketsByChave.entries()) {
        if (ticket?.id === ticketId) state.userTicketsByChave.delete(key);
      }
      for (const [key, ticket] of state.userTicketsByChaveBusca.entries()) {
        if (ticket?.id === ticketId) state.userTicketsByChaveBusca.delete(key);
      }
      const unsub = state.ticketDocUnsubs.get(ticketId);
      if (unsub) {
        try { unsub(); } catch (_) {}
        state.ticketDocUnsubs.delete(ticketId);
      }
    }
  }

  async function verifyKnownTicket(chave, known) {
    if (!known?.id) return null;

    const ref = db.collection('chamados').doc(known.id);

    try {
      const snap = await ref.get();
      if (snap.exists) {
        return { ref, ticket: { id: snap.id, ...snap.data() }, exists: true };
      }

      // O cache dizia que existia, mas o documento foi apagado no Firestore.
      // Limpa o cache local para permitir abrir um chamado novo com a mesma chave.
      forgetTicket(chave, known.id);
      return null;
    } catch (error) {
      // Se a verificação do cache falhar por permissão/regras, não usamos o cache como fonte de verdade.
      // Assim o script tenta o ID determinístico oficial logo abaixo.
      if (error?.code === 'permission-denied') {
        console.warn('[Xabuia] Cache local ignorado por permissão negada ao verificar documento:', error);
        forgetTicket(chave, known.id);
        return null;
      }
      throw error;
    }
  }

  /********************************************************************
   * UI
   ********************************************************************/
  function injectStyles() {
    if ($('#xabuia-tm-style')) return;
    const style = document.createElement('style');
    style.id = 'xabuia-tm-style';
    style.textContent = `
      .xabuia-card-btn{width:24px!important;height:24px!important;padding:1px!important;border:1px solid #c7d2fe!important;background:#eef2ff!important;border-radius:5px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;vertical-align:middle!important;margin-left:2px!important}.xabuia-card-btn:hover{background:#dbeafe!important;border-color:#155eef!important}.xabuia-card-btn img{width:18px!important;height:18px!important;display:block!important;border-radius:4px!important}.xabuia-card-btn.xabuia-missing-key{opacity:.35!important;filter:grayscale(1)!important}
      .xabuia-box{clear:both;margin:9px 0 10px;padding:0;border:1px solid rgba(21,94,239,.18);background:#fff;border-radius:12px;color:#172033;font-size:12px;line-height:1.35;overflow:hidden;box-shadow:0 10px 22px rgba(15,23,42,.10)}.xabuia-box-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;font-weight:900;color:#fff;background:linear-gradient(135deg,#155eef,#7c3aed)}.xabuia-box-title{display:inline-flex;align-items:center;gap:6px;min-width:0}.xabuia-box-title img{width:18px;height:18px;border-radius:5px;flex:0 0 auto}.xabuia-chip{display:inline-flex;align-items:center;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:900;background:rgba(255,255,255,.96);color:#1d4ed8;border:1px solid rgba(255,255,255,.65);white-space:nowrap}.xabuia-box-body{padding:8px 9px 9px;background:#f8fafc;border-left:4px solid #155eef}.xabuia-last-text{margin-top:3px;padding:6px 7px;border-radius:9px;background:#fff;border:1px solid #e2e8f0;color:#334155;overflow-wrap:anywhere;white-space:pre-wrap}.xabuia-box small{color:#64748b;display:block;margin-top:5px}.xabuia-box.xabuia-status-reaberto .xabuia-box-head{background:linear-gradient(135deg,#f59e0b,#ea580c)}.xabuia-box.xabuia-status-em_tratamento .xabuia-box-head{background:linear-gradient(135deg,#b54708,#f97316)}.xabuia-box.xabuia-status-finalizado .xabuia-box-head{background:linear-gradient(135deg,#067647,#12b76a)}.xabuia-box.xabuia-status-informacoes_divergentes .xabuia-box-head,.xabuia-box.xabuia-status-devolver_recusar .xabuia-box-head{background:linear-gradient(135deg,#b42318,#ef4444)}
      .xabuia-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:999999;display:none;align-items:center;justify-content:center;padding:20px}.xabuia-overlay.open{display:flex}.xabuia-modal{width:min(520px,calc(100vw - 32px));background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.22);overflow:hidden;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.xabuia-modal-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid #e5e7eb}.xabuia-modal-head img{width:42px;height:42px;border-radius:12px}.xabuia-modal-head h3{margin:0;font-size:18px;color:#172033}.xabuia-modal-head p{margin:2px 0 0;color:#687386;font-size:12px}.xabuia-close{margin-left:auto;border:0;border-radius:10px;background:#f1f5f9;width:34px;height:34px;font-size:18px;line-height:1}.xabuia-modal-body{padding:18px;display:grid;gap:12px}.xabuia-info{border:1px solid #dbeafe;background:#eff6ff;color:#1e3a8a;padding:10px 12px;border-radius:12px;font-size:12px}.xabuia-field{display:grid;gap:6px}.xabuia-field label{font-weight:800;color:#687386;font-size:12px}.xabuia-field textarea{min-height:105px;width:100%;border:1px solid #dfe7f0;border-radius:12px;padding:10px 12px;outline:none;resize:vertical;color:#172033}.xabuia-actions{display:flex;gap:8px;justify-content:flex-end;padding:0 18px 18px}.xabuia-btn{border:0;border-radius:12px;padding:10px 14px;font-weight:800;min-height:40px}.xabuia-btn.primary{background:#155eef;color:#fff}.xabuia-btn.ghost{background:#f8fafc;border:1px solid #dfe7f0;color:#172033}.xabuia-btn:disabled{opacity:.6;cursor:not-allowed}.xabuia-authbar{padding:10px 12px;border-radius:12px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;font-size:12px}.xabuia-authbar.ok{background:#ecfdf3;color:#067647;border-color:#bbf7d0}.xabuia-login-panel{display:none;border:1px solid #dbeafe;background:#f8fafc;border-radius:12px;padding:10px 12px;gap:8px}.xabuia-login-panel.open{display:grid}.xabuia-login-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.xabuia-login-field{display:grid;gap:5px}.xabuia-login-field label{font-weight:900;color:#687386;font-size:11px}.xabuia-login-field input{width:100%;border:1px solid #dfe7f0;border-radius:10px;padding:9px 10px;outline:none;color:#172033}.xabuia-login-field input:focus{border-color:#155eef;box-shadow:0 0 0 3px rgba(21,94,239,.12)}.xabuia-login-actions{display:flex;gap:8px;flex-wrap:wrap}.xabuia-login-help{color:#64748b;font-size:11px;line-height:1.35}.xabuia-btn.small{min-height:34px;padding:8px 10px;font-size:12px}@media(max-width:560px){.xabuia-login-grid{grid-template-columns:1fr}}.xabuia-toast{position:fixed;top:18px;right:18px;z-index:1000000;background:#111827;color:#fff;padding:12px 14px;border-radius:12px;box-shadow:0 18px 45px rgba(15,23,42,.18);max-width:min(420px,calc(100vw - 36px));display:none}.xabuia-toast.open{display:block}.xabuia-toast.success{background:#067647}.xabuia-toast.error{background:#b42318}
    `;
    style.textContent += `
      .chamado-item[data-xabuia-status="aberto"]{border-left:4px solid #2563eb!important}
      .chamado-item[data-xabuia-status="reaberto"]{border-left:4px solid #d97706!important}
      .chamado-item[data-xabuia-status="em_tratamento"]{border-left:4px solid #ea580c!important}
      .chamado-item[data-xabuia-status="finalizado"]{border-left:4px solid #059669!important}
      .chamado-item[data-xabuia-status="informacoes_divergentes"],.chamado-item[data-xabuia-status="devolver_recusar"]{border-left:4px solid #dc2626!important}
      /* Campainha compacta: o posicionamento acompanha o #sigma-abrir-painel-doca quando presente. */
      .xabuia-notice-control{position:fixed;bottom:18px;right:100px;z-index:1000001;display:inline-flex;align-items:center;justify-content:center;width:36px;height:32px;min-width:36px;padding:0;border:1px solid #d0d7e2;border-radius:9px;background:#f1f5f9;color:#475569;box-shadow:0 5px 15px rgba(15,23,42,.24);font:19px/1 system-ui,sans-serif;cursor:pointer}
      .xabuia-notice-control.is-on{background:#ecfdf5;border-color:#6ee7b7;color:#065f46}
      .xabuia-notice-control.has-new::after{content:'';position:absolute;top:1px;right:1px;width:7px;height:7px;border-radius:50%;background:#ef4444;border:1px solid #fff}
      .xabuia-notice-control:focus-visible{outline:3px solid #155eef;outline-offset:3px}
      .xabuia-notice-card{outline:3px solid #f59e0b!important;outline-offset:1px;box-shadow:0 0 0 5px rgba(245,158,11,.16)!important}
      .xabuia-notice-new{border-left:5px solid #f59e0b!important}
      .xabuia-notice-pop{position:fixed;right:18px;bottom:74px;width:min(450px,calc(100vw - 36px));background:#111827;color:#fff;z-index:1000000;padding:12px 15px;border-radius:14px;box-shadow:0 14px 38px rgba(0,0,0,.22);font:13px/1.4 system-ui,sans-serif;display:flex;gap:10px;align-items:flex-start}
      .xabuia-notice-pop-icon{font-size:21px;line-height:1.2;flex:none}
      .xabuia-notice-pop-text{display:grid;gap:3px;min-width:0}
      .xabuia-notice-pop-text strong{font-size:12.5px;line-height:1.4;overflow-wrap:anywhere}
      .xabuia-notice-pop-text small{font-size:11.5px;color:#cbd5e1;line-height:1.35;overflow-wrap:anywhere}
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    if ($('#xabuia-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'xabuia-overlay';
    overlay.className = 'xabuia-overlay';
    overlay.innerHTML = `
      <div class="xabuia-modal" role="dialog" aria-modal="true" aria-labelledby="xabuia-modal-title">
        <div class="xabuia-modal-head">
          <img src="${XABUIA_ICON_URL}" alt="Xabuia"><div><h3 id="xabuia-modal-title">Abrir Xabuia</h3><p>${TIPO_CHAMADO_NOME}</p></div><button id="xabuia-close" class="xabuia-close" type="button">×</button>
        </div>
        <div class="xabuia-modal-body">
          <div id="xabuia-authbar" class="xabuia-authbar">Verificando login...</div>
          <div id="xabuia-login-panel" class="xabuia-login-panel">
            <!-- Campos montados apenas quando o usuário abre o login.
                 Evita que o gerenciador de senhas do InfraDesk preencha inputs ocultos. -->
            <div id="xabuia-login-fields"></div>
            <div class="xabuia-login-actions">
              <button id="xabuia-login-email" class="xabuia-btn primary small" type="button">Entrar</button>
              <button id="xabuia-reset-password" class="xabuia-btn ghost small" type="button">Definir/recuperar senha</button>
              <button id="xabuia-google-redirect" class="xabuia-btn ghost small" type="button">Conectar Google</button>
            </div>
            <div class="xabuia-login-help">Digite o e-mail completo e a senha cadastrados no <strong>Xabuia</strong>, não os dados do InfraDesk. O navegador pode sugerir credenciais do InfraDesk porque os dois aparecem no mesmo site. <strong>Sair</strong> encerra somente a autenticação Firebase usada pelo Xabuia.</div>
          </div>
          <div id="xabuia-info" class="xabuia-info"></div>
          <div class="xabuia-field"><label for="xabuia-comment">Ocorrência obrigatória</label><textarea id="xabuia-comment" placeholder="Ex.: Regra fiscal, ICMS divergente, GUIA ST..."></textarea></div>
          <div class="xabuia-info" style="background:#f8fafc;color:#475569;border-color:#e2e8f0;">Se a NF ainda não existir no Xabuia, será aberta como <strong>Aberto</strong>. Se já existir e estiver encerrada, será <strong>Reaberta</strong>. Se já estiver ativa, será adicionada apenas uma nova ocorrência.</div>
        </div>
        <div class="xabuia-actions"><button id="xabuia-login" class="xabuia-btn ghost" type="button">Entrar no Xabuia</button><button id="xabuia-logout" class="xabuia-btn ghost" type="button">Sair</button><button id="xabuia-cancel" class="xabuia-btn ghost" type="button">Cancelar</button><button id="xabuia-save" class="xabuia-btn primary" type="button">Salvar Xabuia</button></div>
      </div>`;
    document.body.appendChild(overlay);
    $('#xabuia-close').addEventListener('click', closeModal);
    $('#xabuia-cancel').addEventListener('click', closeModal);
    $('#xabuia-login').addEventListener('click', toggleLoginPanel);
    $('#xabuia-logout')?.addEventListener('click', logoutXabuia);
    $('#xabuia-login-email')?.addEventListener('click', loginWithEmailPassword);
    $('#xabuia-reset-password')?.addEventListener('click', sendPasswordResetFromPanel);
    $('#xabuia-google-redirect')?.addEventListener('click', loginGoogle);
    $('#xabuia-save').addEventListener('click', saveActiveTicket);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal(); });
  }

  function showToast(message, type = 'info') {
    let toast = $('#xabuia-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'xabuia-toast';
      toast.className = 'xabuia-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `xabuia-toast open ${type === 'success' ? 'success' : type === 'error' ? 'error' : ''}`;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('open'), 4500);
  }

  function renderAuthInfo() {
    const authbar = $('#xabuia-authbar');
    const loginBtn = $('#xabuia-login');
    const logoutBtn = $('#xabuia-logout');
    const saveBtn = $('#xabuia-save');
    if (!authbar || !loginBtn || !saveBtn) return;
    loginBtn.style.display = state.user ? 'none' : '';
    if (logoutBtn) logoutBtn.style.display = state.user ? '' : 'none';
    if (state.user) clearLoginFields();
    if (!state.user) { authbar.className = 'xabuia-authbar'; authbar.innerHTML = 'Entre com Google ou e-mail/senha do Xabuia.'; saveBtn.disabled = true; return; }
    if (!state.profile) { authbar.className = 'xabuia-authbar'; authbar.innerHTML = `Logado como <strong>${escapeHtml(state.user.email)}</strong>, aguardando perfil Xabuia.`; saveBtn.disabled = true; return; }
    if (state.profile.ativo === false) { authbar.className = 'xabuia-authbar'; authbar.innerHTML = 'Sua conta Xabuia está bloqueada.'; saveBtn.disabled = true; return; }
    if (state.profile.papel !== 'usuario') { authbar.className = 'xabuia-authbar'; authbar.innerHTML = `Logado como <strong>${escapeHtml(state.profile.nome || state.user.email)}</strong>, mas abertura pelo Infradesk é permitida apenas para usuários comuns.`; saveBtn.disabled = true; return; }
    authbar.className = 'xabuia-authbar ok';
    authbar.innerHTML = `Salvando como <strong>${escapeHtml(state.profile.nome || state.user.email)}</strong> em <strong>${escapeHtml(state.profile.organizacaoNome || 'sua organização')}</strong>.`;
    saveBtn.disabled = false;
  }

  /********************************************************************
   * CARD DO INFRADESK
   ********************************************************************/
  function scanCards() {
    if (xabuiaIsUpdateBlocked()) {
      showXabuiaUpdateBlock(versionGateState.latestVersion || readUpdateCache()?.latestVersion || '');
      return;
    }
    injectStyles();
    ensureModal();
    const cards = $$('.chamado-item[data-chamado-id]');
    cards.forEach((card) => {
      if (!isTargetCard(card)) { removeXabuiaUiFromCard(card); return; }
      if (card.dataset.xabuiaButtonReady !== '1') { card.dataset.xabuiaButtonReady = '1'; addXabuiaButton(card); }
      // Não consulta Firestore para card desconhecido. Só renderiza cache/local já conhecido.
      renderCardFromKnownTicket(card);
    });
    decorateTmCards();
    syncVisibleKnownMonitors();
    positionTmBell();
  }

  function addXabuiaButton(card) {
    if ($('.xabuia-card-btn', card)) return;
    const data = parseCard(card);
    const toolbar = $('.list-toolbar .toolbar-atendente', card) || $('.list-toolbar', card) || card;
    const anchor = $('.btn-anexo', toolbar);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `xabuia-card-btn ${data.chave ? '' : 'xabuia-missing-key'}`;
    btn.title = data.chave ? 'Abrir chamado Xabuia' : 'Chave NF-e não encontrada no card';
    btn.innerHTML = `<img src="${XABUIA_ICON_URL}" alt="Xabuia">`;
    btn.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openModal(card); });
    if (anchor?.parentElement) anchor.insertAdjacentElement('beforebegin', btn); else toolbar.appendChild(btn);
  }

  function removeXabuiaUiFromCard(card) {
    if (!card) return;
    $$('.xabuia-card-btn', card).forEach((btn) => btn.remove());
    $$('.xabuia-box', card).forEach((box) => box.remove());
    delete card.dataset.xabuiaButtonReady;
  }
  function clearAllCardBoxes() { $$('.xabuia-box').forEach((box) => box.remove()); $$('[data-xabuia-status]').forEach((card) => delete card.dataset.xabuiaStatus); }
  function removeCardBox(card) { $('.xabuia-box', card)?.remove(); if (card) delete card.dataset.xabuiaStatus; }
  function removeCardBoxByChave(chave) {
    if (!chave) return;
    targetCards().forEach((card) => { if (digitsOnly(parseCard(card).chave) === chave) removeCardBox(card); });
  }
  function ensureCardBox(card) {
    let box = $('.xabuia-box', card);
    if (box) return box;
    box = document.createElement('div');
    box.className = 'xabuia-box';
    const tags = $('.chamado-tags', card);
    if (tags?.parentElement) tags.insertAdjacentElement('afterend', box); else (card.children?.[0] || card).appendChild(box);
    return box;
  }

  function renderCardFromKnownTicket(card) {
    const data = parseCard(card);
    const ticket = lookupKnownTicket(data.chave);
    if (!ticket) { removeCardBox(card); return false; }
    renderCardBox(card, ticket);
    return true;
  }
  function renderTargetCardsFromKnownTickets() { targetCards().forEach(renderCardFromKnownTicket); }

  function renderCardBox(card, ticket = null) {
    if (!ticket) { removeCardBox(card); return; }
    const box = ensureCardBox(card);
    const status = ticket.status || 'aberto';
    card.dataset.xabuiaStatus = String(status);
    const label = STATUS_LABELS[status] || status;
    const histText = escapeHtml(normalizeText(ticket.ultimaOcorrenciaTexto || ticket.ultimoComentario || ticket.ultimaObservacao || 'Chamado aberto no Xabuia.'));
    const histUser = ticket.ultimaOcorrenciaUsuarioNome || ticket.ultimaOcorrenciaUsuarioEmail || '';
    const histDate = formatDate(ticket.ultimaOcorrenciaEm || ticket.atualizadoEm);
    box.className = `xabuia-box xabuia-status-${String(status).replace(/[^a-z0-9_-]/gi, '_')}`;
    box.innerHTML = `
      <div class="xabuia-box-head"><span class="xabuia-box-title"><img src="${XABUIA_ICON_URL}" alt=""> Xabuia</span><span class="xabuia-chip ${escapeHtml(status)}">${escapeHtml(label)}</span></div>
      <div class="xabuia-box-body"><div><strong>Última ocorrência</strong></div><div class="xabuia-last-text">${histText}</div><small>${escapeHtml(histDate)}${histUser ? ' • ' : ''}${escapeHtml(histUser)}</small></div>`;
  }

  /********************************************************************
   * MODAL E SALVAMENTO
   ********************************************************************/
  async function openModal(card) {
    if (xabuiaIsUpdateBlocked()) { showXabuiaUpdateBlock(versionGateState.latestVersion || readUpdateCache()?.latestVersion || ''); return; }
    if (!isTargetCard(card)) { showToast('O Xabuia está habilitado apenas na coluna Em Análise Terceiro.', 'error'); return; }
    state.activeCard = card;
    state.activeData = parseCard(card);
    state.activeTicketLookup = null;
    if (!state.activeData.chave || state.activeData.chave.length !== 44) { showToast('Não encontrei uma chave NF-e de 44 dígitos neste card.', 'error'); return; }

    // Só agora, com ação explícita do usuário, lemos perfil e no máximo o documento deste card.
    if (state.user && !state.profile) await loadProfileIfNeeded(false);

    const parsed = state.activeData.parsed;
    $('#xabuia-info').innerHTML = `
      <div><strong>Chave:</strong> ${escapeHtml(state.activeData.chave)}</div>
      ${parsed ? `<div><strong>NF:</strong> ${escapeHtml(parsed.numero)} • <strong>CNPJ:</strong> ${escapeHtml(parsed.cnpj)}</div>` : ''}
      <div><strong>Infradesk:</strong> ${escapeHtml(state.activeData.id || '—')} • ${escapeHtml(state.activeData.statusInfradesk || '—')}</div>
      <div><strong>Empresa:</strong> ${escapeHtml(state.activeData.empresa || '—')}</div>
      <div><strong>Fornecedor:</strong> ${escapeHtml(state.activeData.fornecedor || '—')}</div>`;
    $('#xabuia-comment').value = '';
    renderAuthInfo();
    $('#xabuia-overlay').classList.add('open');
    setTimeout(() => $('#xabuia-comment')?.focus(), 50);

    // Se já existe Xabuia para este card, descobre somente este documento e passa a monitorar
    // apenas se o status for ativo. Card desconhecido nunca é varrido automaticamente.
    if (canOpenFromInfradesk()) {
      try {
        const lookup = await findExistingTicketRef(state.activeData.chave);
        state.activeTicketLookup = lookup;
        if (lookup.exists && lookup.ticket) {
          rememberTicketInMaps(lookup.ticket);
          rememberTicket(lookup.ticket);
          renderCardBox(card, lookup.ticket);
          if (shouldMonitorTicket(lookup.ticket)) startTicketMonitor(lookup.ref, lookup.ticket);
        }
      } catch (error) {
        console.warn('[Xabuia] Não consegui verificar o chamado aberto:', error);
      }
    }
  }
  function clearLoginFields() {
    const panel = $('#xabuia-login-panel');
    if (panel) panel.classList.remove('open');
    // Não guarda senha no DOM após fechar. Nenhuma credencial é lida do InfraDesk.
    $('#xabuia-login-fields')?.replaceChildren();
  }

  function closeModal() {
    $('#xabuia-overlay')?.classList.remove('open');
    clearLoginFields();
    state.activeCard = null;
    state.activeData = null;
    state.activeTicketLookup = null;
    state.isSaving = false;
  }

  function mountIndependentLoginFields() {
    const slot = $('#xabuia-login-fields');
    if (!slot) return;
    // A página é infradesk.app: password managers associam a senha ao domínio
    // do InfraDesk. Criar os campos apenas sob demanda reduz esse autofill.
    slot.innerHTML = `
      <div class="xabuia-login-grid">
        <div class="xabuia-login-field">
          <label for="xabuia-email-login">E-mail Xabuia</label>
          <input id="xabuia-email-login" name="xabuia_independent_email"
                 type="email" inputmode="email" autocomplete="off"
                 autocapitalize="off" spellcheck="false" readonly
                 placeholder="nome@empresa.com.br">
        </div>
        <div class="xabuia-login-field">
          <label for="xabuia-password-login">Senha do Xabuia</label>
          <input id="xabuia-password-login" name="xabuia_independent_password"
                 type="password" autocomplete="new-password" readonly
                 placeholder="Digite a senha do Xabuia">
        </div>
      </div>`;

    const emailField = $('#xabuia-email-login');
    const passwordField = $('#xabuia-password-login');
    for (const field of [emailField, passwordField]) {
      if (!field) continue;
      field.value = '';
      field.dataset.xabuiaManual = '0';
      field.addEventListener('focus', () => {
        // Limpa eventual autofill que passou pelos hints HTML.
        field.value = '';
        field.readOnly = false;
      }, { once: true });
      field.addEventListener('beforeinput', (event) => {
        if (['insertText', 'insertCompositionText', 'insertFromPaste', 'insertFromDrop'].includes(event.inputType)) {
          field.dataset.xabuiaManual = '1';
        }
      });
      field.addEventListener('keydown', (event) => {
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          field.dataset.xabuiaManual = '1';
        }
      });
      field.addEventListener('paste', () => { field.dataset.xabuiaManual = '1'; });
      field.addEventListener('drop', () => { field.dataset.xabuiaManual = '1'; });
    }
    passwordField?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loginWithEmailPassword();
      }
    });
  }

  function toggleLoginPanel() {
    const panel = $('#xabuia-login-panel');
    if (!panel) return;
    if (panel.classList.contains('open')) {
      clearLoginFields();
      return;
    }
    mountIndependentLoginFields();
    panel.classList.add('open');
    // Campos vazios por padrão; o usuário informa as credenciais do Xabuia.
    // Evita focar automaticamente para não disparar sugestões do InfraDesk.
  }

  function readEmailLoginFields() {
    return {
      email: String($('#xabuia-email-login')?.value || '').trim(),
      password: String($('#xabuia-password-login')?.value || '')
    };
  }

  async function loginWithEmailPassword() {
    if (loginWithEmailPassword.inProgress) return loginWithEmailPassword.inProgress;

    const { email, password } = readEmailLoginFields();
    const emailField = $('#xabuia-email-login');
    const passwordField = $('#xabuia-password-login');
    if (!email || emailField?.dataset.xabuiaManual !== '1') {
      emailField?.focus();
      showToast('Digite seu e-mail do Xabuia. Não use o preenchimento automático do InfraDesk.', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      emailField?.focus();
      showToast('E-mail inválido. Informe o endereço completo, como nome@empresa.com.br.', 'error');
      return;
    }
    if (!password || passwordField?.dataset.xabuiaManual !== '1') {
      passwordField?.focus();
      showToast('Digite manualmente a senha cadastrada no Xabuia, não a senha sugerida do InfraDesk.', 'error');
      return;
    }

    const btn = $('#xabuia-login-email');
    const originalText = btn?.textContent || 'Entrar';
    loginWithEmailPassword.inProgress = (async () => {
      try {
        if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
        await auth.signInWithEmailAndPassword(email, password);
        await loadProfileIfNeeded(true);
        renderAuthInfo();
        showToast('Xabuia conectado.', 'success');
      } catch (error) {
        const code = error?.code || '';
        const map = {
          'auth/invalid-credential': 'E-mail ou senha inválidos. Se essa conta só entrava pelo Google, clique em Definir/recuperar senha.',
          'auth/wrong-password': 'Senha inválida. Use Definir/recuperar senha para criar uma nova.',
          'auth/user-not-found': 'Não encontrei esse e-mail no Xabuia.',
          'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
          'auth/network-request-failed': 'Falha de rede. Confira sua conexão.',
          'auth/operation-not-allowed': 'Login por e-mail/senha não está habilitado no Firebase Authentication.',
          'auth/invalid-email': 'Informe o e-mail completo cadastrado no Xabuia.'
        };
        showToast(map[code] || error.message || 'Erro ao entrar no Xabuia.', 'error');
      } finally {
        loginWithEmailPassword.inProgress = null;
        const currentBtn = $('#xabuia-login-email');
        if (currentBtn) { currentBtn.disabled = false; currentBtn.textContent = originalText; }
      }
    })();

    return loginWithEmailPassword.inProgress;
  }

  async function sendPasswordResetFromPanel() {
    const { email } = readEmailLoginFields();
    const emailField = $('#xabuia-email-login');
    if (!email || emailField?.dataset.xabuiaManual !== '1' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailField?.focus();
      showToast('Digite o e-mail completo cadastrado no Xabuia para recuperar a senha.', 'error');
      return;
    }

    const btn = $('#xabuia-reset-password');
    const originalText = btn?.textContent || 'Definir/recuperar senha';
    try {
      if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
      await auth.sendPasswordResetEmail(email);
      showToast('Enviei o link para definir/recuperar senha. Confira o e-mail.', 'success');
    } catch (error) {
      const code = error?.code || '';
      const map = {
        'auth/user-not-found': 'Não encontrei esse e-mail no Xabuia.',
        'auth/invalid-email': 'E-mail inválido.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
        'auth/operation-not-allowed': 'Login por e-mail/senha não está habilitado no Firebase Authentication.'
      };
      showToast(map[code] || error.message || 'Erro ao enviar link de senha.', 'error');
    } finally {
      const currentBtn = $('#xabuia-reset-password');
      if (currentBtn) { currentBtn.disabled = false; currentBtn.textContent = originalText; }
    }
  }

  function xabuiaGoogleErrorMessage(error) {
    const errors = {
      'auth/argument-error': 'O navegador misturou referências do Firebase. Confira [Xabuia Google] no Console (F12).',
      'auth/popup-blocked': 'O navegador bloqueou a janela Google. Libere pop-ups para o InfraDesk e tente novamente.',
      'auth/popup-closed-by-user': 'A janela Google foi fechada antes de concluir o login.',
      'auth/cancelled-popup-request': 'Já havia uma tentativa de login Google em andamento. Tente novamente.',
      'auth/unauthorized-domain': 'Domínio do InfraDesk não autorizado no Firebase Authentication.',
      'auth/operation-not-allowed': 'O provedor Google não está habilitado no Firebase Authentication.',
      'auth/network-request-failed': 'Falha de rede ao conectar Google. Confira a conexão.',
      'auth/web-storage-unsupported': 'O navegador bloqueou o armazenamento necessário ao login Google.',
      'auth/operation-not-supported-in-this-environment': 'Este navegador ou ambiente não permite popup de autenticação.'
    };
    return errors[error?.code] || error?.message || 'Erro ao conectar Google.';
  }

  function loginGoogle() {
    // Chamada IMEDIATA no clique (sem awaits/timers antes do popup): impede
    // bloqueio por perda da ativação de usuário no Chrome/Tampermonkey.
    if (loginGoogle.inProgress) return loginGoogle.inProgress;

    const button = $('#xabuia-google-redirect');
    try {
      const provider = new XabuiaGoogleAuthProvider();
      if (provider.providerId !== 'google.com') throw new Error('Provedor Google Firebase inválido.');
      // Sempre oferecer seleção de conta ao clicar em Conectar Google.
      provider.setCustomParameters({ prompt: 'select_account' });
      console.info('[Xabuia Google] Abrindo login:', {
        sdkVersion: xabuiaFirebaseSDK.SDK_VERSION || 'compat',
        firebaseApp: app.name,
        provider: provider.providerId,
        page: location.hostname,
        sdkGlobalChanged: window.firebase !== xabuiaFirebaseSDK
      });
      if (button) button.disabled = true;

      // NÃO alterar: deve ocorrer imediatamente após o clique.
      const popupPromise = auth.signInWithPopup(provider);
      loginGoogle.inProgress = popupPromise.then(async () => {
        await loadProfileIfNeeded(true);
        renderAuthInfo();
        showToast('Conta Google conectada.', 'success');
      }).catch((error) => {
        console.error('[Xabuia Google] Falha na autenticação:', {
          code: error?.code || 'sem-codigo',
          message: error?.message || '',
          firebaseApp: app.name,
          sdkGlobalChanged: window.firebase !== xabuiaFirebaseSDK,
          stack: error?.stack || ''
        });
        showToast(xabuiaGoogleErrorMessage(error), 'error');
      }).finally(() => {
        loginGoogle.inProgress = null;
        const current = $('#xabuia-google-redirect');
        if (current) current.disabled = false;
      });
      return loginGoogle.inProgress;
    } catch (error) {
      console.error('[Xabuia Google] Falha antes de abrir popup:', {
        code: error?.code || 'sem-codigo',
        message: error?.message || '',
        firebaseApp: app.name,
        sdkGlobalChanged: window.firebase !== xabuiaFirebaseSDK,
        stack: error?.stack || ''
      });
      if (button) button.disabled = false;
      showToast(xabuiaGoogleErrorMessage(error), 'error');
      return Promise.resolve();
    }
  }

  async function logoutXabuia() {
    const btn = $('#xabuia-logout');
    const originalText = btn?.textContent || 'Sair';
    try {
      if (btn) { btn.disabled = true; btn.textContent = 'Saindo...'; }
      stopAllTicketMonitors();
      await auth.signOut();
      state.user = null;
      state.profile = null;
      state.profileLoading = null;
      state.userTicketsByChaveBusca.clear();
      state.userTicketsByChave.clear();
      state.activeTicketLookup = null;
      clearAllCardBoxes();
      try { localStorage.removeItem('xabuia_google_redirect_login_pending'); } catch (_) {}
      renderAuthInfo();
      scanCards();
      showToast('Sessão Xabuia encerrada neste navegador.', 'success');
    } catch (error) {
      showToast(error.message || 'Erro ao sair do Xabuia.', 'error');
    } finally {
      const currentBtn = $('#xabuia-logout');
      if (currentBtn) { currentBtn.disabled = false; currentBtn.textContent = originalText; }
    }
  }

  function ticketStatusPayload(status) {
    const now = xabuiaFirebaseSDK.firestore.FieldValue.serverTimestamp();
    const payload = { status, atualizadoEm: now };
    if (status === 'em_tratamento') { payload.operadorTratamentoId = state.user.uid; payload.operadorTratamentoNome = selectedUserName(); payload.operadorTratamentoEmail = state.user.email; payload.tratamentoIniciadoEm = now; }
    if (['aberto', 'reaberto'].includes(status)) { payload.operadorTratamentoId = null; payload.operadorTratamentoNome = null; payload.operadorTratamentoEmail = null; payload.tratamentoIniciadoEm = null; }
    if (status === 'reaberto') { payload.reabertoPor = state.user.uid; payload.reabertoPorNome = selectedUserName(); payload.reabertoPorEmail = state.user.email; payload.reabertoEm = now; }
    return payload;
  }
  function lastOccurrencePayload(texto, tipo) {
    const now = xabuiaFirebaseSDK.firestore.FieldValue.serverTimestamp();
    return { ultimaOcorrenciaTexto: texto, ultimaOcorrenciaTipo: tipo, ultimaOcorrenciaUsuarioId: state.user.uid, ultimaOcorrenciaUsuarioNome: selectedUserName(), ultimaOcorrenciaUsuarioEmail: state.user.email, ultimaOcorrenciaEm: now, atualizadoEm: now };
  }
  function historyTypeForStatus(status, existsBefore, previousStatus = '') {
    if (!existsBefore && status === 'aberto') return 'criacao';
    if (status === 'reaberto' && previousStatus !== 'reaberto') return 'reabertura';
    return existsBefore ? 'observacao' : 'criacao';
  }
  function statusAfterInfradeskOccurrence(existsBefore, previousStatus) {
    if (!existsBefore) return 'aberto';
    if (['aberto', 'reaberto', 'em_tratamento'].includes(previousStatus)) return previousStatus;
    return 'reaberto';
  }

  async function findExistingTicketRef(chave) {
    const known = lookupKnownTicket(chave);
    const verifiedKnown = known?.id ? await verifyKnownTicket(chave, known) : null;
    if (verifiedKnown) return verifiedKnown;

    const primary = primaryRefForKey(chave);
    const primarySnap = primary ? await primary.get() : null;
    if (primarySnap?.exists) return { ref: primary, ticket: { id: primarySnap.id, ...primarySnap.data() }, exists: true };

    const legacy = legacyRefForKey(chave);
    if (legacy && legacy.id !== primary?.id) {
      const legacySnap = await legacy.get();
      if (legacySnap.exists) return { ref: legacy, ticket: { id: legacySnap.id, ...legacySnap.data() }, exists: true };
    }

    // Nada existe no Firestore. Qualquer status antigo vindo de cache deve ser esquecido.
    forgetTicket(chave, known?.id || '');
    return { ref: primary, ticket: null, exists: false };
  }

  async function saveActiveTicket() {
    if (xabuiaIsUpdateBlocked()) { showXabuiaUpdateBlock(versionGateState.latestVersion || readUpdateCache()?.latestVersion || ''); return; }
    if (state.isSaving) return;
    const data = state.activeData;
    const card = state.activeCard;
    const comment = normalizeText($('#xabuia-comment')?.value || '');
    if (!data?.chave || data.chave.length !== 44) return showToast('Chave NF-e inválida.', 'error');
    if (!comment) { showToast('Escreva a ocorrência para salvar a Xabuia.', 'error'); $('#xabuia-comment')?.focus(); return; }
    if (!state.user) return showToast('Conecte sua conta Xabuia primeiro.', 'error');
    if (!state.profile) await loadProfileIfNeeded(true);
    if (!canOpenFromInfradesk()) return showToast('Usuário sem permissão ou sem organização para abrir Xabuia pelo Infradesk.', 'error');

    state.isSaving = true;
    const saveBtn = $('#xabuia-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';

    try {
      const lookup = state.activeTicketLookup?.ref && digitsOnly(state.activeData?.chave || '') === digitsOnly(data.chave || '')
        ? state.activeTicketLookup
        : await findExistingTicketRef(data.chave);
      const { ref, ticket: previousTicket, exists } = lookup;
      if (!ref) throw new Error('Referência do chamado inválida.');
      const previousStatus = previousTicket?.status || '';
      const finalStatus = statusAfterInfradeskOccurrence(exists, previousStatus);
      const historyType = historyTypeForStatus(finalStatus, exists, previousStatus);
      const now = xabuiaFirebaseSDK.firestore.FieldValue.serverTimestamp();
      const requester = xabuiaFirebaseSDK.firestore.FieldValue.arrayUnion(state.user.uid);

      if (!exists) {
        await ref.set({
          tipoChamado: TIPO_CHAMADO,
          chave: data.chave,
          chaveBusca: typedChaveBusca(data.chave),
          organizacaoId: state.profile.organizacaoId,
          organizacaoNome: state.profile.organizacaoNome,
          status: 'aberto',
          criadoPor: state.user.uid,
          criadoPorNome: selectedUserName(),
          criadoPorEmail: state.user.email,
          criadoEm: now,
          atualizadoEm: now,
          solicitantesIds: [state.user.uid],
          ...lastOccurrencePayload(comment, historyType)
        });
      } else if (finalStatus === previousStatus) {
        await ref.update({ solicitantesIds: requester, ...lastOccurrencePayload(comment, historyType) });
      } else {
        await ref.update({ ...ticketStatusPayload(finalStatus), solicitantesIds: requester, ...lastOccurrencePayload(comment, historyType) });
      }

      await ref.collection('historico').add({ texto: comment, tipo: historyType, usuarioId: state.user.uid, usuarioNome: selectedUserName(), usuarioEmail: state.user.email, criadoEm: now });

      const localTicket = { id: ref.id, ...(previousTicket || {}), chave: data.chave, chaveBusca: typedChaveBusca(data.chave), status: finalStatus, organizacaoId: state.profile.organizacaoId, ultimaOcorrenciaTexto: comment, ultimaOcorrenciaTipo: historyType, ultimaOcorrenciaUsuarioNome: selectedUserName(), ultimaOcorrenciaUsuarioEmail: state.user.email, ultimaOcorrenciaEm: new Date(), atualizadoEm: new Date() };
      rememberTicketInMaps(localTicket);
      rememberTicket(localTicket);
      if (card) renderCardBox(card, localTicket);
      if (shouldMonitorTicket(localTicket)) startTicketMonitor(ref, localTicket);
      else syncVisibleKnownMonitors();

      showToast(!exists ? 'Xabuia aberta com ocorrência.' : finalStatus === previousStatus ? 'Ocorrência adicionada sem alterar o status.' : 'Xabuia reaberta com ocorrência.', 'success');
      closeModal();
    } catch (error) {
      console.error('[Xabuia] Erro ao salvar:', error);
      showToast(error?.code === 'permission-denied' ? 'Permissão negada pelo Firestore. Publique as regras v21.' : (error.message || 'Erro ao salvar chamado.'), 'error');
    } finally {
      state.isSaving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar Xabuia';
    }
  }


  /********************************************************************
   * AVISOS XABUIA NO INFRADESK (opt-in; sem mexer nas notificações nativas)
   ********************************************************************/
  const noticeTM = {
    unsubs: [], initialized: false, enabled: false, audio: null,
    audioReady: false, audioError: '', audioAttempt: null, soundOwnerUid: '', lastSoundWarning: 0,
    count: 0, alertKeys: new Set(), seen: new Map(), lastAlertsByKey: new Map(),
    statusByKey: new Map(), statusBuckets: new Map()
  };
  function tmNotifKey() { return `xabuia_tamper_avisos_v1_${state.user?.uid || 'anon'}`; }
  function tmEventAt(ticket) {
    const date = ticket?.ultimaOcorrenciaEm || ticket?.atualizadoEm;
    if (!date) return 0;
    if (typeof date.toMillis === 'function') return date.toMillis();
    if (typeof date.toDate === 'function') return date.toDate().getTime();
    return new Date(date).getTime() || 0;
  }
  function tmAlertId(ticket) {
    return `${ticket.id}|${tmEventAt(ticket)}|${ticket.ultimaOcorrenciaUsuarioId || ''}|${ticket.status || ''}|${ticket.ultimaOcorrenciaTexto || ''}`;
  }
  function stopTmNotices() {
    noticeTM.unsubs.forEach((fn) => { try { fn(); } catch (_) {} });
    noticeTM.unsubs = []; noticeTM.initialized = false;
  }
  function tmAudioErrorMessage(error) {
    const name = String(error?.name || '');
    const mediaErrorCode = noticeTM.audio?.error?.code || 0;
    if (name === 'NotAllowedError') return 'O Chrome bloqueou a reprodução automática nesta página. Clique na campainha 🔕 para ativar o som do Xabuia.';
    if (name === 'NotSupportedError' || mediaErrorCode === 4) return 'O blin.mp3 não pôde ser carregado ou foi bloqueado pelo InfraDesk (verifique Console → CSP/media-src).';
    if (mediaErrorCode === 2) return 'Erro de rede ao buscar blin.mp3 no GitHub Pages.';
    if (mediaErrorCode === 3) return 'O navegador não conseguiu decodificar blin.mp3.';
    return String(error?.message || 'O navegador não conseguiu reproduzir o blin.mp3.');
  }
  function positionTmBell() {
    const bell = document.getElementById('xabuia-notification-toggle');
    if (!bell) return;
    const panel = document.getElementById('sigma-abrir-painel-doca');
    if (panel && panel.getClientRects().length) {
      const rect = panel.getBoundingClientRect();
      // Mede o canto esquerdo real do Painel: funciona com botões largos ou compactos.
      const rightPx = Math.max(8, Math.round(window.innerWidth - rect.left + 8));
      bell.style.right = `${rightPx}px`;
      // Centraliza verticalmente com o Painel Doca, sem alterar o painel de outro script.
      const middleY = rect.top + rect.height / 2;
      bell.style.bottom = `${Math.max(8, Math.round(window.innerHeight - middleY - 16))}px`;
    } else {
      // Se o script Painel Doca não estiver instalado, usa o canto inferior direito.
      bell.style.right = '18px';
      bell.style.bottom = '18px';
    }
  }
  function ensureTmNoticeControl() {
    // Limpeza do antigo botão separado, caso o DOM seja reaproveitado.
    document.getElementById('xabuia-notification-sound-test')?.remove();
    let button = document.getElementById('xabuia-notification-toggle');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'xabuia-notification-toggle';
      button.className = 'xabuia-notice-control';
      button.addEventListener('click', toggleTmNotices);
      document.body.appendChild(button);
    }
    const visible = !!(state.user && state.profile?.ativo !== false);
    button.style.display = visible ? 'inline-flex' : 'none';
    button.classList.toggle('is-on', noticeTM.enabled);
    button.classList.toggle('has-new', noticeTM.count > 0);
    button.textContent = noticeTM.enabled ? '🔔' : '🔕';
    const label = noticeTM.enabled ? 'Desativar avisos do Xabuia' : 'Ativar avisos do Xabuia';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(noticeTM.enabled));
    button.title = noticeTM.audioError
      ? `${label} — ${noticeTM.audioError}`
      : `${label}${noticeTM.count > 0 ? ` • ${noticeTM.count} novo(s)` : ''}`;
    positionTmBell();
  }
  function tmSoundElement() {
    if (!noticeTM.audio) {
      const audio = new Audio(XABUIA_BLIN_URL);
      audio.preload = 'auto';
      audio.volume = 0.8;
      audio.loop = false;
      // Um erro de mídia costuma ser causado por URL inacessível ou CSP do site hospedeiro.
      audio.addEventListener('error', () => {
        const code = audio.error?.code || 0;
        console.warn(`[Xabuia Som] Erro carregando blin.mp3 (MediaError ${code}) no InfraDesk. Cheque Content-Security-Policy/media-src: ${XABUIA_BLIN_URL}`);
      });
      noticeTM.audio = audio;
    }
    return noticeTM.audio;
  }
  function tmSoundFailed(error, source = 'aviso') {
    noticeTM.audioReady = false;
    noticeTM.audioError = tmAudioErrorMessage(error);
    console.warn(`[Xabuia Som] ${source}: ${noticeTM.audioError}`, error, { src: XABUIA_BLIN_URL, mediaError: noticeTM.audio?.error?.code || 0 });
    ensureTmNoticeControl();
    if (source === 'aviso' && Date.now() - noticeTM.lastSoundWarning > 60000) {
      noticeTM.lastSoundWarning = Date.now();
      showToast(`Aviso Xabuia recebido, mas sem som. ${noticeTM.audioError}`, 'error');
    }
  }
  function tmSoundSucceeded() {
    noticeTM.audioReady = true;
    noticeTM.audioError = '';
    ensureTmNoticeControl();
  }
  async function unlockTmSound() {
    // É obrigatório iniciar audio.play() DURANTE o clique do usuário.
    const audio = tmSoundElement();
    if (noticeTM.audioAttempt) return noticeTM.audioAttempt;
    try {
      audio.pause();
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) audio.currentTime = 0;
      const playResult = audio.play();
      noticeTM.audioAttempt = Promise.resolve(playResult).then(() => {
        tmSoundSucceeded();
        return true;
      }).catch((error) => {
        tmSoundFailed(error, 'teste');
        return false;
      }).finally(() => { noticeTM.audioAttempt = null; });
      return noticeTM.audioAttempt;
    } catch (error) {
      tmSoundFailed(error, 'teste');
      return false;
    }
  }
  function playTmNotice() {
    if (!noticeTM.enabled) return;
    const audio = tmSoundElement();
    if (noticeTM.audioAttempt) return;
    try {
      audio.pause();
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) audio.currentTime = 0;
      noticeTM.audioAttempt = Promise.resolve(audio.play()).then(() => {
        tmSoundSucceeded();
      }).catch((error) => {
        tmSoundFailed(error, 'aviso');
      }).finally(() => { noticeTM.audioAttempt = null; });
    } catch (error) { tmSoundFailed(error, 'aviso'); }
  }
  function rebuildTmStatusMap() {
    noticeTM.statusByKey.clear();
    // Agrega todos os snapshots correntes por usuário sem buscar NF extra.
    noticeTM.statusBuckets.forEach((tickets) => {
      tickets.forEach((ticket) => {
        const key = digitsOnly(ticket.chave || '');
        if (key.length === 44) noticeTM.statusByKey.set(key, ticket.status || 'aberto');
      });
    });
    decorateTmCards();
  }
  function decorateTmCards() {
    // Card do InfraDesk pode ser recriado no modo lista ou painel. A chave NF-e liga
    // a ocorrência Xabuia ao card, sem modificar o status nativo do InfraDesk.
    $$('.chamado-item[data-chamado-id]').forEach((card) => {
      const key = digitsOnly(parseCard(card).chave);
      const alert = key && noticeTM.lastAlertsByKey.get(key);
      const knownStatus = key && noticeTM.statusByKey.get(key);
      card.classList.toggle('xabuia-notice-card', !!alert);
      if (alert) card.dataset.xabuiaStatus = alert.status;
      else if (knownStatus) card.dataset.xabuiaStatus = knownStatus;
      else if (!$('.xabuia-box',card)) delete card.dataset.xabuiaStatus;
    });
  }
  function tmNoticeLabel(ticket) {
    const tipo = String(ticket.tipoChamado || '');
    const digits = digitsOnly(ticket.chave || '');
    if (digits.length === 44 && (tipo.startsWith('nf_') || !tipo)) {
      return `NF ${parseNfeKey(digits)?.numero || digits.slice(-8)}`;
    }
    const produto = normalizeText(ticket.codigoProduto || '');
    if (produto) return `Produto ${produto.slice(0, 34)}`;
    if (digits.length === 44) return `NF ${parseNfeKey(digits)?.numero || digits.slice(-8)}`;
    const chave = normalizeText(ticket.chave || '');
    return chave ? `Chamado ${chave.slice(0, 24)}` : `Chamado ${String(ticket.id || '').slice(0, 10)}`;
  }
  function tmNoticeDescription(ticket) {
    const reference = tmNoticeLabel(ticket);
    const status = STATUS_LABELS[ticket.status] || normalizeText(ticket.status || 'Atualizado');
    const author = normalizeText(ticket.ultimaOcorrenciaUsuarioNome || ticket.ultimaOcorrenciaUsuarioEmail || '');
    const title = `Xabuia • ${reference} • ${status}${author ? ` por ${author}` : ''}`;
    const detail = normalizeText(ticket.ultimaOcorrenciaTexto || '').slice(0, 160);
    return { title, detail };
  }
  function displayTmNotice(ticket) {
    const id = tmAlertId(ticket);
    if (noticeTM.alertKeys.has(id)) return;
    noticeTM.alertKeys.add(id);
    if (noticeTM.alertKeys.size > 250) noticeTM.alertKeys.clear();
    noticeTM.count += 1;
    const chave = digitsOnly(ticket.chave || '');
    if (chave) noticeTM.lastAlertsByKey.set(chave, { status: ticket.status || 'aberto', id });
    ensureTmNoticeControl();
    playTmNotice();
    const { title, detail } = tmNoticeDescription(ticket);
    let pop = document.getElementById('xabuia-notice-pop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'xabuia-notice-pop';
      pop.className = 'xabuia-notice-pop';
      document.body.appendChild(pop);
    }
    // Usamos textContent: evita inserir HTML de ocorrências digitadas por usuários.
    const icon = document.createElement('span');
    icon.className = 'xabuia-notice-pop-icon';
    icon.textContent = '🔔';
    const content = document.createElement('span');
    content.className = 'xabuia-notice-pop-text';
    const titleNode = document.createElement('strong');
    titleNode.textContent = title;
    content.appendChild(titleNode);
    if (detail) {
      const detailNode = document.createElement('small');
      detailNode.textContent = detail;
      content.appendChild(detailNode);
    }
    pop.replaceChildren(icon, content);
    window.clearTimeout(displayTmNotice.timer);
    displayTmNotice.timer = window.setTimeout(() => pop.remove(), 8000);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(`🔔 ${title}`, { body: detail || 'Há uma nova atualização neste chamado.', icon: XABUIA_ICON_URL, tag: `xabuia-${id}` }); } catch (_) {}
    }
    decorateTmCards();
  }
  function startTmNotices() {
    stopTmNotices();
    if (!noticeTM.enabled || !state.user || !state.profile || state.profile.ativo === false) return;
    const subStart = Date.now();
    const queries = [];
    if (state.profile.papel === 'operador') {
      queries.push(db.collection('chamados').where('status','in',['aberto','reaberto']).limit(100));
      queries.push(db.collection('chamados').where('operadorTratamentoId','==',state.user.uid).limit(100));
    } else if (state.profile.papel === 'usuario' && state.profile.organizacaoId) {
      queries.push(db.collection('chamados').where('organizacaoId','==',state.profile.organizacaoId).where('solicitantesIds','array-contains',state.user.uid).where('status','in',['aberto','reaberto','em_tratamento','informacoes_divergentes','devolver_recusar','finalizado']).limit(100));
    }
    for (const q of queries) {
      let first = true;
      const unsub = q.onSnapshot((snap) => {
        if (!first && !snap.metadata.fromCache && !snap.metadata.hasPendingWrites) {
          snap.docChanges().forEach((change) => {
            if (change.type === 'removed') return;
            const ticket = { id: change.doc.id, ...change.doc.data() };
            if (!ticket.ultimaOcorrenciaUsuarioId || ticket.ultimaOcorrenciaUsuarioId === state.user?.uid) return;
            if (tmEventAt(ticket) < subStart - 1500) return;
            displayTmNotice(ticket);
          });
        }
        first = false;
      }, (error) => {
        console.warn('[Xabuia] Avisos não puderam iniciar; confira os índices/regras:', error);
        showToast('Xabuia: não foi possível monitorar os retornos. Confira índices/permissões do Firestore no Console.', 'error');
      });
      noticeTM.unsubs.push(unsub);
    }
  }
  async function toggleTmNotices() {
    noticeTM.enabled = !noticeTM.enabled;
    if (state.user) localStorage.setItem(tmNotifKey(), noticeTM.enabled ? '1' : '0');
    if (noticeTM.enabled) {
      const soundTest = unlockTmSound(); // toca uma única vez ao ativar
      if ('Notification' in window && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch (_) {}
      }
      if (!(await soundTest)) showToast(noticeTM.audioError || 'Avisos visuais ativados, porém o navegador bloqueou blin.mp3.', 'error');
      startTmNotices();
    } else {
      stopTmNotices();
      noticeTM.audioReady = false;
      noticeTM.audioError = '';
      try { noticeTM.audio?.pause(); } catch (_) {}
    }
    noticeTM.count = 0;
    noticeTM.lastAlertsByKey.clear();
    document.querySelectorAll('.xabuia-notice-card').forEach((el) => el.classList.remove('xabuia-notice-card'));
    ensureTmNoticeControl();
  }
  function refreshTmNotificationsForUser() {
    const activeUid = state.user?.uid || '';
    if (noticeTM.soundOwnerUid !== activeUid) {
      noticeTM.audioReady = false;
      noticeTM.audioError = '';
      noticeTM.soundOwnerUid = activeUid;
    }
    stopTmNotices(); noticeTM.count = 0; noticeTM.alertKeys.clear(); noticeTM.lastAlertsByKey.clear(); noticeTM.statusBuckets.clear(); noticeTM.statusByKey.clear();
    noticeTM.enabled = !!state.user && localStorage.getItem(tmNotifKey()) === '1';
    ensureTmNoticeControl();
    if (noticeTM.enabled) startTmNotices();
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
    ensureTmNoticeControl();
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', positionTmBell, { passive: true });
    window.addEventListener('focus', scanCards);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scanCards(); });
    console.log(`[Xabuia] Tampermonkey v${XABUIA_VERSION} carregado. Login Google isolado; campainha compacta 🔔/🔕, blin.mp3 e avisos por NF.`);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
