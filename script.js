import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  updateProfile,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  addDoc,
  serverTimestamp,
  query,
  where,
  limit,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBpWLYK1cejNpUAo5NMk8ecSSQrYMVf6-0',
  authDomain: 'comercial-divergencias.firebaseapp.com',
  projectId: 'comercial-divergencias',
  storageBucket: 'comercial-divergencias.firebasestorage.app',
  messagingSenderId: '602637992147',
  appId: '1:602637992147:web:fc930856cc72f598a31426'
};

const APP_VERSION = 'Comercial Site v1.1.5 econômico por período';
const BOOTSTRAP_ADMIN_EMAIL = 'crfenxuto01@gmail.com';

const STATUS_LABELS = {
  aberto: 'Aberto',
  reaberto: 'Reaberto',
  em_tratamento: 'Em tratamento',
  informacoes_divergentes: 'Informação divergente',
  pedido_corrigido: 'Pedido corrigido',
  pronto: 'Pronto',
  devolver_recusar: 'Devolver e recusar',

  // Compatibilidade com versões antigas.
  resolvido: 'Resolvido',
  cancelado: 'Cancelado'
};

const STATUS_ORDER = {
  reaberto: 0,
  aberto: 1,
  em_tratamento: 2,
  informacoes_divergentes: 3,
  pedido_corrigido: 4,
  pronto: 5,
  devolver_recusar: 6,
  resolvido: 7,
  cancelado: 8
};

const ACTIVE_STATUSES = ['aberto', 'reaberto', 'em_tratamento'];
const FINAL_STATUSES = ['informacoes_divergentes', 'pedido_corrigido', 'pronto', 'devolver_recusar', 'resolvido', 'cancelado'];

const STATUS_OPTIONS_BY_FILA = {
  compras: ['aberto', 'reaberto', 'em_tratamento', 'informacoes_divergentes', 'pedido_corrigido', 'devolver_recusar'],
  cadastro: ['aberto', 'reaberto', 'em_tratamento', 'informacoes_divergentes', 'pronto', 'devolver_recusar']
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'pt-BR';
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const $ = (id) => document.getElementById(id);

const els = {
  toast: $('toast'),
  authView: $('authView'),
  blockedView: $('blockedView'),
  appView: $('appView'),
  tabLogin: $('tabLogin'),
  tabRegister: $('tabRegister'),
  authForm: $('authForm'),
  nameField: $('nameField'),
  displayNameInput: $('displayNameInput'),
  emailInput: $('emailInput'),
  passwordInput: $('passwordInput'),
  authSubmitBtn: $('authSubmitBtn'),
  googleBtn: $('googleBtn'),
  resetPasswordBtn: $('resetPasswordBtn'),
  connectionHelp: $('connectionHelp'),
  logoutBlockedBtn: $('logoutBlockedBtn'),
  userLine: $('userLine'),
  dashboardBtn: $('dashboardBtn'),
  reportsBtn: $('reportsBtn'),
  adminBtn: $('adminBtn'),
  logoutBtn: $('logoutBtn'),
  dashboardView: $('dashboardView'),
  reportsView: $('reportsView'),
  adminView: $('adminView'),
  searchInput: $('searchInput'),
  filaFilter: $('filaFilter'),
  statusFilter: $('statusFilter'),
  compradorFilter: $('compradorFilter'),
  dateStart: $('dateStart'),
  dateEnd: $('dateEnd'),
  refreshBtn: $('refreshBtn'),
  liveStatus: $('liveStatus'),
  tableBody: $('ticketTableBody'),
  countAberto: $('countAberto'),
  countReaberto: $('countReaberto'),
  countTratamento: $('countTratamento'),
  countInfoDivergente: $('countInfoDivergente'),
  countPedidoCorrigido: $('countPedidoCorrigido'),
  countPronto: $('countPronto'),
  countDevolverRecusar: $('countDevolverRecusar'),
  countTotal: $('countTotal'),
  ticketDialog: $('ticketDialog'),
  detailTitle: $('detailTitle'),
  detailSub: $('detailSub'),
  detailFacts: $('detailFacts'),
  historyList: $('historyList'),
  detailStatus: $('detailStatus'),
  responseText: $('responseText'),
  reserveFromModalBtn: $('reserveFromModalBtn'),
  saveResponseBtn: $('saveResponseBtn'),
  reportStart: $('reportStart'),
  reportEnd: $('reportEnd'),
  reportFila: $('reportFila'),
  generateReportsBtn: $('generateReportsBtn'),
  reportsOutput: $('reportsOutput'),
  adminTipoFila: $('adminTipoFila'),
  adminTipoNome: $('adminTipoNome'),
  addTipoBtn: $('addTipoBtn'),
  tiposList: $('tiposList'),
  buyerNameInput: $('buyerNameInput'),
  addBuyerBtn: $('addBuyerBtn'),
  buyersList: $('buyersList'),
  usersList: $('usersList')
};

const state = {
  mode: 'login',
  user: null,
  profile: null,
  tickets: [],
  compradores: [],
  divergencias: DEFAULT_DIVERGENCIAS,
  users: [],
  unsubTickets: [],
  selectedTicket: null,
  history: []
};

function showToast(message, type = 'info') {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.className = `toast ${type === 'success' ? 'success' : type === 'error' ? 'error' : ''}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add('hidden'), 4200);
}

function showOnly(view) {
  [els.authView, els.blockedView, els.appView].forEach((el) => el?.classList.add('hidden'));
  view?.classList.remove('hidden');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalize(value) {
  return String(value || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeAscii(value) {
  return normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function safeId(value) {
  return normalizeAscii(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70) || `id_${Date.now()}`;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateInputMillis(value, endOfDay = false) {
  if (!value) return 0;
  const suffix = endOfDay ? 'T23:59:59' : 'T00:00:00';
  const ms = new Date(`${value}${suffix}`).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 10);
}

function ensureDefaultPeriodFilters() {
  const today = todayInputValue();

  if (els.dateStart && !els.dateStart.value) els.dateStart.value = today;
  if (els.dateEnd && !els.dateEnd.value) els.dateEnd.value = today;

  if (els.reportStart && !els.reportStart.value) els.reportStart.value = today;
  if (els.reportEnd && !els.reportEnd.value) els.reportEnd.value = today;

  if (els.statusFilter && !els.statusFilter.value) els.statusFilter.value = 'periodo_mais_ativos';
}

function currentPeriodRange() {
  const today = todayInputValue();
  const startValue = els.dateStart?.value || today;
  const endValue = els.dateEnd?.value || startValue || today;

  return {
    startValue,
    endValue,
    startDate: new Date(`${startValue}T00:00:00`),
    endDate: new Date(`${endValue}T23:59:59`),
    startMs: dateInputMillis(startValue, false),
    endMs: dateInputMillis(endValue, true)
  };
}

function formatDate(value) {
  const ms = timestampMillis(value);
  if (!ms) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
}

function minutesBetween(startMs, endMs = Date.now()) {
  if (!startMs) return null;
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

function formatMinutes(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}min`;
  if (hours > 0) return `${hours}h ${mins}min`;
  return `${mins}min`;
}

function canonicalStatus(status, fila = '') {
  if (status === 'resolvido') return fila === 'cadastro' ? 'pronto' : 'pedido_corrigido';
  if (status === 'cancelado') return 'devolver_recusar';
  return status || 'aberto';
}

function statusBadge(status, fila = '') {
  const safe = canonicalStatus(status, fila);
  return `<span class="status ${escapeHtml(safe)}">${escapeHtml(STATUS_LABELS[safe] || safe)}</span>`;
}

function roleLabel(role) {
  return ({ admin: 'Admin', usuario: 'Usuário CRF', crf: 'Usuário CRF', compras: 'Compras', cadastro: 'Cadastro' })[role] || role || 'Usuário';
}

function filaLabel(fila) {
  return state.divergencias?.[fila]?.nome || ({ compras: 'Compras', cadastro: 'Cadastro' })[fila] || fila || '—';
}

function selectedUserName() {
  return state.profile?.nome || state.user?.displayName || state.user?.email || 'Usuário';
}

function isBootstrapAdmin(user = state.user) {
  return user?.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
}

function isAdmin() {
  return state.profile?.papel === 'admin' || isBootstrapAdmin();
}

function canTreatFila(fila) {
  if (isAdmin()) return true;
  return Array.isArray(state.profile?.filasTratamento) && state.profile.filasTratamento.includes(fila);
}

function canReserve(ticket) {
  const status = canonicalStatus(ticket?.status, ticket?.fila);
  return ticket && ['aberto', 'reaberto'].includes(status) && canTreatFila(ticket.fila);
}

function canRespond(ticket) {
  if (!ticket) return false;
  return isAdmin() || canTreatFila(ticket.fila) || ticket.abertoPor === state.user?.uid;
}

function canChangeStatus(ticket) {
  return ticket && (isAdmin() || canTreatFila(ticket.fila));
}

function isTicketReservedByMe(ticket) {
  if (!ticket || !state.user?.uid) return false;
  const uid = state.user.uid;
  return ticket.responsavelId === uid
    || ticket.operadorTratamentoId === uid
    || ticket.reservadoPor === uid
    || ticket.reservadoPorId === uid;
}

function shouldShowTicketForCurrentUser(ticket, selectedStatus = '') {
  if (!ticket || !state.user) return false;
  if (isAdmin()) return true;

  const status = canonicalStatus(ticket.status, ticket.fila);

  // Usuário CRF/solicitante comum só enxerga o que ele abriu.
  if (!canTreatFila(ticket.fila)) return ticket.abertoPor === state.user.uid;

  // Compras/Cadastro veem todos os abertos/reabertos da fila.
  // Mas chamado em tratamento fica privado para quem reservou,
  // exceto quando o filtro escolhido for exatamente "Em tratamento".
  if (status === 'em_tratamento' && selectedStatus !== 'em_tratamento') {
    return isTicketReservedByMe(ticket);
  }

  return true;
}

function finalStatusFor(status) {
  return FINAL_STATUSES.includes(status);
}

function statusOptionsForTicket(ticket) {
  const fila = ticket?.fila || 'compras';
  const base = STATUS_OPTIONS_BY_FILA[fila] || STATUS_OPTIONS_BY_FILA.compras;
  const current = canonicalStatus(ticket?.status, fila);
  return base.includes(current) ? base : [current, ...base];
}

function statusOptionHtml(status, selected = '') {
  return `<option value="${escapeHtml(status)}" ${status === selected ? 'selected' : ''}>${escapeHtml(STATUS_LABELS[status] || status)}</option>`;
}

function renderDetailStatusOptions(ticket) {
  if (!els.detailStatus) return;
  const current = canonicalStatus(ticket?.status, ticket?.fila);

  // CRF/solicitante comum pode comentar, mas não deve encerrar/reservar por engano.
  if (!canChangeStatus(ticket)) {
    els.detailStatus.innerHTML = statusOptionHtml(current, current);
    els.detailStatus.disabled = true;
    return;
  }

  els.detailStatus.disabled = false;
  els.detailStatus.innerHTML = statusOptionsForTicket(ticket).map((status) => statusOptionHtml(status, current)).join('');
  els.detailStatus.value = current;
}

function ticketStartedAtMillis(ticket) {
  const status = canonicalStatus(ticket?.status, ticket?.fila);
  if (status === 'em_tratamento') return timestampMillis(ticket.tratamentoIniciadoEm) || timestampMillis(ticket.atualizadoEm) || timestampMillis(ticket.criadoEm);
  if (status === 'reaberto') return timestampMillis(ticket.reabertoEm) || timestampMillis(ticket.atualizadoEm) || timestampMillis(ticket.criadoEm);
  return timestampMillis(ticket.criadoEm) || timestampMillis(ticket.atualizadoEm);
}

function ticketTimeLabel(ticket) {
  const status = canonicalStatus(ticket?.status, ticket?.fila);
  const start = timestampMillis(ticket.criadoEm) || timestampMillis(ticket.atualizadoEm);
  if (finalStatusFor(status)) {
    const end = timestampMillis(ticket.fechadoEm)
      || timestampMillis(ticket.resolvidoEm)
      || timestampMillis(ticket.canceladoEm)
      || timestampMillis(ticket.atualizadoEm);
    return `Total ${formatMinutes(ticket.tempoTotalMin ?? minutesBetween(start, end))}`;
  }
  const statusStart = ticketStartedAtMillis(ticket);
  return `${STATUS_LABELS[status] || 'Aberto'} há ${formatMinutes(minutesBetween(statusStart))}`;
}

function ticketSearchText(ticket) {
  return normalizeAscii([
    ticket.chamadoInfradeskId,
    ticket.chave,
    ticket.numeroNf,
    ticket.cnpj,
    ticket.fornecedorNome,
    ticket.fornecedorTexto,
    ticket.tipoDivergenciaNome,
    ticket.compradorNome,
    ticket.empresa,
    ticket.abertoPorNome,
    STATUS_LABELS[canonicalStatus(ticket.status, ticket.fila)]
  ].join(' '));
}

async function ensureProfileForUser(user, displayName = '') {
  const ref = doc(db, 'usuarios', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { id: snap.id, ...snap.data() };

  const email = user.email || '';
  const adminBootstrap = email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
  const profile = adminBootstrap ? {
    ativo: true,
    nome: displayName || user.displayName || 'Admin',
    email,
    papel: 'admin',
    podeAbrir: true,
    filasTratamento: ['compras', 'cadastro'],
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  } : {
    ativo: true,
    nome: displayName || user.displayName || email.split('@')[0] || 'Usuário',
    email,
    papel: 'usuario',
    podeAbrir: true,
    filasTratamento: [],
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  };

  await setDoc(ref, profile);
  return { id: user.uid, ...profile };
}

async function loadProfile() {
  if (!state.user) return null;
  try {
    const profile = await ensureProfileForUser(state.user);
    state.profile = profile;
    return profile;
  } catch (error) {
    console.error(error);
    els.connectionHelp.innerHTML = 'Não consegui carregar/criar o perfil. Confira as regras do Firestore.';
    els.connectionHelp.classList.remove('hidden');
    return null;
  }
}

async function loginOrRegister(event) {
  event.preventDefault();
  const email = normalize(els.emailInput.value);
  const password = els.passwordInput.value;
  const name = normalize(els.displayNameInput.value);
  if (!email || !password) return showToast('Informe e-mail e senha.', 'error');

  try {
    els.authSubmitBtn.disabled = true;
    els.authSubmitBtn.textContent = state.mode === 'register' ? 'Criando...' : 'Entrando...';

    let credential;
    if (state.mode === 'register') {
      credential = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(credential.user, { displayName: name });
      await ensureProfileForUser(credential.user, name);
      showToast('Conta criada no Comercial.', 'success');
    } else {
      credential = await signInWithEmailAndPassword(auth, email, password);
      await ensureProfileForUser(credential.user);
      showToast('Comercial conectado.', 'success');
    }
  } catch (error) {
    console.error(error);
    const map = {
      'auth/email-already-in-use': 'Esse e-mail já existe. Clique em Entrar em vez de Criar conta.',
      'auth/invalid-credential': 'E-mail ou senha inválidos.',
      'auth/wrong-password': 'Senha inválida.',
      'auth/user-not-found': 'Não encontrei esse e-mail no Comercial.',
      'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco.'
    };
    showToast(map[error?.code] || error.message || 'Erro no login.', 'error');
  } finally {
    els.authSubmitBtn.disabled = false;
    els.authSubmitBtn.textContent = state.mode === 'register' ? 'Criar conta' : 'Entrar';
  }
}

async function loginGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    await ensureProfileForUser(result.user);
    showToast('Conta Google conectada.', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Erro ao conectar Google.', 'error');
  }
}

async function resetPassword() {
  const email = normalize(els.emailInput.value);
  if (!email) return showToast('Informe o e-mail para recuperar a senha.', 'error');
  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Link de senha enviado. Confira o e-mail.', 'success');
  } catch (error) {
    showToast(error.message || 'Erro ao enviar recuperação.', 'error');
  }
}

function setAuthMode(mode) {
  state.mode = mode;
  els.tabLogin.classList.toggle('active', mode === 'login');
  els.tabRegister.classList.toggle('active', mode === 'register');
  els.nameField.classList.toggle('hidden', mode !== 'register');
  els.authSubmitBtn.textContent = mode === 'register' ? 'Criar conta' : 'Entrar';
}

function stopTicketStreams() {
  state.unsubTickets.forEach((unsub) => { try { unsub(); } catch (_) {} });
  state.unsubTickets = [];
}

function ticketInitialOrderMillis(ticket) {
  return timestampMillis(ticket?.criadoEm)
    || timestampMillis(ticket?.aberturaEm)
    || timestampMillis(ticket?.primeiraOcorrenciaEm)
    || timestampMillis(ticket?.atualizadoEm)
    || 0;
}

function sortTickets(tickets) {
  return [...tickets].sort((a, b) => {
    // Ordem fixa de fila: mais antigo primeiro.
    // Não usamos status, atualizadoEm ou última ocorrência para não "pular" a linha
    // quando alguém reservar/responder o chamado.
    const left = ticketInitialOrderMillis(a) || Number.MAX_SAFE_INTEGER;
    const right = ticketInitialOrderMillis(b) || Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;

    const chamadoDiff = String(a.chamadoInfradeskId || '').localeCompare(String(b.chamadoInfradeskId || ''), 'pt-BR', { numeric: true });
    if (chamadoDiff !== 0) return chamadoDiff;

    return String(a.id || '').localeCompare(String(b.id || ''), 'pt-BR');
  });
}

function rebuildTicketsFromSnapshots(snapshotMaps) {
  const map = new Map();
  snapshotMaps.forEach((snapMap) => {
    snapMap.forEach((ticket, id) => map.set(id, { ...ticket, status: canonicalStatus(ticket.status, ticket.fila) }));
  });
  state.tickets = sortTickets([...map.values()]);
  renderAll();
}

function baseTicketScopes() {
  const comercialOnly = where('tipoChamado', '==', 'nf_divergencia_comercial');
  const selectedFila = els.filaFilter?.value || 'todos';

  if (isAdmin()) {
    const base = [comercialOnly];
    if (selectedFila !== 'todos') base.push(where('fila', '==', selectedFila));
    return [base];
  }

  if (Array.isArray(state.profile?.filasTratamento) && state.profile.filasTratamento.length) {
    const filas = selectedFila !== 'todos'
      ? state.profile.filasTratamento.filter((fila) => fila === selectedFila)
      : state.profile.filasTratamento;

    return filas.map((fila) => [comercialOnly, where('fila', '==', fila)]);
  }

  return [[comercialOnly, where('abertoPor', '==', state.user.uid)]];
}

function ticketQueryFromConstraints(constraints, max = 350) {
  return query(collection(db, 'comercial_chamados'), ...constraints, limit(max));
}

function pushUniqueQuery(list, constraints, max = 350) {
  const key = constraints.map((item) => String(item?._field?.canonicalString?.() || item?._queryPath || item)).join('|') + `|${max}`;
  list.push({ constraints, max, key });
}

function buildTicketQueriesForCurrentFilters() {
  ensureDefaultPeriodFilters();

  const queries = [];
  const status = els.statusFilter?.value || 'periodo_mais_ativos';
  const period = currentPeriodRange();
  const scopes = baseTicketScopes();

  scopes.forEach((scope) => {
    const scopedStatus = (statusValue) => [...scope, where('status', '==', statusValue)];

    if (status === 'periodo_mais_ativos') {
      // Padrão pedido:
      // - chamados criados no período selecionado, por padrão hoje;
      // - + chamados ativos de outras datas.
      pushUniqueQuery(queries, [...scope, where('criadoEm', '>=', period.startDate), where('criadoEm', '<=', period.endDate)], 350);
      pushUniqueQuery(queries, scopedStatus('aberto'), 350);
      pushUniqueQuery(queries, scopedStatus('reaberto'), 350);

      // Em tratamento:
      // - Admin vê todos ativos.
      // - Compras/Cadastro veem só as próprias reservas no padrão.
      // - Se quiser todos em tratamento da fila, escolha Status = Em tratamento.
      if (isAdmin()) {
        pushUniqueQuery(queries, scopedStatus('em_tratamento'), 350);
      } else if (Array.isArray(state.profile?.filasTratamento) && state.profile.filasTratamento.length) {
        pushUniqueQuery(queries, [...scopedStatus('em_tratamento'), where('operadorTratamentoId', '==', state.user.uid)], 250);
      } else {
        pushUniqueQuery(queries, scopedStatus('em_tratamento'), 250);
      }

      return;
    }

    if (status === 'ativos') {
      pushUniqueQuery(queries, scopedStatus('aberto'), 350);
      pushUniqueQuery(queries, scopedStatus('reaberto'), 350);

      if (isAdmin() || !Array.isArray(state.profile?.filasTratamento) || !state.profile.filasTratamento.length) {
        pushUniqueQuery(queries, scopedStatus('em_tratamento'), 350);
      } else {
        pushUniqueQuery(queries, [...scopedStatus('em_tratamento'), where('operadorTratamentoId', '==', state.user.uid)], 250);
      }

      return;
    }

    if (status === 'todos') {
      // "Todos" precisa respeitar período para não carregar histórico inteiro.
      pushUniqueQuery(queries, [...scope, where('criadoEm', '>=', period.startDate), where('criadoEm', '<=', period.endDate)], 500);
      return;
    }

    if (status === 'em_tratamento') {
      // Quando escolher Em tratamento explicitamente, mostra todos da fila/perfil.
      pushUniqueQuery(queries, scopedStatus('em_tratamento'), 500);
      return;
    }

    if (ACTIVE_STATUSES.includes(status)) {
      pushUniqueQuery(queries, scopedStatus(status), 500);
      return;
    }

    // Status final: sempre limitado ao período selecionado.
    pushUniqueQuery(queries, [...scopedStatus(status), where('criadoEm', '>=', period.startDate), where('criadoEm', '<=', period.endDate)], 500);
  });

  return queries;
}

async function startTicketStreams() {
  // Mantém o nome da função para não mexer no restante da tela,
  // mas agora é carregamento econômico sob demanda, sem listener geral.
  await loadTicketsOnce();
}

async function loadTicketsOnce() {
  stopTicketStreams();

  if (!state.user || !state.profile) return;

  try {
    ensureDefaultPeriodFilters();

    if (els.liveStatus) {
      const period = currentPeriodRange();
      els.liveStatus.textContent = `Carregando período ${period.startValue} até ${period.endValue} • ${APP_VERSION}`;
    }

    const queryDefs = buildTicketQueriesForCurrentFilters();
    const map = new Map();
    let readBatches = 0;

    for (const item of queryDefs) {
      const snap = await getDocs(ticketQueryFromConstraints(item.constraints, item.max));
      readBatches += 1;
      snap.forEach((docSnap) => map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
    }

    state.tickets = sortTickets([...map.values()].map((ticket) => ({
      ...ticket,
      status: canonicalStatus(ticket.status, ticket.fila)
    })));

    renderAll();

    const visibleCount = filteredTickets().length;
    if (els.liveStatus) {
      els.liveStatus.textContent = `${visibleCount} visível(eis) de ${state.tickets.length} lido(s) • ${readBatches} consulta(s) • ${APP_VERSION}`;
    }
  } catch (error) {
    console.error(error);
    const needsIndex = error?.code === 'failed-precondition';
    const permission = error?.code === 'permission-denied';

    if (els.liveStatus) {
      els.liveStatus.textContent = needsIndex
        ? 'Consulta precisa de índice no Firestore. Veja o console para o link do índice.'
        : permission
          ? 'Permissão negada ao carregar chamados. Confira rules/perfil.'
          : 'Erro ao carregar chamados. Confira regras/permissões.';
    }

    showToast(
      needsIndex
        ? 'O Firestore pediu um índice para esta consulta. Abra o console do navegador e clique no link do índice.'
        : permission
          ? 'Permissão negada ao carregar chamados.'
          : 'Erro ao carregar chamados do Comercial.',
      'error'
    );
  }
}

async function loadCompradores() {
  try {
    const snap = await getDocs(collection(db, 'compradores'));
    state.compradores = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => item.ativo !== false)
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    renderCompradorFilter();
    renderBuyersAdmin();
  } catch (error) {
    console.warn('Compradores não carregaram:', error);
    state.compradores = [];
  }
}

async function loadDivergencias() {
  try {
    const snap = await getDoc(doc(db, 'config', 'divergencias'));
    if (snap.exists() && snap.data()?.filas) state.divergencias = normalizeConfig(snap.data().filas);
    else state.divergencias = DEFAULT_DIVERGENCIAS;
    renderTiposAdmin();
  } catch (error) {
    console.warn('Tipos não carregaram:', error);
    state.divergencias = DEFAULT_DIVERGENCIAS;
  }
}

function normalizeConfig(source) {
  const out = JSON.parse(JSON.stringify(DEFAULT_DIVERGENCIAS));
  ['compras', 'cadastro'].forEach((fila) => {
    if (source?.[fila]?.nome) out[fila].nome = source[fila].nome;
    if (Array.isArray(source?.[fila]?.tipos)) {
      out[fila].tipos = source[fila].tipos
        .filter((item) => item?.id && item?.nome)
        .map((item) => ({ id: String(item.id), nome: String(item.nome) }));
    }
  });
  return out;
}

function renderCompradorFilter() {
  if (!els.compradorFilter) return;
  const current = els.compradorFilter.value || 'todos';
  els.compradorFilter.innerHTML = '<option value="todos">Todos</option>';
  state.compradores.forEach((buyer) => {
    const opt = document.createElement('option');
    opt.value = buyer.id;
    opt.textContent = buyer.nome;
    els.compradorFilter.appendChild(opt);
  });
  els.compradorFilter.value = [...els.compradorFilter.options].some((o) => o.value === current) ? current : 'todos';
}

async function loadUsersAdmin() {
  if (!isAdmin()) return;
  try {
    const snap = await getDocs(collection(db, 'usuarios'));
    state.users = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nome || a.email || '').localeCompare(String(b.nome || b.email || ''), 'pt-BR'));
    renderUsersAdmin();
  } catch (error) {
    console.warn('Usuários não carregaram:', error);
  }
}

function filteredTickets(base = state.tickets) {
  const search = normalizeAscii(els.searchInput.value);
  const fila = els.filaFilter.value;
  const status = els.statusFilter.value || 'periodo_mais_ativos';
  const compradorId = els.compradorFilter.value;
  const period = currentPeriodRange();

  return sortTickets(base.filter((ticket) => {
    const ticketStatus = canonicalStatus(ticket.status, ticket.fila);
    const created = ticketInitialOrderMillis(ticket);
    const inPeriod = (!period.startMs || created >= period.startMs) && (!period.endMs || created <= period.endMs);
    const isActive = ACTIVE_STATUSES.includes(ticketStatus);

    if (!shouldShowTicketForCurrentUser(ticket, status)) return false;
    if (search && !ticketSearchText(ticket).includes(search)) return false;
    if (fila !== 'todos' && ticket.fila !== fila) return false;

    if (status === 'periodo_mais_ativos') {
      if (!inPeriod && !isActive) return false;
    } else if (status === 'ativos') {
      if (!isActive) return false;
    } else if (status !== 'todos' && ticketStatus !== status) {
      return false;
    } else if (status === 'todos') {
      if (!inPeriod) return false;
    }

    if (FINAL_STATUSES.includes(status) && !inPeriod) return false;
    if (compradorId !== 'todos' && ticket.compradorId !== compradorId) return false;

    return true;
  }));
}

function renderAll() {
  renderMetrics();
  renderTable();
  if (isAdmin()) renderReports();
}

function setMetric(el, value) {
  if (el) el.textContent = String(value);
}

function renderMetrics() {
  const tickets = filteredTickets();
  const count = (status) => tickets.filter((ticket) => canonicalStatus(ticket.status, ticket.fila) === status).length;

  setMetric(els.countAberto, count('aberto'));
  setMetric(els.countReaberto, count('reaberto'));
  setMetric(els.countTratamento, count('em_tratamento'));
  setMetric(els.countInfoDivergente, count('informacoes_divergentes'));
  setMetric(els.countPedidoCorrigido, count('pedido_corrigido'));
  setMetric(els.countPronto, count('pronto'));
  setMetric(els.countDevolverRecusar, count('devolver_recusar'));
  setMetric(els.countTotal, tickets.length);
}

function renderTable() {
  const tickets = filteredTickets();

  if (!tickets.length) {
    els.tableBody.innerHTML = '<tr><td class="empty-row" colspan="9">Nenhuma divergência encontrada.</td></tr>';
    return;
  }

  els.tableBody.innerHTML = tickets.map((ticket) => {
    const reserve = ticket.responsavelNome || ticket.operadorTratamentoNome || ticket.reservadoPorNome || '—';
    const canReserveNow = canReserve(ticket);
    const status = canonicalStatus(ticket.status, ticket.fila);

    return `
      <tr data-ticket-id="${escapeHtml(ticket.id)}">
        <td>${statusBadge(status, ticket.fila)}</td>
        <td>${escapeHtml(reserve)}${canReserveNow ? '<span class="kicker">Disponível</span>' : ''}</td>
        <td>
          <div class="strong-line">NF ${escapeHtml(ticket.numeroNf || '—')}</div>
          <span class="kicker">CNPJ ${escapeHtml(ticket.cnpj || '—')}</span>
          <span class="kicker">Chamado ${escapeHtml(ticket.chamadoInfradeskId || '—')}</span>
        </td>
        <td>
          <div class="strong-line">${escapeHtml(ticket.fornecedorNome || ticket.fornecedorTexto || '—')}</div>
          <span class="kicker">${escapeHtml(ticket.tipoNota || ticket.categoriaFornecedor || '—')}</span>
        </td>
        <td>
          <div class="strong-line">${escapeHtml(filaLabel(ticket.fila))}</div>
          <span class="kicker">${escapeHtml(ticket.tipoDivergenciaNome || ticket.tipoDivergencia || '—')}</span>
        </td>
        <td>${escapeHtml(ticket.compradorNome || '—')}</td>
        <td>${escapeHtml(ticket.abertoPorNome || ticket.abertoPorEmail || '—')}<span class="kicker">${formatDate(ticket.criadoEm)}</span></td>
        <td>${ticketTimeLabel(ticket)}</td>
        <td>
          <div class="actions-cell">
            ${canReserveNow ? `<button class="btn primary small" type="button" data-action="reserve" data-id="${escapeHtml(ticket.id)}">Reservar</button>` : ''}
            <button class="btn ghost small" type="button" data-action="open" data-id="${escapeHtml(ticket.id)}">Abrir</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function historyTextForStatus(status, customText = '') {
  if (customText) return customText;
  return `Status alterado para ${STATUS_LABELS[status] || status}.`;
}

async function addHistory(ref, payload) {
  await addDoc(collection(ref, 'historico'), {
    ...payload,
    criadoEm: serverTimestamp()
  });
}

async function reserveTicket(ticket) {
  if (!ticket) return;
  if (!canReserve(ticket)) return showToast('Esse chamado não pode ser reservado por este perfil.', 'error');

  try {
    const now = serverTimestamp();
    const ref = doc(db, 'comercial_chamados', ticket.id);
    const statusAnterior = canonicalStatus(ticket.status, ticket.fila);
    const texto = `Reservado por ${selectedUserName()}`;

    await updateDoc(ref, {
      status: 'em_tratamento',
      responsavelId: state.user.uid,
      responsavelNome: selectedUserName(),
      responsavelEmail: state.user.email,
      operadorTratamentoId: state.user.uid,
      operadorTratamentoNome: selectedUserName(),
      operadorTratamentoEmail: state.user.email,
      tratamentoIniciadoEm: now,
      atualizadoEm: now,
      ultimaOcorrenciaTexto: texto,
      ultimaOcorrenciaTipo: 'reserva',
      ultimaOcorrenciaUsuarioId: state.user.uid,
      ultimaOcorrenciaUsuarioNome: selectedUserName(),
      ultimaOcorrenciaUsuarioEmail: state.user.email,
      ultimaOcorrenciaEm: now
    });

    await addHistory(ref, {
      texto,
      tipo: 'reserva',
      status: 'em_tratamento',
      statusAnterior,
      statusNovo: 'em_tratamento',
      usuarioId: state.user.uid,
      usuarioNome: selectedUserName(),
      usuarioEmail: state.user.email
    });

    showToast('Chamado reservado.', 'success');
    await loadTicketsOnce();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Erro ao reservar chamado.', 'error');
  }
}

async function openTicket(ticketId) {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket) return;

  state.selectedTicket = ticket;
  const status = canonicalStatus(ticket.status, ticket.fila);

  els.detailTitle.textContent = `${filaLabel(ticket.fila)} • ${ticket.tipoDivergenciaNome || 'Divergência'}`;
  els.detailSub.textContent = `NF ${ticket.numeroNf || '—'} • Chamado ${ticket.chamadoInfradeskId || '—'} • ${STATUS_LABELS[status] || status}`;
  renderDetailStatusOptions(ticket);
  els.responseText.value = '';
  els.reserveFromModalBtn.disabled = !canReserve(ticket);

  els.detailFacts.innerHTML = [
    ['NF', ticket.numeroNf || '—'],
    ['CNPJ', ticket.cnpj || '—'],
    ['Fornecedor', ticket.fornecedorNome || ticket.fornecedorTexto || '—'],
    ['Comprador', ticket.compradorNome || '—'],
    ['Tipo real da nota', ticket.tipoNota || ticket.categoriaFornecedor || '—'],
    ['Empresa', ticket.empresa || '—'],
    ['Chave', ticket.chave || '—'],
    ['Última ocorrência', ticket.ultimaOcorrenciaTexto || '—']
  ].map(([label, value]) => `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');

  await loadHistory(ticket.id);
  showDialog(els.ticketDialog);
}

async function loadHistory(ticketId) {
  els.historyList.innerHTML = '<div class="muted">Carregando histórico...</div>';

  try {
    const snap = await getDocs(query(collection(doc(db, 'comercial_chamados', ticketId), 'historico'), limit(300)));

    state.history = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => timestampMillis(a.criadoEm) - timestampMillis(b.criadoEm));

    if (!state.history.length) {
      els.historyList.innerHTML = '<div class="muted">Sem histórico registrado.</div>';
      return;
    }

    els.historyList.innerHTML = state.history.map((hist) => {
      const status = canonicalStatus(hist.status || hist.statusNovo || '', state.selectedTicket?.fila || '');
      const statusMeta = status ? ` • ${STATUS_LABELS[status] || status}` : '';
      return `
        <article class="history-item">
          <div class="history-item-head">
            <strong>${escapeHtml(hist.usuarioNome || hist.usuarioEmail || 'Usuário')}</strong>
            <span class="history-type">${escapeHtml(hist.tipo || 'observacao')}</span>
          </div>
          <small class="muted">${formatDate(hist.criadoEm)}${escapeHtml(statusMeta)}</small>
          <p>${escapeHtml(hist.texto || '')}</p>
        </article>
      `;
    }).join('');
  } catch (error) {
    console.error(error);
    els.historyList.innerHTML = '<div class="muted">Não consegui carregar o histórico.</div>';
  }
}

function buildStatusPatch(ticket, status, text, now) {
  const currentStatus = canonicalStatus(ticket.status, ticket.fila);
  const start = timestampMillis(ticket.criadoEm) || Date.now();
  const treatmentStart = timestampMillis(ticket.tratamentoIniciadoEm) || start;

  const patch = {
    status,
    atualizadoEm: now,
    ultimaOcorrenciaTexto: text,
    ultimaOcorrenciaTipo: 'resposta',
    ultimaOcorrenciaUsuarioId: state.user.uid,
    ultimaOcorrenciaUsuarioNome: selectedUserName(),
    ultimaOcorrenciaUsuarioEmail: state.user.email,
    ultimaOcorrenciaEm: now
  };

  if (status === 'em_tratamento') {
    Object.assign(patch, {
      responsavelId: ticket.responsavelId || state.user.uid,
      responsavelNome: ticket.responsavelNome || selectedUserName(),
      responsavelEmail: ticket.responsavelEmail || state.user.email,
      operadorTratamentoId: ticket.operadorTratamentoId || state.user.uid,
      operadorTratamentoNome: ticket.operadorTratamentoNome || selectedUserName(),
      operadorTratamentoEmail: ticket.operadorTratamentoEmail || state.user.email,
      tratamentoIniciadoEm: ticket.tratamentoIniciadoEm || now
    });
  }

  if (status === 'aberto' || status === 'reaberto') {
    Object.assign(patch, {
      responsavelId: null,
      responsavelNome: null,
      responsavelEmail: null,
      operadorTratamentoId: null,
      operadorTratamentoNome: null,
      operadorTratamentoEmail: null,
      tratamentoIniciadoEm: null
    });
  }

  if (status === 'reaberto' && currentStatus !== 'reaberto') {
    Object.assign(patch, {
      reabertoPor: state.user.uid,
      reabertoPorNome: selectedUserName(),
      reabertoPorEmail: state.user.email,
      reabertoEm: now
    });
  }

  if (finalStatusFor(status)) {
    Object.assign(patch, {
      fechadoPor: state.user.uid,
      fechadoPorNome: selectedUserName(),
      fechadoPorEmail: state.user.email,
      fechadoEm: now,
      tempoAtendimentoMin: minutesBetween(treatmentStart),
      tempoTotalMin: minutesBetween(start)
    });

    if (status === 'pedido_corrigido' || status === 'pronto') {
      patch.resolvidoEm = now;
    }

    if (status === 'devolver_recusar') {
      patch.canceladoEm = now;
    }
  }

  return patch;
}

async function saveResponse() {
  const ticket = state.selectedTicket;
  if (!ticket) return;
  if (!canRespond(ticket)) return showToast('Seu perfil não pode responder este chamado.', 'error');

  const currentStatus = canonicalStatus(ticket.status, ticket.fila);
  const requestedStatus = els.detailStatus.value || currentStatus;
  const status = canChangeStatus(ticket) ? requestedStatus : currentStatus;
  const text = normalize(els.responseText.value) || historyTextForStatus(status);

  try {
    els.saveResponseBtn.disabled = true;
    const now = serverTimestamp();
    const ref = doc(db, 'comercial_chamados', ticket.id);
    const patch = buildStatusPatch(ticket, status, text, now);

    await updateDoc(ref, patch);

    await addHistory(ref, {
      texto: text,
      tipo: status !== currentStatus ? 'status' : 'resposta',
      status,
      statusAnterior: currentStatus,
      statusNovo: status,
      usuarioId: state.user.uid,
      usuarioNome: selectedUserName(),
      usuarioEmail: state.user.email
    });

    showToast('Resposta salva.', 'success');
    els.ticketDialog.close();
    await loadTicketsOnce();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Erro ao salvar resposta.', 'error');
  } finally {
    els.saveResponseBtn.disabled = false;
  }
}

function showDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.classList.remove('hidden');
}

function switchView(viewName) {
  els.dashboardView.classList.toggle('hidden', viewName !== 'dashboard');
  els.reportsView.classList.toggle('hidden', viewName !== 'reports');
  els.adminView.classList.toggle('hidden', viewName !== 'admin');
  els.dashboardBtn.classList.toggle('active', viewName === 'dashboard');
  els.reportsBtn.classList.toggle('active', viewName === 'reports');
  els.adminBtn.classList.toggle('active', viewName === 'admin');

  if (viewName === 'reports') {
    ensureDefaultPeriodFilters();
    renderReports();
  }
  if (viewName === 'admin') {
    ensureDefaultPeriodFilters();
    renderTiposAdmin();
    renderBuyersAdmin();
    loadUsersAdmin();
  }
}

function groupCount(tickets, keyFn) {
  const map = new Map();
  tickets.forEach((ticket) => {
    const key = keyFn(ticket) || '—';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function reportTickets() {
  let tickets = [...state.tickets];
  const start = dateInputMillis(els.reportStart.value, false);
  const end = dateInputMillis(els.reportEnd.value, true);
  const fila = els.reportFila.value;

  tickets = tickets.filter((ticket) => {
    const created = timestampMillis(ticket.criadoEm) || timestampMillis(ticket.atualizadoEm);
    if (start && created < start) return false;
    if (end && created > end) return false;
    if (fila !== 'todos' && ticket.fila !== fila) return false;
    return true;
  });

  return tickets;
}

function chartCard(title, rows, empty = 'Sem dados.') {
  const max = Math.max(...rows.map(([, value]) => value), 1);
  return `
    <article class="card report-card">
      <h3>${escapeHtml(title)}</h3>
      ${rows.length ? `<div class="chart-bars">${rows.slice(0, 10).map(([label, value]) => `
        <div class="bar-row">
          <span class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <div class="bar-track"><i class="bar-fill" style="width:${Math.max(6, Math.round((value / max) * 100))}%"></i></div>
          <strong>${value}</strong>
        </div>
      `).join('')}</div>` : `<p class="muted">${escapeHtml(empty)}</p>`}
    </article>`;
}

function avg(values) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function ticketCloseEndMs(ticket) {
  return timestampMillis(ticket.fechadoEm)
    || timestampMillis(ticket.resolvidoEm)
    || timestampMillis(ticket.canceladoEm)
    || timestampMillis(ticket.atualizadoEm)
    || Date.now();
}

function renderReports() {
  if (!isAdmin()) return;

  const tickets = reportTickets();
  const compras = tickets.filter((t) => t.fila === 'compras');
  const cadastro = tickets.filter((t) => t.fila === 'cadastro');

  const byBuyer = groupCount(compras, (t) => t.compradorNome || 'Sem comprador');
  const byBuyerType = groupCount(compras, (t) => `${t.compradorNome || 'Sem comprador'} • ${t.tipoDivergenciaNome || t.tipoDivergencia || 'Tipo'}`);
  const byCadastro = groupCount(cadastro, (t) => t.tipoDivergenciaNome || t.tipoDivergencia || 'Cadastro');
  const byFornecedor = groupCount(tickets, (t) => t.fornecedorNome || t.fornecedorTexto || 'Fornecedor');
  const byStatus = groupCount(tickets, (t) => STATUS_LABELS[canonicalStatus(t.status, t.fila)] || t.status || 'Aberto');

  const avgRows = state.compradores.map((buyer) => {
    const mine = compras.filter((t) => t.compradorId === buyer.id || t.compradorNome === buyer.nome);
    const minutes = mine.map((t) => t.tempoAtendimentoMin ?? minutesBetween(
      timestampMillis(t.tratamentoIniciadoEm) || timestampMillis(t.criadoEm),
      ticketCloseEndMs(t)
    ));
    return { nome: buyer.nome, total: mine.length, media: avg(minutes) };
  }).filter((row) => row.total > 0).sort((a, b) => (b.total - a.total));

  els.reportsOutput.innerHTML = `
    ${chartCard('Divergências de Compras por comprador', byBuyer)}
    ${chartCard('Comprador x tipo de divergência', byBuyerType)}
    ${chartCard('Divergências de Cadastro por tipo', byCadastro)}
    ${chartCard('Fornecedores com mais divergências', byFornecedor)}
    ${chartCard('Status dos chamados', byStatus)}
    <article class="card report-card wide">
      <h3>Tempo médio de atendimento por comprador</h3>
      <div class="table-wrap">
        <table class="report-table">
          <thead><tr><th>Comprador</th><th>Total</th><th>Tempo médio</th></tr></thead>
          <tbody>${avgRows.length ? avgRows.map((row) => `<tr><td>${escapeHtml(row.nome)}</td><td>${row.total}</td><td>${formatMinutes(row.media)}</td></tr>`).join('') : '<tr><td colspan="3">Sem dados de compras no período.</td></tr>'}</tbody>
        </table>
      </div>
    </article>
  `;
}

async function saveDivergenciasConfig() {
  await setDoc(doc(db, 'config', 'divergencias'), {
    filas: state.divergencias,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.user.uid
  }, { merge: true });
}

function renderTiposAdmin() {
  if (!els.tiposList) return;
  const fila = els.adminTipoFila.value || 'compras';
  const tipos = state.divergencias?.[fila]?.tipos || [];

  els.tiposList.innerHTML = tipos.map((tipo) => `
    <div class="mini-item">
      <strong>${escapeHtml(tipo.nome)}</strong>
      <button class="btn danger small" type="button" data-delete-tipo="${escapeHtml(tipo.id)}">Excluir</button>
    </div>
  `).join('') || '<p class="muted">Nenhum tipo cadastrado.</p>';
}

async function addTipo() {
  if (!isAdmin()) return;
  const fila = els.adminTipoFila.value;
  const nome = normalize(els.adminTipoNome.value);
  if (!nome) return showToast('Digite o tipo da divergência.', 'error');

  const id = safeId(nome);
  const tipos = state.divergencias[fila].tipos;
  if (tipos.some((t) => t.id === id || normalizeAscii(t.nome) === normalizeAscii(nome))) {
    return showToast('Esse tipo já existe nesta fila.', 'error');
  }

  tipos.push({ id, nome });
  await saveDivergenciasConfig();
  els.adminTipoNome.value = '';
  renderTiposAdmin();
  showToast('Tipo criado.', 'success');
}

async function deleteTipo(tipoId) {
  if (!isAdmin()) return;
  const fila = els.adminTipoFila.value;
  const tipos = state.divergencias[fila].tipos;
  if (tipos.length <= 1) return showToast('A fila precisa ter pelo menos um tipo.', 'error');

  const tipo = tipos.find((t) => t.id === tipoId);
  if (!tipo || !confirm(`Excluir "${tipo.nome}"?`)) return;

  state.divergencias[fila].tipos = tipos.filter((t) => t.id !== tipoId);
  await saveDivergenciasConfig();
  renderTiposAdmin();
  showToast('Tipo excluído.', 'success');
}

function renderBuyersAdmin() {
  if (!els.buyersList) return;

  els.buyersList.innerHTML = state.compradores.map((buyer) => `
    <div class="mini-item">
      <strong>${escapeHtml(buyer.nome)}</strong>
      <button class="btn danger small" type="button" data-delete-buyer="${escapeHtml(buyer.id)}">Excluir</button>
    </div>
  `).join('') || '<p class="muted">Nenhum comprador cadastrado.</p>';
}

async function addBuyer() {
  if (!isAdmin()) return;
  const nome = normalize(els.buyerNameInput.value);
  if (!nome) return showToast('Digite o nome do comprador.', 'error');

  if (state.compradores.some((b) => normalizeAscii(b.nome) === normalizeAscii(nome))) {
    return showToast('Já existe comprador com esse nome.', 'error');
  }

  const id = `${safeId(nome)}_${Date.now().toString(36)}`;
  await setDoc(doc(db, 'compradores', id), {
    nome,
    nomeBusca: normalizeAscii(nome),
    ativo: true,
    criadoEm: serverTimestamp(),
    criadoPor: state.user.uid,
    criadoPorEmail: state.user.email,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.user.uid,
    atualizadoPorEmail: state.user.email
  });

  els.buyerNameInput.value = '';
  await loadCompradores();
  showToast('Comprador criado.', 'success');
}

async function deleteBuyer(id) {
  if (!isAdmin()) return;

  const buyer = state.compradores.find((b) => b.id === id);
  if (!buyer || !confirm(`Excluir comprador "${buyer.nome}"?`)) return;

  await updateDoc(doc(db, 'compradores', id), {
    ativo: false,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.user.uid,
    atualizadoPorEmail: state.user.email
  });

  await loadCompradores();
  showToast('Comprador excluído.', 'success');
}

function filasForUser(user) {
  if (Array.isArray(user.filasTratamento)) return user.filasTratamento;
  return [];
}

function renderUsersAdmin() {
  if (!els.usersList) return;
  if (!isAdmin()) {
    els.usersList.innerHTML = '';
    return;
  }

  els.usersList.innerHTML = state.users.map((user) => {
    const filas = filasForUser(user);
    return `
      <div class="user-item" data-user-id="${escapeHtml(user.id)}">
        <div class="user-main"><strong>${escapeHtml(user.nome || user.email || 'Usuário')}</strong><small>${escapeHtml(user.email || '')}</small></div>
        <select data-user-field="papel">
          ${['usuario', 'compras', 'cadastro', 'admin'].map((role) => `<option value="${role}" ${user.papel === role ? 'selected' : ''}>${roleLabel(role)}</option>`).join('')}
        </select>
        <label class="check-row"><input type="checkbox" data-user-field="ativo" ${user.ativo !== false ? 'checked' : ''}> Ativo</label>
        <label class="check-row"><input type="checkbox" data-user-field="compras" ${filas.includes('compras') ? 'checked' : ''}> Compras</label>
        <label class="check-row"><input type="checkbox" data-user-field="cadastro" ${filas.includes('cadastro') ? 'checked' : ''}> Cadastro</label>
      </div>
    `;
  }).join('') || '<p class="muted">Nenhum usuário encontrado.</p>';
}

async function updateUserFromRow(row) {
  if (!isAdmin() || !row) return;

  const userId = row.dataset.userId;
  const papel = row.querySelector('[data-user-field="papel"]')?.value || 'usuario';
  const ativo = row.querySelector('[data-user-field="ativo"]')?.checked ?? true;
  const filasTratamento = [];

  if (row.querySelector('[data-user-field="compras"]')?.checked) filasTratamento.push('compras');
  if (row.querySelector('[data-user-field="cadastro"]')?.checked) filasTratamento.push('cadastro');

  if (papel === 'compras' && !filasTratamento.includes('compras')) filasTratamento.push('compras');
  if (papel === 'cadastro' && !filasTratamento.includes('cadastro')) filasTratamento.push('cadastro');

  await updateDoc(doc(db, 'usuarios', userId), {
    papel,
    ativo,
    filasTratamento,
    podeAbrir: ['usuario', 'crf', 'admin'].includes(papel),
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.user.uid,
    atualizadoPorEmail: state.user.email
  });

  showToast('Usuário atualizado.', 'success');
  await loadUsersAdmin();
}

function bootAppUI() {
  els.userLine.textContent = `${selectedUserName()} • ${roleLabel(state.profile?.papel)}${Array.isArray(state.profile?.filasTratamento) && state.profile.filasTratamento.length ? ` • ${state.profile.filasTratamento.map(filaLabel).join(', ')}` : ''}`;
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin()));
  showOnly(els.appView);
  switchView('dashboard');
}

async function afterLogin() {
  await loadProfile();

  if (!state.profile) {
    showOnly(els.authView);
    return;
  }

  if (state.profile.ativo === false) {
    showOnly(els.blockedView);
    return;
  }

  bootAppUI();
  ensureDefaultPeriodFilters();
  await Promise.all([loadDivergencias(), loadCompradores(), loadUsersAdmin()]);
  await startTicketStreams();
}

onAuthStateChanged(auth, async (user) => {
  state.user = user || null;
  state.profile = null;
  stopTicketStreams();

  if (!user) {
    showOnly(els.authView);
    return;
  }

  await afterLogin();
});

els.authForm.addEventListener('submit', loginOrRegister);
els.tabLogin.addEventListener('click', () => setAuthMode('login'));
els.tabRegister.addEventListener('click', () => setAuthMode('register'));
els.googleBtn.addEventListener('click', loginGoogle);
els.resetPasswordBtn.addEventListener('click', resetPassword);
els.logoutBtn.addEventListener('click', () => signOut(auth));
els.logoutBlockedBtn.addEventListener('click', () => signOut(auth));
els.dashboardBtn.addEventListener('click', () => switchView('dashboard'));
els.reportsBtn.addEventListener('click', () => switchView('reports'));
els.adminBtn.addEventListener('click', () => switchView('admin'));
els.refreshBtn.addEventListener('click', () => loadTicketsOnce());
els.generateReportsBtn.addEventListener('click', () => { ensureDefaultPeriodFilters(); renderReports(); });

els.searchInput.addEventListener('input', renderAll);
els.compradorFilter.addEventListener('change', renderAll);

// Estes filtros mudam o conjunto que precisa ser lido do Firestore.
// Por isso recarregam sob demanda, em vez de usar listener geral.
[els.filaFilter, els.statusFilter, els.dateStart, els.dateEnd]
  .forEach((el) => el.addEventListener('change', () => loadTicketsOnce()));

[els.reportStart, els.reportEnd, els.reportFila].forEach((el) => el.addEventListener('change', renderReports));

document.addEventListener('click', async (event) => {
  const closeBtn = event.target.closest('[data-close-dialog]');
  if (closeBtn) $(closeBtn.dataset.closeDialog)?.close?.();

  const actionBtn = event.target.closest('[data-action]');
  if (actionBtn) {
    const ticket = state.tickets.find((item) => item.id === actionBtn.dataset.id);
    if (actionBtn.dataset.action === 'reserve') await reserveTicket(ticket);
    if (actionBtn.dataset.action === 'open') await openTicket(actionBtn.dataset.id);
  }

  const deleteTipoBtn = event.target.closest('[data-delete-tipo]');
  if (deleteTipoBtn) await deleteTipo(deleteTipoBtn.dataset.deleteTipo);

  const deleteBuyerBtn = event.target.closest('[data-delete-buyer]');
  if (deleteBuyerBtn) await deleteBuyer(deleteBuyerBtn.dataset.deleteBuyer);
});

els.tableBody.addEventListener('dblclick', (event) => {
  const row = event.target.closest('tr[data-ticket-id]');
  if (row) openTicket(row.dataset.ticketId);
});

els.reserveFromModalBtn.addEventListener('click', async () => {
  if (state.selectedTicket) await reserveTicket(state.selectedTicket);
  els.ticketDialog.close();
});

els.saveResponseBtn.addEventListener('click', saveResponse);
els.adminTipoFila.addEventListener('change', renderTiposAdmin);
els.addTipoBtn.addEventListener('click', addTipo);
els.adminTipoNome.addEventListener('keydown', (event) => { if (event.key === 'Enter') addTipo(); });
els.addBuyerBtn.addEventListener('click', addBuyer);
els.buyerNameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') addBuyer(); });
els.usersList.addEventListener('change', (event) => updateUserFromRow(event.target.closest('.user-item')));

setAuthMode('login');