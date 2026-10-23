import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  updateProfile,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  writeBatch,
  serverTimestamp,
  arrayUnion,
  query,
  where,
  orderBy,
  onSnapshot,
  runTransaction,
  limit
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyADfd6RhNN6rj6qX1judbjevvh-ZwMwmJE',
  authDomain: 'chamadossicofe-36fbe.firebaseapp.com',
  projectId: 'chamadossicofe-36fbe',
  storageBucket: 'chamadossicofe-36fbe.firebasestorage.app',
  messagingSenderId: '81395419196',
  appId: '1:81395419196:web:8322d61652f6240b49db39'
};

const APP_VERSION = 'V35-comercial-fila-cronologica-TESTE';
const BOOTSTRAP_ADMIN_EMAIL = 'chamadossicofe@gmail.com';

const TICKET_TYPE_LABELS = {
  nf_caminhao_porta: 'Nota fiscal • Caminhão na porta',
  nf_adiantamento: 'Nota fiscal • Adiantamento',
  reativacao_produtos: 'Reativação de produtos',
  novos_produtos: 'Novos produtos',
  pedido_em_andamento: 'Pedido em andamento',
  divergencia_flow: 'Divergência no Flow'
};

const TICKET_GROUPS = {
  nota_fiscal: ['nf_caminhao_porta', 'nf_adiantamento'],
  produtos: ['reativacao_produtos', 'novos_produtos', 'pedido_em_andamento', 'divergencia_flow']
};

const PRODUCT_TICKET_TYPES = new Set(TICKET_GROUPS.produtos);
const INVOICE_TICKET_TYPES = new Set(TICKET_GROUPS.nota_fiscal);

function ticketTypeLabel(type) {
  return TICKET_TYPE_LABELS[type] || type || 'Chamado';
}

function isProductTicketType(type) {
  return PRODUCT_TICKET_TYPES.has(type);
}

function isInvoiceTicketType(type) {
  return INVOICE_TICKET_TYPES.has(type || 'nota_fiscal');
}

const STATUS_LABELS = {
  aberto: 'Aberto',
  reaberto: 'Reaberto',
  em_tratamento: 'Em tratamento',
  informacoes_divergentes: 'Informações divergentes',
  devolver_recusar: 'Devolver e recusar',
  finalizado: 'Finalizado'
};

const ACTIVE_STATUSES = ['aberto', 'reaberto', 'em_tratamento'];
const CLOSED_STATUSES = ['finalizado', 'informacoes_divergentes', 'devolver_recusar'];
const ALL_TICKET_STATUSES = [...ACTIVE_STATUSES, ...CLOSED_STATUSES];
const LIVE_OPEN_LIMIT = 250;
const LIVE_TREATMENT_LIMIT = 250;
const ADMIN_ACTIVE_QUERY_LIMIT_PER_STATUS = 200;
const ADMIN_FILTERED_QUERY_LIMIT_PER_STATUS = 300;
const ADMIN_SLA_SETTINGS_KEY = 'xabuia_admin_sla_v1';
const COUNTED_STATUS_VALUES = ['aberto', 'reaberto', 'em_tratamento'];
const HISTORY_LIMIT = 300;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_ACTION = 5;
const MAX_ATTACHMENT_PANEL_ITEMS = 24;
const ATTACHMENT_ACCEPT = 'image/*,.pdf,.txt,.csv,.xml,.xlsx,.xls';
const ATTACHMENT_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'pdf', 'txt', 'csv', 'xml', 'xls', 'xlsx']);
const ATTACHMENT_MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'text/xml',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const HISTORY_TYPE_LABELS = {
  criacao: 'Criação',
  observacao: 'Observação',
  fiscal: 'Fiscal',
  divergencia: 'Divergência',
  devolucao: 'Devolução',
  reentrega: 'Reentrega',
  contato: 'Contato',
  tratativa: 'Tratativa',
  anexo: 'Anexo',
  status: 'Status',
  reabertura: 'Reabertura',
  informacoes_divergentes: 'Informações divergentes',
  devolver_recusar: 'Devolver e recusar',
  finalizado: 'Finalizado',
  em_tratamento: 'Em tratamento'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'pt-BR';
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();
const XABUIA_BLIN_URL = new URL('./blin.mp3', import.meta.url).href;

const $ = (id) => document.getElementById(id);

const els = {
  toast: $('toast'),
  authView: $('authView'),
  onboardingView: $('onboardingView'),
  blockedView: $('blockedView'),
  appView: $('appView'),
  tabLogin: $('tabLogin'),
  tabRegister: $('tabRegister'),
  authForm: $('authForm'),
  nameField: $('nameField'),
  displayNameInput: $('displayNameInput'),
  emailFieldLabel: $('emailFieldLabel'),
  xabuiaSoundBtn: $('xabuiaSoundBtn'),
  xabuiaAlertsBtn: $('xabuiaAlertsBtn'),
  xabuiaUnreadCount: $('xabuiaUnreadCount'),
  xabuiaAlertsDialog: $('xabuiaAlertsDialog'),
  xabuiaAlertsList: $('xabuiaAlertsList'),
  emailInput: $('emailInput'),
  passwordInput: $('passwordInput'),
  authSubmitBtn: $('authSubmitBtn'),
  googleBtn: $('googleBtn'),
  resetPasswordBtn: $('resetPasswordBtn'),
  connectionHelp: $('connectionHelp'),
  onboardingForm: $('onboardingForm'),
  onboardingNameInput: $('onboardingNameInput'),
  onboardingOrgSelect: $('onboardingOrgSelect'),
  onboardingEmpty: $('onboardingEmpty'),
  logoutOnboardingBtn: $('logoutOnboardingBtn'),
  logoutBlockedBtn: $('logoutBlockedBtn'),
  userLine: $('userLine'),
  adminPanel: $('adminPanel'),
  quickOrgForm: $('quickOrgForm'),
  quickOrgNameInput: $('quickOrgNameInput'),
  quickOrgList: $('quickOrgList'),
  newTicketBtn: $('newTicketBtn'),
  adminBtn: $('adminBtn'),
  logoutBtn: $('logoutBtn'),
  adminQueryActiveBtn: $('adminQueryActiveBtn'),
  adminClearQueryBtn: $('adminClearQueryBtn'),
  searchInput: $('searchInput'),
  ticketTypeFilter: $('ticketTypeFilter'),
  statusFilter: $('statusFilter'),
  orgFilterWrap: $('orgFilterWrap'),
  orgFilter: $('orgFilter'),
  mainDateStart: $('mainDateStart'),
  mainDateEnd: $('mainDateEnd'),
  countAberto: $('countAberto'),
  countReaberto: $('countReaberto'),
  countTratamento: $('countTratamento'),
  countInformacoesDivergentes: $('countInformacoesDivergentes'),
  countDevolverRecusar: $('countDevolverRecusar'),
  countFinalizado: $('countFinalizado'),
  countTotal: $('countTotal'),
  liveStatus: $('liveStatus'),
  ticketList: $('ticketList'),
  ticketDetail: $('ticketDetail'),
  ticketTypeDialog: $('ticketTypeDialog'),
  chooseInvoiceTruckBtn: $('chooseInvoiceTruckBtn'),
  chooseInvoiceAdvanceBtn: $('chooseInvoiceAdvanceBtn'),
  chooseProductReactivationBtn: $('chooseProductReactivationBtn'),
  chooseNewProductBtn: $('chooseNewProductBtn'),
  choosePedidoAndamentoBtn: $('choosePedidoAndamentoBtn'),
  chooseDivergenciaFlowBtn: $('chooseDivergenciaFlowBtn'),
  ticketDialog: $('ticketDialog'),
  ticketForm: $('ticketForm'),
  ticketDialogTitle: $('ticketDialogTitle'),
  ticketTypeInput: $('ticketTypeInput'),
  ticketKeyInput: $('ticketKeyInput'),
  ticketKeyHelp: $('ticketKeyHelp'),
  ticketKeyError: $('ticketKeyError'),
  ticketKeyPreview: $('ticketKeyPreview'),
  ticketKeyCleanText: $('ticketKeyCleanText'),
  ticketOrgWrap: $('ticketOrgWrap'),
  ticketOrgSelect: $('ticketOrgSelect'),
  ticketObsInput: $('ticketObsInput'),
  ticketFileInput: $('ticketFileInput'),
  ticketPasteZone: $('ticketPasteZone'),
  ticketPastePreview: $('ticketPastePreview'),
  clearTicketFileBtn: $('clearTicketFileBtn'),
  saveTicketBtn: $('saveTicketBtn'),
  productTicketDialog: $('productTicketDialog'),
  productTicketForm: $('productTicketForm'),
  productDialogTitle: $('productDialogTitle'),
  productTypeInput: $('productTypeInput'),
  productCodeInput: $('productCodeInput'),
  productOrgWrap: $('productOrgWrap'),
  productOrgSelect: $('productOrgSelect'),
  productObsInput: $('productObsInput'),
  productObsPreview: $('productObsPreview'),
  productFileInput: $('productFileInput'),
  productPasteZone: $('productPasteZone'),
  productPastePreview: $('productPastePreview'),
  clearProductFileBtn: $('clearProductFileBtn'),
  saveProductTicketBtn: $('saveProductTicketBtn'),
  adminDialog: $('adminDialog'),
  orgForm: $('orgForm'),
  orgNameInput: $('orgNameInput'),
  orgAdminList: $('orgAdminList'),
  usersAdminList: $('usersAdminList'),
  operatorReportStart: $('operatorReportStart'),
  operatorReportEnd: $('operatorReportEnd'),
  operatorReportBtn: $('operatorReportBtn'),
  operatorReportBox: $('operatorReportBox'),
  slaAbertoMin: $('slaAbertoMin'),
  slaReabertoMin: $('slaReabertoMin'),
  slaTratamentoMin: $('slaTratamentoMin'),
  adminSlaQueryBtn: $('adminSlaQueryBtn'),
  adminSlaReportBox: $('adminSlaReportBox')
};

const state = {
  mode: 'login',
  user: null,
  profile: null,
  orgs: [],
  users: [],
  tickets: [],
  selectedTicketId: null,
  pendingTicketFile: null,
  pendingTicketFiles: [],
  pendingHistoryFile: null,
  pendingHistoryFiles: [],
  pendingProductFile: null,
  pendingProductFiles: [],
  ticketBuckets: {},
  optimisticReservations: new Map(),
  unsubTickets: null,
  unsubOrgs: null,
  unsubUsers: null,
  unsubProfile: null,
  searchTimer: null,
  searchToken: 0,
  filterTimer: null,
  filterToken: 0,
  historyLoadedFor: null,
  notifications: [],
  soundContext: null,
  soundAllowed: false
};

const BASE_DOCUMENT_TITLE = document.title || 'Xabuia 1.0';
let lastOpenReopenedTitleCount = 0;
let titleAlertInterval = null;
let titleAlertTimeout = null;

function openReopenedLoadedCount() {
  return state.tickets.filter((ticket) => ['aberto', 'reaberto'].includes(ticket?.status || 'aberto')).length;
}

function setBrowserTitleCount(count) {
  document.title = count > 0 ? `(${count}) ${BASE_DOCUMENT_TITLE}` : BASE_DOCUMENT_TITLE;
}

function stopTitleBlink(count = openReopenedLoadedCount()) {
  if (titleAlertInterval) window.clearInterval(titleAlertInterval);
  if (titleAlertTimeout) window.clearTimeout(titleAlertTimeout);
  titleAlertInterval = null;
  titleAlertTimeout = null;
  setBrowserTitleCount(count);
}

function updateBrowserTitleAlert() {
  const count = openReopenedLoadedCount();

  if (count > lastOpenReopenedTitleCount && count > 0) {
    stopTitleBlink(count);
    let blink = false;
    titleAlertInterval = window.setInterval(() => {
      blink = !blink;
      document.title = blink ? `🔔 ${count} novo(s) • ${BASE_DOCUMENT_TITLE}` : `(${count}) ${BASE_DOCUMENT_TITLE}`;
    }, 900);
    titleAlertTimeout = window.setTimeout(() => stopTitleBlink(count), 9000);
  } else if (!titleAlertInterval) {
    setBrowserTitleCount(count);
  }

  lastOpenReopenedTitleCount = count;
}

function showToast(message, type = 'info') {
  els.toast.textContent = message;
  els.toast.className = `toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add('hidden'), 4200);
}

function showConnectionHelp(message = '') {
  if (!els.connectionHelp) return;
  els.connectionHelp.textContent = message || 'Não foi possível conectar aos dados agora.';
  els.connectionHelp.classList.remove('hidden');
}

function hideConnectionHelp() {
  if (els.connectionHelp) els.connectionHelp.classList.add('hidden');
}

function showOnly(view) {
  [els.authView, els.onboardingView, els.blockedView, els.appView].forEach((el) => el.classList.add('hidden'));
  view.classList.remove('hidden');
}

function isBootstrapAdmin(user = state.user) {
  return user?.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
}

function isAdmin() {
  return state.profile?.papel === 'admin' || isBootstrapAdmin();
}

function isOperator() {
  return state.profile?.papel === 'operador';
}

function isOperatorOrAdmin() {
  return ['admin', 'operador'].includes(state.profile?.papel) || isBootstrapAdmin();
}

function normalizeKey(value) {
  return String(value || '').trim();
}

function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
}

function limparChaveNfe(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 44);
}

function chaveNfeValida(value) {
  return limparChaveNfe(value).length === 44;
}

function syncTicketKeyInput(showError = false) {
  if (!els.ticketKeyInput) return '';

  const clean = limparChaveNfe(els.ticketKeyInput.value);

  if (els.ticketKeyInput.value !== clean) {
    els.ticketKeyInput.value = clean;
  }

  if (els.ticketKeyCleanText) {
    els.ticketKeyCleanText.textContent = clean || '—';
  }

  if (els.ticketKeyPreview) {
    els.ticketKeyPreview.classList.toggle('hidden', !clean);
  }

  const invalid = showError && clean.length !== 44;

  if (els.ticketKeyError) {
    els.ticketKeyError.classList.toggle('hidden', !invalid);
  }

  els.ticketKeyInput.classList.toggle('invalid', invalid);

  return clean;
}

function keySearchValue(value) {
  const digits = digitsOnly(value);
  return digits || normalizeKey(value).toLowerCase();
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

function safeDocPart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

function ticketDocId(orgId, chaveBusca) {
  return `${safeDocPart(orgId)}_${hashText(chaveBusca)}`;
}

function parseNfeKey(chave) {
  const digits = digitsOnly(chave);
  if (digits.length !== 44) return null;

  const notaRaw = digits.slice(25, 34);
  const notaNumero = Number.parseInt(notaRaw, 10);

  return {
    chave: digits,
    uf: digits.slice(0, 2),
    anoMes: digits.slice(2, 6),
    cnpj: digits.slice(6, 20),
    modelo: digits.slice(20, 22),
    serie: digits.slice(22, 25),
    numeroRaw: notaRaw,
    numero: Number.isFinite(notaNumero) ? String(notaNumero) : notaRaw,
    tipoEmissao: digits.slice(34, 35),
    codigo: digits.slice(35, 43),
    digito: digits.slice(43, 44)
  };
}

function compactKeyTitle(chave) {
  const parsed = parseNfeKey(chave);
  if (!parsed) return normalizeKey(chave);
  return `NF ${parsed.numero}`;
}

function invoiceCnpjLine(chave) {
  const parsed = parseNfeKey(chave);
  return parsed ? `CNPJ ${parsed.cnpj}` : '';
}

function shortAccessKey(chave) {
  const clean = digitsOnly(chave);
  if (!clean) return normalizeKey(chave || '');
  if (clean.length <= 22) return clean;
  return `${clean.slice(0, 10)}…${clean.slice(-8)}`;
}

function renderKeyInfo(chave) {
  const parsed = parseNfeKey(chave);
  if (!parsed) {
    return `<div class="key-box"><div class="key-raw">${escapeHtml(chave)}</div></div>`;
  }

  return `
    <div class="key-box">
      <div class="key-main">${escapeHtml(parsed.chave)}</div>
      <div class="key-facts">
        <span><strong>Número:</strong> ${escapeHtml(parsed.numero)}</span>
        <span><strong>CNPJ:</strong> ${escapeHtml(parsed.cnpj)}</span>
      </div>
    </div>
  `;
}

function historyTypeLabel(type) {
  return HISTORY_TYPE_LABELS[type] || type || 'Observação';
}

function historyTypeBadge(type) {
  const safe = String(type || 'observacao').replace(/[^a-z0-9_-]/gi, '_');
  return `<span class="history-type ${safe}">${escapeHtml(historyTypeLabel(type))}</span>`;
}

function shortPersonName(value) {
  const clean = normalizeKey(value);
  if (!clean) return '';
  const parts = clean.split(' ').filter(Boolean);
  return parts.length > 2 ? `${parts[0]} ${parts[1]}` : clean;
}

function selectedUserName() {
  return shortPersonName(state.profile?.nome || state.user?.displayName || state.user?.email || 'Usuário');
}

function statusAutoOccurrenceText(status) {
  if (status === 'em_tratamento') return `Reservado por: ${selectedUserName()}`;
  return '';
}

function safeIdFromName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `org-${Date.now()}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function minutesBetween(startMs, endMs = Date.now()) {
  if (!startMs) return null;
  return Math.max(0, Math.floor((endMs - startMs) / 60000));
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

function statusStartedAtMillis(ticket, status = ticket?.status) {
  if (!ticket) return 0;
  if (status === 'reaberto') return timestampMillis(ticket.reabertoEm) || timestampMillis(ticket.atualizadoEm) || timestampMillis(ticket.criadoEm);
  if (status === 'em_tratamento') return timestampMillis(ticket.tratamentoIniciadoEm) || timestampMillis(ticket.atualizadoEm) || timestampMillis(ticket.criadoEm);
  if (status === 'aberto') return timestampMillis(ticket.criadoEm) || timestampMillis(ticket.atualizadoEm);
  return timestampMillis(ticket.atualizadoEm) || timestampMillis(ticket.criadoEm);
}

function ticketAgeMinutes(ticket) {
  return minutesBetween(statusStartedAtMillis(ticket), Date.now());
}

function roleLabel(role) {
  return ({ admin: 'Admin', operador: 'Operador', usuario: 'Usuário' })[role] || role || 'Usuário';
}

function statusBadge(status) {
  const label = STATUS_LABELS[status] || status || 'Aberto';
  const safe = status || 'aberto';
  return `<span class="status ${safe}">${label}</span>`;
}

function colorHash(value) {
  let hash = 0;
  const textValue = String(value || 'Sem organização');
  for (let i = 0; i < textValue.length; i += 1) {
    hash = ((hash << 5) - hash) + textValue.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function orgHue(orgName) {
  return colorHash(orgName) % 360;
}

function orgChipHtml(orgName, extraClass = '') {
  const label = normalizeKey(orgName || 'Sem organização');
  const hue = orgHue(label);
  const safeClass = extraClass ? ` ${extraClass}` : '';
  return `<span class="org-chip${safeClass}" style="--org-h:${hue}"><span class="org-dot"></span>${escapeHtml(label)}</span>`;
}

function ticketQueueLabel(ticket) {
  const status = ticket?.status || 'aberto';
  const age = formatMinutes(ticketAgeMinutes(ticket));

  if (status === 'aberto') return `${age}`;
  if (status === 'reaberto') return `${age}`;
  if (status === 'em_tratamento') return `${age}`;

  return `Atualizado ${formatDate(ticket?.atualizadoEm)}`;
}

function ticketDisplayStatusPriority(status) {
  return ({
    reaberto: 0,
    aberto: 1,
    em_tratamento: 2,
    informacoes_divergentes: 3,
    devolver_recusar: 4,
    finalizado: 5
  })[status || 'aberto'] ?? 99;
}

function queueTimestamp(ticket) {
  return statusStartedAtMillis(ticket, ticket?.status)
    || timestampMillis(ticket?.criadoEm)
    || timestampMillis(ticket?.atualizadoEm)
    || Date.now();
}

function sortTicketsForDisplay(tickets) {
  // Abertura original é a única prioridade. Reservas e reaberturas nunca reordenam.
  return [...tickets].sort((a, b) => {
    const aTime = timestampMillis(a.criadoEm) || timestampMillis(a.atualizadoEm) || 0;
    const bTime = timestampMillis(b.criadoEm) || timestampMillis(b.atualizadoEm) || 0;
    return aTime - bTime || String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function canReserveTicket(ticket) {
  return isOperatorOrAdmin()
    && ['aberto', 'reaberto'].includes(ticket?.status || 'aberto')
    && state.user?.uid;
}

function reserveButtonHtml(ticket) {
  if (!canReserveTicket(ticket)) return '';
  return `<button class="btn reserve-ticket-btn" type="button" data-reserve-ticket-id="${escapeHtml(ticket.id)}">Reservar</button>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


function isMultiDropdown(control) {
  return !!control?.classList?.contains('multi-dropdown');
}

function filterCheckboxes(control) {
  return [...(control?.querySelectorAll?.('input[data-filter-option]') || [])];
}

function selectedValues(control, allValue = 'todos') {
  if (!control) return [allValue];

  if (isMultiDropdown(control)) {
    const values = filterCheckboxes(control)
      .filter((input) => input.checked)
      .map((input) => input.value)
      .filter(Boolean);
    return values.length ? values : [allValue];
  }

  if (!control.multiple) return [control.value || allValue];

  const values = [...control.selectedOptions].map((opt) => opt.value).filter(Boolean);
  return values.length ? values : [allValue];
}

function updateMultiDropdownLabel(control, allValue) {
  if (!isMultiDropdown(control)) return;

  const label = control.querySelector('.multi-dropdown-label');
  if (!label) return;

  const allLabel = control.dataset.labelAll || 'Todos';
  const singular = control.dataset.labelSingular || 'item';
  const plural = control.dataset.labelPlural || 'itens';
  const values = selectedValues(control, allValue);

  if (values.includes(allValue)) {
    label.textContent = allLabel;
    return;
  }

  const checked = filterCheckboxes(control).filter((input) => input.checked);
  if (checked.length === 1) {
    label.textContent = checked[0].closest('label')?.textContent?.trim() || checked[0].value;
    return;
  }

  label.textContent = `${checked.length} ${checked.length === 1 ? singular : plural}`;
}

function normalizeMultiDropdown(control, allValue, changedInput = null) {
  if (!isMultiDropdown(control)) return;

  const checkboxes = filterCheckboxes(control);
  const allInput = checkboxes.find((input) => input.value === allValue);
  if (!allInput) return;

  if (changedInput?.value === allValue && changedInput.checked) {
    checkboxes.forEach((input) => {
      if (input !== allInput) input.checked = false;
    });
  } else if (changedInput && changedInput.value !== allValue && changedInput.checked) {
    allInput.checked = false;
  }

  if (!checkboxes.some((input) => input.checked)) {
    allInput.checked = true;
  }

  updateMultiDropdownLabel(control, allValue);
}

function normalizeMultiSelect(control, allValue, changedInput = null) {
  if (!control) return;

  if (isMultiDropdown(control)) {
    normalizeMultiDropdown(control, allValue, changedInput);
    return;
  }

  if (!control.multiple) return;

  const selected = [...control.selectedOptions].map((opt) => opt.value);
  const allOption = [...control.options].find((opt) => opt.value === allValue);
  if (!allOption) return;

  if (!selected.length) {
    allOption.selected = true;
    return;
  }

  if (selected.length > 1 && selected.includes(allValue)) {
    allOption.selected = false;
  }
}

function closeMultiDropdown(control) {
  if (isMultiDropdown(control)) {
    window.setTimeout(() => { control.open = false; }, 80);
  }
}

function handleTicketTypeFilterChange(event) {
  normalizeMultiSelect(els.ticketTypeFilter, 'todos', event.target);
  renderTickets();
  if (event.target?.matches?.('input[data-filter-option]')) closeMultiDropdown(els.ticketTypeFilter);
}

function handleOrgFilterChange(event) {
  normalizeMultiSelect(els.orgFilter, 'todas', event.target);
  renderTickets();
  if (event.target?.matches?.('input[data-filter-option]')) closeMultiDropdown(els.orgFilter);
}

function normalizeProductCode(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function ticketTitle(ticket) {
  const type = ticket?.tipoChamado || 'nota_fiscal';
  if (isProductTicketType(type)) {
    return `${ticketTypeLabel(type)} • Produto ${ticket.codigoProduto || ticket.chave || '—'}`;
  }
  return compactKeyTitle(ticket?.chave || '');
}

function ticketRawLine(ticket) {
  const type = ticket?.tipoChamado || 'nota_fiscal';
  if (isProductTicketType(type)) return `Produto: ${ticket.codigoProduto || ticket.chave || '—'}`;

  const parsed = parseNfeKey(ticket?.chave || '');
  if (!parsed) return ticket.chave || '';
  return `CNPJ ${parsed.cnpj} • Série ${parsed.serie} • Modelo ${parsed.modelo} • Chave ${shortAccessKey(parsed.chave)}`;
}

function isTabularText(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 1) return false;
  const tabLines = lines.filter((line) => line.includes('\t'));
  if (!tabLines.length) return false;
  const maxCols = Math.max(...tabLines.map((line) => line.split('\t').length));
  return maxCols >= 2;
}

function renderTextContent(text) {
  const value = String(text ?? '');
  if (!isTabularText(value)) {
    return `<div class="history-text">${escapeHtml(value)}</div>`;
  }

  const rows = value.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'));
  const maxCols = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(maxCols - row.length).fill('')]);

  return `
    <div class="excel-table-wrap">
      <table class="excel-table">
        <tbody>
          ${normalized.map((row) => `
            <tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderProductInfo(ticket) {
  return `
    <div class="key-box product-key-box">
      <div class="key-facts product-facts">
        <span><strong>Formulário:</strong> ${escapeHtml(ticketTypeLabel(ticket.tipoChamado))}</span>
        <span><strong>Código do produto:</strong> ${escapeHtml(ticket.codigoProduto || ticket.chave || '—')}</span>
      </div>
    </div>
  `;
}

function renderTicketInfo(ticket) {
  if (isProductTicketType(ticket.tipoChamado)) return renderProductInfo(ticket);
  return renderKeyInfo(ticket.chave);
}


function renderTicketInfoCompact(ticket) {
  // Compatibilidade: outras partes antigas podem chamar esta função.
  return renderTicketDetailFacts(ticket);
}

function ticketInvoiceParts(ticket) {
  return parseNfeKey(ticket?.chave || '') || null;
}

function fullAccessKey(ticket) {
  if (isProductTicketType(ticket?.tipoChamado)) return normalizeKey(ticket?.codigoProduto || ticket?.chave || '—');
  const parsed = ticketInvoiceParts(ticket);
  return parsed?.chave || normalizeKey(ticket?.chave || '—');
}

function ticketCardTitleHtml(ticket) {
  if (isProductTicketType(ticket?.tipoChamado)) {
    return `Produto: <span>${escapeHtml(ticket?.codigoProduto || ticket?.chave || '—')}</span>`;
  }

  const parsed = ticketInvoiceParts(ticket);
  if (!parsed) return escapeHtml(ticket?.chave || 'Chamado');

  return `NF: <span>${escapeHtml(parsed.numero)}</span> <em>•</em> CNPJ: <span>${escapeHtml(parsed.cnpj)}</span>`;
}

function ticketFullReferenceHtml(ticket) {
  if (isProductTicketType(ticket?.tipoChamado)) {
    return `<span>Código:</span> <code>${escapeHtml(fullAccessKey(ticket))}</code>`;
  }

  return `<span>Chave de acesso:</span> <code>${escapeHtml(fullAccessKey(ticket))}</code>`;
}

function ticketTreatingHtml(ticket, className = 'operator-chip') {
  const name = normalizeKey(ticket?.operadorTratamentoNome || ticket?.operadorTratamentoEmail || '');
  if (name) return `<span class="${className}">Tratando: <strong>${escapeHtml(name)}</strong></span>`;
  return '<span class="operator-empty">Tratando: <strong>—</strong></span>';
}

function renderTicketDetailFacts(ticket) {
  if (isProductTicketType(ticket?.tipoChamado)) {
    return `
      <div class="detail-facts-line-v30 detail-facts-product">
        <span><strong>Produto</strong> ${escapeHtml(ticket?.codigoProduto || ticket?.chave || '—')}</span>
        <span><strong>Organização</strong> ${escapeHtml(ticket?.organizacaoNome || '—')}</span>
        <span class="detail-full-key-inline"><strong>Código:</strong> <code>${escapeHtml(fullAccessKey(ticket))}</code></span>
      </div>
    `;
  }

  const parsed = ticketInvoiceParts(ticket);
  if (!parsed) {
    return `
      <div class="detail-facts-line-v30">
        <span class="detail-full-key-inline"><strong>Referência:</strong> <code>${escapeHtml(ticket?.chave || '—')}</code></span>
      </div>
    `;
  }

  return `
    <div class="detail-facts-line-v30 detail-facts-invoice">
      <span><strong>NF</strong> ${escapeHtml(parsed.numero)}</span>
      <span><strong>CNPJ</strong> ${escapeHtml(parsed.cnpj)}</span>
      <span class="detail-full-key-inline"><strong>Chave:</strong> <code>${escapeHtml(parsed.chave)}</code></span>
    </div>
  `;
}

function updateProductObsPreview() {
  if (!els.productObsPreview || !els.productObsInput) return;
  const text = els.productObsInput.value;
  if (!isTabularText(text)) {
    els.productObsPreview.classList.add('hidden');
    els.productObsPreview.innerHTML = '';
    return;
  }
  els.productObsPreview.innerHTML = `<strong>Prévia da tabela colada:</strong>${renderTextContent(text)}`;
  els.productObsPreview.classList.remove('hidden');
}

function setText(el, value) {
  if (el) el.textContent = value;
}

function currentUserSolicitanteArray() {
  return state.user?.uid ? [state.user.uid] : [];
}

function requesterUpdatePayload() {
  return state.user?.uid ? { solicitantesIds: arrayUnion(state.user.uid) } : {};
}

function lastOccurrencePayload(texto, tipo, anexo = null) {
  const payload = {
    ultimaOcorrenciaTexto: normalizeKey(texto || ''),
    ultimaOcorrenciaTipo: tipo || 'observacao',
    ultimaOcorrenciaUsuarioId: state.user?.uid || null,
    ultimaOcorrenciaUsuarioNome: selectedUserName(),
    ultimaOcorrenciaUsuarioEmail: state.user?.email || null,
    ultimaOcorrenciaEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  };
  if (anexo) payload.anexo = anexo;
  return payload;
}

function createTicketBasePayload({ tipoChamado, chave, chaveBusca, org, codigoProduto = null, observacao = '', tipoHistorico = 'criacao' }) {
  return {
    tipoChamado,
    ...(codigoProduto ? { codigoProduto } : {}),
    chave,
    chaveBusca,
    organizacaoId: org.id,
    organizacaoNome: org.nome,
    status: 'aberto',
    criadoPor: state.user.uid,
    criadoPorNome: selectedUserName(),
    criadoPorEmail: state.user.email,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
    solicitantesIds: currentUserSolicitanteArray(),
    ultimaOcorrenciaTexto: normalizeKey(observacao || ''),
    ultimaOcorrenciaTipo: tipoHistorico,
    ultimaOcorrenciaUsuarioId: state.user.uid,
    ultimaOcorrenciaUsuarioNome: selectedUserName(),
    ultimaOcorrenciaUsuarioEmail: state.user.email,
    ultimaOcorrenciaEm: serverTimestamp()
  };
}


function historyPayload(texto, tipo = 'observacao', extra = {}) {
  return {
    texto: normalizeKey(texto || ''),
    tipo: tipo || 'observacao',
    usuarioId: state.user.uid,
    usuarioNome: selectedUserName(),
    usuarioEmail: state.user.email || '',
    criadoEm: serverTimestamp(),
    ...extra
  };
}

async function addHistoryDoc(ticketId, texto, tipo = 'observacao', extra = {}) {
  await addDoc(collection(db, 'chamados', ticketId, 'historico'), historyPayload(texto, tipo, extra));
}

function eventTypeForStatus(status) {
  if (status === 'em_tratamento') return 'em_tratamento';
  if (status === 'finalizado') return 'finalizado';
  if (status === 'reaberto') return 'reaberto';
  if (status === 'informacoes_divergentes') return 'informacoes_divergentes';
  if (status === 'devolver_recusar') return 'devolver_recusar';
  return 'status';
}

function isCountedStatus(status) {
  return COUNTED_STATUS_VALUES.includes(String(status || ''));
}

function statusStartValue(ticket, status = ticket?.status) {
  if (!ticket) return null;
  if (status === 'reaberto') return ticket.reabertoEm || ticket.atualizadoEm || ticket.criadoEm || null;
  if (status === 'em_tratamento') return ticket.tratamentoIniciadoEm || ticket.atualizadoEm || ticket.criadoEm || null;
  if (status === 'aberto') return ticket.criadoEm || ticket.atualizadoEm || null;
  return ticket.atualizadoEm || ticket.criadoEm || null;
}

function timelineTicketBase(ticket, ticketRef = null) {
  return {
    chamadoId: ticketRef?.id || ticket?.id || '',
    organizacaoId: ticket?.organizacaoId || '',
    organizacaoNome: ticket?.organizacaoNome || '',
    tipoChamado: ticket?.tipoChamado || 'nota_fiscal',
    chave: ticket?.chave || ticket?.codigoProduto || ''
  };
}

function statusEventPayload(ticket, ticketRef, options = {}) {
  const base = timelineTicketBase(ticket, ticketRef);
  return {
    ...base,
    tipoEvento: options.tipoEvento || 'mudanca_status',
    status: options.status || options.statusNovo || ticket?.status || 'aberto',
    statusAnterior: options.statusAnterior || '',
    statusNovo: options.statusNovo || options.status || '',
    contabilizaTempo: Boolean(options.contabilizaTempo),
    inicioEm: options.inicioEm ?? null,
    fimEm: options.fimEm ?? null,
    duracaoMin: Number.isFinite(Number(options.duracaoMin)) ? Number(options.duracaoMin) : null,
    usuarioId: state.user.uid,
    usuarioNome: selectedUserName(),
    usuarioEmail: state.user.email || '',
    texto: normalizeKey(options.texto || ''),
    criadoEm: serverTimestamp()
  };
}

function queueStatusTimelineEvents(batch, ticketRef, previousTicket, statusNovo, texto = '', newTicketData = null) {
  if (!batch || !ticketRef || !state.user?.uid) return;

  const statusAnterior = previousTicket?.status || '';
  const effectiveTicket = previousTicket || { id: ticketRef.id, ...(newTicketData || {}), status: statusNovo };
  const eventsRef = collection(db, 'chamados', ticketRef.id, 'status_eventos');

  if (!previousTicket) {
    const entradaStatus = statusNovo || 'aberto';
    batch.set(doc(eventsRef), statusEventPayload(effectiveTicket, ticketRef, {
      tipoEvento: 'entrada_status',
      status: entradaStatus,
      statusAnterior: '',
      statusNovo: entradaStatus,
      contabilizaTempo: isCountedStatus(entradaStatus),
      inicioEm: serverTimestamp(),
      fimEm: null,
      duracaoMin: null,
      texto
    }));
    return;
  }

  if (!statusNovo || statusNovo === statusAnterior) return;

  if (isCountedStatus(statusAnterior)) {
    batch.set(doc(eventsRef), statusEventPayload(previousTicket, ticketRef, {
      tipoEvento: 'saida_status',
      status: statusAnterior,
      statusAnterior,
      statusNovo,
      contabilizaTempo: true,
      inicioEm: statusStartValue(previousTicket, statusAnterior),
      fimEm: serverTimestamp(),
      duracaoMin: ticketAgeMinutes(previousTicket),
      texto
    }));
  }

  if (isCountedStatus(statusNovo)) {
    const nextTicket = { ...previousTicket, ...(newTicketData || {}), status: statusNovo };
    batch.set(doc(eventsRef), statusEventPayload(nextTicket, ticketRef, {
      tipoEvento: 'entrada_status',
      status: statusNovo,
      statusAnterior,
      statusNovo,
      contabilizaTempo: true,
      inicioEm: serverTimestamp(),
      fimEm: null,
      duracaoMin: null,
      texto
    }));
  } else {
    const nextTicket = { ...previousTicket, ...(newTicketData || {}), status: statusNovo };
    batch.set(doc(eventsRef), statusEventPayload(nextTicket, ticketRef, {
      tipoEvento: 'mudanca_status',
      status: statusNovo,
      statusAnterior,
      statusNovo,
      contabilizaTempo: false,
      inicioEm: null,
      fimEm: serverTimestamp(),
      duracaoMin: null,
      texto
    }));
  }
}

function operatorEventPayload(ticket, statusNovo, texto = '') {
  if (!ticket?.id || !isOperatorOrAdmin() || !state.user?.uid) return null;

  const statusAnterior = ticket.status || 'aberto';
  const tipo = eventTypeForStatus(statusNovo);
  if (tipo === 'status') return null;

  return {
    chamadoId: ticket.id,
    tipo,
    statusAnterior,
    statusNovo,
    operadorId: state.user.uid,
    operadorNome: selectedUserName(),
    operadorEmail: state.user.email || '',
    organizacaoId: ticket.organizacaoId || '',
    organizacaoNome: ticket.organizacaoNome || '',
    tipoChamado: ticket.tipoChamado || 'nota_fiscal',
    chave: ticket.chave || ticket.codigoProduto || '',
    titulo: ticketTitle(ticket),
    texto: normalizeKey(texto || ''),
    duracaoStatusAnteriorMin: isCountedStatus(statusAnterior) ? ticketAgeMinutes(ticket) : null,
    criadoEm: serverTimestamp()
  };
}

function queueOperatorEvent(batch, ticket, statusNovo, texto = '') {
  const payload = operatorEventPayload(ticket, statusNovo, texto);
  if (!payload) return;
  batch.set(doc(collection(db, 'operador_eventos')), payload);
}


async function tryCommitStatusTimelineEvent(ticketRef, ticket, statusNovo, texto = '', updatePayload = null) {
  if (!ticketRef || !ticket?.id || !statusNovo || statusNovo === ticket.status) return '';

  try {
    const eventBatch = writeBatch(db);
    queueStatusTimelineEvents(eventBatch, ticketRef, ticket, statusNovo, texto, updatePayload);
    await eventBatch.commit();
    return '';
  } catch (error) {
    console.warn('Ocorrência salva, mas status_eventos não foi gravado:', error);
    return 'Linha do tempo complementar não foi gravada.';
  }
}

async function tryCommitOperatorEvent(ticket, statusNovo, texto = '') {
  if (!ticket?.id || !statusNovo || statusNovo === ticket.status) return '';

  try {
    const eventBatch = writeBatch(db);
    queueOperatorEvent(eventBatch, ticket, statusNovo, texto);
    await eventBatch.commit();
    return '';
  } catch (error) {
    console.warn('Ocorrência salva, mas operador_eventos não foi gravado:', error);
    return 'Relatório complementar do operador não foi gravado.';
  }
}

async function addOperatorEvent(ticket, statusNovo, texto = '') {
  const payload = operatorEventPayload(ticket, statusNovo, texto);
  if (!payload) return;

  try {
    await addDoc(collection(db, 'operador_eventos'), payload);
  } catch (error) {
    console.warn('Evento do operador não foi gravado. O chamado continuou salvo:', error);
  }
}

function readAdminSlaSettings() {
  const defaults = { aberto: 30, reaberto: 30, em_tratamento: 60 };
  try {
    const raw = localStorage.getItem(ADMIN_SLA_SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      aberto: Math.max(1, Number(saved.aberto || defaults.aberto)),
      reaberto: Math.max(1, Number(saved.reaberto || defaults.reaberto)),
      em_tratamento: Math.max(1, Number(saved.em_tratamento || defaults.em_tratamento))
    };
  } catch (_) {
    return defaults;
  }
}

function writeAdminSlaSettings(settings) {
  try {
    localStorage.setItem(ADMIN_SLA_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) {}
}

function ensureAdminSlaControls() {
  if (!els.slaAbertoMin || !els.slaReabertoMin || !els.slaTratamentoMin) return;
  const settings = readAdminSlaSettings();
  if (!els.slaAbertoMin.value) els.slaAbertoMin.value = String(settings.aberto);
  if (!els.slaReabertoMin.value) els.slaReabertoMin.value = String(settings.reaberto);
  if (!els.slaTratamentoMin.value) els.slaTratamentoMin.value = String(settings.em_tratamento);
}

function currentAdminSlaSettingsFromInputs() {
  const settings = {
    aberto: Math.max(1, Number(els.slaAbertoMin?.value || 30)),
    reaberto: Math.max(1, Number(els.slaReabertoMin?.value || 30)),
    em_tratamento: Math.max(1, Number(els.slaTratamentoMin?.value || 60))
  };
  writeAdminSlaSettings(settings);
  return settings;
}


async function loadOrCreateProfile(user) {
  const profileRef = doc(db, 'usuarios', user.uid);
  const snap = await getDoc(profileRef);

  if (snap.exists()) {
    return { id: snap.id, ...snap.data() };
  }

  if (user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) {
    const data = {
      uid: user.uid,
      nome: user.displayName || 'Administrador SICOFÊ',
      email: user.email,
      organizacaoId: null,
      organizacaoNome: 'Todas as organizações',
      papel: 'admin',
      ativo: true,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    };
    await setDoc(profileRef, data);
    return { id: user.uid, ...data };
  }

  return null;
}

function startOrgListener() {
  if (state.unsubOrgs) state.unsubOrgs();
  const q = query(collection(db, 'organizacoes'), orderBy('nome'));
  state.unsubOrgs = onSnapshot(q, (snapshot) => {
    state.orgs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    hideConnectionHelp();
    renderOrgSelects();
    if (isAdmin()) renderAdmin();
  }, (error) => {
    const msg = error?.code === 'permission-denied'
      ? 'Firestore negou a leitura das organizações. Publique o arquivo firestore.rules no Firebase Console.'
      : `Erro ao carregar organizações: ${error.message}`;
    showToast(msg, 'error');
    showConnectionHelp(msg);
  });
}


function fillOrgDropdown(dropdown, activeOrgs, includeAll = false) {
  if (!isMultiDropdown(dropdown)) return;

  const allValue = dropdown.dataset.allValue || (includeAll ? 'todas' : 'todos');
  const selectedBefore = selectedValues(dropdown, allValue);
  const menu = dropdown.querySelector('.multi-dropdown-menu');
  if (!menu) return;

  menu.innerHTML = '';

  if (includeAll) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(allValue)}" data-filter-option /> ${escapeHtml(dropdown.dataset.labelAll || 'Todas')}`;
    menu.appendChild(label);
  }

  activeOrgs.forEach((org) => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(org.id)}" data-filter-option /> ${escapeHtml(org.nome)}`;
    menu.appendChild(label);
  });

  const checkboxes = filterCheckboxes(dropdown);
  checkboxes.forEach((input) => {
    input.checked = selectedBefore.includes(input.value);
  });

  if (includeAll && !checkboxes.some((input) => input.checked)) {
    const allInput = checkboxes.find((input) => input.value === allValue);
    if (allInput) allInput.checked = true;
  }

  normalizeMultiDropdown(dropdown, allValue);
}

function renderOrgSelects() {
  const activeOrgs = state.orgs.filter((org) => org.ativa !== false);

  const fill = (select, includeAll = false) => {
    if (!select) return;

    if (isMultiDropdown(select)) {
      fillOrgDropdown(select, activeOrgs, includeAll);
      return;
    }

    const selectedBefore = select.multiple ? [...select.selectedOptions].map((opt) => opt.value) : [];
    const current = select.value;

    select.innerHTML = '';

    if (includeAll) {
      const opt = document.createElement('option');
      opt.value = 'todas';
      opt.textContent = 'Todas';
      select.appendChild(opt);
    }

    activeOrgs.forEach((org) => {
      const opt = document.createElement('option');
      opt.value = org.id;
      opt.textContent = org.nome;
      select.appendChild(opt);
    });

    if (select.multiple) {
      const values = selectedBefore.length ? selectedBefore : (includeAll ? ['todas'] : []);
      [...select.options].forEach((opt) => {
        opt.selected = values.includes(opt.value);
      });
      if (includeAll && ![...select.selectedOptions].length && select.options.length) {
        select.options[0].selected = true;
      }
      return;
    }

    if ([...select.options].some((opt) => opt.value === current)) {
      select.value = current;
    } else if (includeAll && select.options.length) {
      select.value = 'todas';
    }
  };

  fill(els.onboardingOrgSelect, false);
  fill(els.ticketOrgSelect, false);
  fill(els.productOrgSelect, false);
  fill(els.orgFilter, true);

  const hasOrgs = activeOrgs.length > 0;
  els.onboardingEmpty.classList.toggle('hidden', hasOrgs);
  els.onboardingOrgSelect.disabled = !hasOrgs;
}

function startUsersListener() {
  if (state.unsubUsers) state.unsubUsers();
  if (!isAdmin()) return;

  const q = query(collection(db, 'usuarios'), orderBy('nome'));
  state.unsubUsers = onSnapshot(q, (snapshot) => {
    state.users = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAdmin();
  }, (error) => showToast(`Erro ao carregar usuários: ${error.message}`, 'error'));
}

function stopTicketsListener() {
  if (Array.isArray(state.unsubTickets)) {
    state.unsubTickets.forEach((unsub) => {
      try { unsub(); } catch (_) {}
    });
  } else if (typeof state.unsubTickets === 'function') {
    try { state.unsubTickets(); } catch (_) {}
  }
  state.unsubTickets = null;
  state.ticketBuckets = {};
  state.optimisticReservations.clear();
}

function mergeTicketBuckets() {
  try {
    const byId = new Map();
    Object.values(state.ticketBuckets).flat().forEach((ticket) => {
      if (ticket?.id) byId.set(ticket.id, ticket);
    });
    // A remoção do listener dos "livres" pode chegar antes da inclusão em "meus atribuídos".
    // Mantém a linha do próprio operador sem consultas ou writes extras.
    const now = Date.now();
    for (const [id, entry] of state.optimisticReservations) {
      const live = byId.get(id);
      if (live?.status === 'em_tratamento' && live.operadorTratamentoId === state.user?.uid) {
        state.optimisticReservations.delete(id);
        continue;
      }
      if (live && CLOSED_STATUSES.includes(live.status)) {
        state.optimisticReservations.delete(id);
        continue;
      }
      if (now > entry.until || state.user?.uid !== entry.ticket.operadorTratamentoId) {
        state.optimisticReservations.delete(id);
        continue;
      }
      byId.set(id, entry.ticket);
    }
    state.tickets = [...byId.values()];
    renderTickets();
    setText(els.liveStatus, 'Ao vivo');
  } catch (error) {
    console.error('Erro ao renderizar chamados:', error);
    setText(els.liveStatus, 'Erro');
    showToast(`Erro ao mostrar chamados: ${error.message}`, 'error');
  }
}

function noticeStoreKey() { return `xabuia_avisos_v33_${state.user?.uid || 'anon'}`; }
function soundPrefKey() { return `xabuia_som_v33_${state.user?.uid || 'anon'}`; }
function readSoundPref() { return !!state.user && localStorage.getItem(soundPrefKey()) === '1'; }
function eventTimestampMs(ticket) { return timestampMillis(ticket.ultimaOcorrenciaEm || ticket.atualizadoEm); }
function eventIdentity(ticket) {
  return `${ticket.id}|${eventTimestampMs(ticket)}|${ticket.ultimaOcorrenciaUsuarioId || ''}|${ticket.status || ''}|${ticket.ultimaOcorrenciaTexto || ''}`;
}
function ticketNoticeColor(status) {
  if (['finalizado'].includes(status)) return 'green';
  if (['devolver_recusar', 'informacoes_divergentes'].includes(status)) return 'red';
  if (['reaberto', 'em_tratamento'].includes(status)) return 'amber';
  return 'blue';
}
function setAlertStore() {
  try { localStorage.setItem(noticeStoreKey(), JSON.stringify(state.notifications.slice(0, 50))); } catch (_) {}
}
function updateNoticeButton() {
  const unread = state.notifications.filter((notice) => !notice.lida).length;
  if (els.xabuiaUnreadCount) els.xabuiaUnreadCount.textContent = String(unread);
  if (els.xabuiaAlertsBtn) els.xabuiaAlertsBtn.classList.toggle('xabuia-has-alerts', unread > 0);
  if (els.xabuiaSoundBtn) els.xabuiaSoundBtn.textContent = readSoundPref() ? '🔊 Som ligado' : '🔇 Ativar som';
}
function loadMyNotices() {
  try {
    const parsed = JSON.parse(localStorage.getItem(noticeStoreKey()) || '[]');
    state.notifications = Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch (_) { state.notifications = []; }
  updateNoticeButton();
}
// V33.1: áudio oficial publicado no mesmo GitHub Pages do site.
// Um único elemento HTMLAudioElement por aba evita múltiplos sons sobrepostos.
function soundElement() {
  if (!state.soundElement) {
    state.soundElement = new Audio(XABUIA_BLIN_URL);
    state.soundElement.preload = 'auto';
    state.soundElement.volume = 0.80;
  }
  return state.soundElement;
}
async function unlockNotificationSound() {
  // Deve ser chamado pelo clique do botão Ativar som, por política de autoplay.
  const audio = soundElement();
  try {
    audio.pause();
    audio.currentTime = 0;
    await audio.play(); // toca uma vez para testar o som no próprio clique
    return true;
  } catch (error) {
    console.warn('[Xabuia] Não consegui tocar blin.mp3:', error);
    return false;
  }
}
function beepXabuia() {
  if (!readSoundPref()) return;
  const audio = soundElement();
  try {
    audio.pause();
    audio.currentTime = 0;
    void audio.play().catch((error) => {
      console.warn('[Xabuia] Chrome bloqueou som blin.mp3. Clique em Ativar som novamente:', error);
    });
  } catch (error) { console.warn('[Xabuia] Som não disponível:', error); }
}
function webNotificationXabuia(notice) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification('🔔 Xabuia • Retorno do chamado', {
      body: notice.texto, icon: './xabuia.png', tag: `xabuia-${notice.id}`
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (_) {}
}
function notifyNewTicketEvent(ticket) {
  if (!state.user || !ticket?.id) return;
  const author = ticket.ultimaOcorrenciaUsuarioId || ticket.criadoPor || '';
  if (!author || author === state.user.uid) return;
  if (!isOperator() && !(ticket.solicitantesIds || []).includes(state.user.uid)) return;
  const marker = eventIdentity(ticket);
  if (state.notifications.some((n) => n.id === marker)) return;
  const texto = String(ticket.ultimaOcorrenciaTexto || `Status: ${ticket.status || 'aberto'}`).slice(0, 220);
  const notice = { id: marker, ticketId: ticket.id, status: ticket.status || 'aberto', texto, at: Date.now(), lida: false };
  state.notifications.unshift(notice);
  state.notifications = state.notifications.slice(0, 50);
  setAlertStore(); updateNoticeButton();
  beepXabuia(); webNotificationXabuia(notice);
  showToast(`🔔 Retorno Xabuia: ${texto.slice(0, 75)}`, 'success');
  renderTickets();
}
function renderMyNotices() {
  if (!els.xabuiaAlertsList) return;
  els.xabuiaAlertsList.innerHTML = state.notifications.length
    ? state.notifications.map((n) => `
      <button type="button" class="xabuia-alert-item xabuia-alert-${ticketNoticeColor(n.status)}"
         data-xabuia-alert-ticket="${escapeHtml(n.ticketId)}">
        <strong>${escapeHtml(STATUS_LABELS[n.status] || n.status || 'Chamado')}</strong>
        <small>${new Date(n.at).toLocaleString('pt-BR')}</small>
        <span>${escapeHtml(n.texto)}</span>
      </button>`).join('')
    : '<p class="muted">Nenhum aviso novo neste navegador.</p>';
}
async function toggleXabuiaSound() {
  if (!state.user) return;
  const next = !readSoundPref();
  localStorage.setItem(soundPrefKey(), next ? '1' : '0');
  if (next) {
    // A reprodução ocorre uma vez como confirmação ao ativar.
    const soundTest = unlockNotificationSound();
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) {}
    }
    if (!(await soundTest)) {
      showToast('Não consegui tocar blin.mp3. Confira se o arquivo está publicado e o Chrome permite som.', 'error');
      localStorage.setItem(soundPrefKey(), '0');
    }
  }
  updateNoticeButton();
}
function showMyNotices() {
  renderMyNotices();
  state.notifications.forEach((n) => { n.lida = true; });
  setAlertStore(); updateNoticeButton();
  els.xabuiaAlertsDialog?.showModal();
}
function listenTicketBucket(name, q) {
  // Não anuncia o snapshot inicial nem itens antigos reapresentados pelo Firestore.
  let initialSnapshot = true;
  const subscribedAt = Date.now();
  return onSnapshot(q, (snapshot) => {
    if (!initialSnapshot && !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') return;
        const ticket = { id: change.doc.id, ...change.doc.data() };
        const time = eventTimestampMs(ticket);
        // Só mudanças ocorridas depois do início do monitor, sem tocar em dados históricos.
        if (time && time >= subscribedAt - 1500) notifyNewTicketEvent(ticket);
      });
    }
    initialSnapshot = false;
    state.ticketBuckets[name] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    mergeTicketBuckets();
  }, (error) => {
    setText(els.liveStatus, 'Erro');
    if (String(error?.message || '').includes('requires an index')) {
      showToast('O Firestore pediu um índice composto. Esta versão evita os índices compostos principais; confira se atualizou todos os arquivos e recarregou com Ctrl + F5.', 'error');
      return;
    }
    showToast(`Erro ao carregar chamados: ${error.message}`, 'error');
  });
}

function startTicketsListener() {
  stopTicketsListener();
  setText(els.liveStatus, 'Atualizando...');

  const chamadosRef = collection(db, 'chamados');

  // Admin não fica ouvindo chamados o dia todo.
  // Ele consulta manualmente pelo botão "Consultar ativos" ou pelos relatórios.
  if (isAdmin()) {
    state.tickets = [];
    renderTickets();
    setText(els.liveStatus, 'Admin: consulta manual econômica');
    return;
  }

  // Operador acompanha ao vivo só a fila aberta/reaberta + os próprios em tratamento.
  // Usuário comum acompanha somente chamados onde ele está em solicitantesIds.
  if (isOperator()) {
    state.unsubTickets = [
      listenTicketBucket(
        'fila_aberta_reaberta',
        query(chamadosRef, where('status', 'in', ['aberto', 'reaberto']), limit(LIVE_OPEN_LIMIT))
      ),
      listenTicketBucket(
        'meus_atribuidos',
        query(
          chamadosRef,
          // Inclui finalizados/devolvidos, para receber o último retorno ao sair de "em tratamento".
          where('operadorTratamentoId', '==', state.user.uid),
          limit(LIVE_TREATMENT_LIMIT)
        )
      )
    ];
    return;
  }

  state.unsubTickets = [
    listenTicketBucket(
      'meus_chamados',
      query(
        chamadosRef,
        where('organizacaoId', '==', state.profile.organizacaoId),
        where('solicitantesIds', 'array-contains', state.user.uid),
        where('status', 'in', ALL_TICKET_STATUSES),
        limit(200)
      )
    )
  ];
}

function clearSearchBucket() {
  if (state.searchTimer) {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = null;
  }

  if (state.ticketBuckets.busca_remota) {
    delete state.ticketBuckets.busca_remota;
    mergeTicketBuckets();
  } else {
    renderTickets();
  }
}

function clearFilterBucket(shouldMerge = true) {
  if (state.filterTimer) {
    window.clearTimeout(state.filterTimer);
    state.filterTimer = null;
  }

  if (state.ticketBuckets.filtro_remoto) {
    delete state.ticketBuckets.filtro_remoto;
    if (shouldMerge) mergeTicketBuckets();
  } else if (shouldMerge) {
    renderTickets();
  }
}

function selectedStatusValue() {
  return els.statusFilter?.value || 'ativos';
}

function selectedTypeValuesForQuery() {
  const values = selectedValues(els.ticketTypeFilter, 'todos');
  if (values.includes('todos')) return [];
  return values.filter((type) => TICKET_TYPE_LABELS[type]);
}

function selectedOrgValuesForQuery() {
  if (!isOperatorOrAdmin()) {
    return state.profile?.organizacaoId ? [state.profile.organizacaoId] : [];
  }

  const selected = selectedValues(els.orgFilter, 'todas');
  if (!selected.includes('todas')) return selected.filter(Boolean);
  return [];
}

function dateFilterValues() {
  return {
    startValue: els.mainDateStart?.value || '',
    endValue: els.mainDateEnd?.value || ''
  };
}

function hasMainDateFilter() {
  const dates = dateFilterValues();
  return !!(dates.startValue || dates.endValue);
}

function localDateStartDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function localDateEndDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function ticketMatchesMainDateFilter(ticket) {
  const searchRaw = normalizeKey(els.searchInput?.value || '');
  if (searchRaw.length >= 3) return true;

  const selectedStatus = selectedStatusValue();
  const ticketStatus = ticket?.status || 'aberto';

  // A data padrão é para consulta/histórico. A fila ativa precisa aparecer inteira,
  // mesmo quando o chamado foi aberto em outro dia.
  if (isActivePanelStatus(selectedStatus)) return true;
  if (selectedStatus === 'todos' && ['aberto', 'reaberto', 'em_tratamento'].includes(ticketStatus)) return true;

  if (!hasMainDateFilter()) return true;
  const dates = dateFilterValues();
  const start = dates.startValue ? localDateStart(dates.startValue) : null;
  const end = dates.endValue ? localDateEnd(dates.endValue) : null;
  const ms = timestampMillis(ticket.criadoEm);
  if (!ms) return false;
  if (start != null && ms < start) return false;
  if (end != null && ms > end) return false;
  return true;
}

function remoteFilterStatuses() {
  const status = selectedStatusValue();

  if (status === 'todos') return ['finalizado', 'informacoes_divergentes', 'devolver_recusar'];
  if (isClosedStatus(status)) return [status];

  // Status ativos/aberto/reaberto/em_tratamento vêm dos listeners leves.
  return [];
}

function isClosedStatus(status) {
  return ['finalizado', 'informacoes_divergentes', 'devolver_recusar'].includes(status);
}

function isActivePanelStatus(status) {
  return ['ativos', 'aberto', 'reaberto', 'em_tratamento'].includes(status || 'ativos');
}

function needsRemoteFilterQuery() {
  const status = selectedStatusValue();

  // A fila ativa fica sempre carregada pelo listener leve.
  // A data padrão "hoje" não deve esconder chamados abertos/reabertos/em tratamento antigos.
  if (isActivePanelStatus(status)) return false;

  // "Todos" = fila ativa já carregada + fechados do período selecionado.
  // Status fechado = consulta remota somente daquele status/período.
  return status === 'todos' || isClosedStatus(status);
}

function buildRemoteFilterQueries() {
  const chamadosRef = collection(db, 'chamados');
  const statuses = remoteFilterStatuses();
  const typeValues = selectedTypeValuesForQuery();
  const orgValues = selectedOrgValuesForQuery();
  ensureMainDates();
  const dates = dateFilterValues();
  const startDate = localDateStartDate(dates.startValue);
  const endDate = localDateEndDate(dates.endValue);
  const queries = [];
  const maxQueries = 40;

  const effectiveOrgValues = !isOperatorOrAdmin()
    ? (state.profile?.organizacaoId ? [state.profile.organizacaoId] : [])
    : (orgValues.length ? orgValues : [null]);

  const effectiveTypeValues = typeValues.length ? typeValues : [null];

  for (const status of statuses) {
    for (const orgId of effectiveOrgValues) {
      for (const tipoChamado of effectiveTypeValues) {
        if (queries.length >= maxQueries) return queries;

        const parts = [chamadosRef];
        parts.push(where('status', '==', status));

        if (orgId) parts.push(where('organizacaoId', '==', orgId));
        if (tipoChamado) parts.push(where('tipoChamado', '==', tipoChamado));

        // Pesquisa por data de abertura: usa criadoEm, assim não baixa tudo para filtrar no navegador.
        if (startDate) parts.push(where('criadoEm', '>=', startDate));
        if (endDate) parts.push(where('criadoEm', '<=', endDate));

        parts.push(limit(hasMainDateFilter() ? 300 : 120));
        queries.push(query(...parts));
      }
    }
  }

  return queries;
}

async function runRemoteFilterQuery() {
  const token = ++state.filterToken;

  if (!needsRemoteFilterQuery()) {
    clearFilterBucket(false);
    renderTickets();
    setText(els.liveStatus, 'Ao vivo');
    return;
  }

  const remoteQueries = buildRemoteFilterQueries();
  if (!remoteQueries.length) {
    clearFilterBucket(false);
    renderTickets();
    setText(els.liveStatus, 'Ao vivo');
    return;
  }

  setText(els.liveStatus, 'Filtrando...');

  try {
    const found = new Map();
    for (const q of remoteQueries) {
      if (token !== state.filterToken) return;
      const snapshot = await getDocs(q);
      snapshot.docs.forEach((d) => {
        found.set(d.id, { id: d.id, ...d.data() });
      });
    }

    if (token !== state.filterToken) return;
    state.ticketBuckets.filtro_remoto = [...found.values()];
    mergeTicketBuckets();
    setText(els.liveStatus, found.size ? `Filtro: ${found.size} encontrado(s)` : 'Ao vivo');
  } catch (error) {
    if (token !== state.filterToken) return;
    console.error('Erro no filtro remoto:', error);
    setText(els.liveStatus, 'Erro no filtro');
    if (String(error?.message || '').includes('requires an index')) {
      showToast('O Firestore pediu um índice para esse filtro. Publique o arquivo firestore.indexes.json do pacote v20 ou clique no link do erro no console para criar o índice sugerido.', 'error');
      return;
    }
    showToast(`Erro ao filtrar chamados: ${error.message}`, 'error');
  }
}

function scheduleRemoteFilterQuery() {
  if (state.filterTimer) window.clearTimeout(state.filterTimer);
  state.filterTimer = window.setTimeout(runRemoteFilterQuery, 350);
}

function ticketTypeSearchValues() {
  const selected = selectedValues(els.ticketTypeFilter, 'todos');
  if (!selected.includes('todos')) {
    return selected.filter((type) => TICKET_TYPE_LABELS[type]);
  }

  // Inclui o tipo legado "nota_fiscal" porque versões antigas podem ter gravado a chaveBusca assim.
  return [...Object.keys(TICKET_TYPE_LABELS), 'nota_fiscal'];
}

function orgSearchValues() {
  if (!isOperatorOrAdmin()) {
    return state.profile?.organizacaoId ? [state.profile.organizacaoId] : [];
  }

  const selected = selectedValues(els.orgFilter, 'todas');
  if (!selected.includes('todas')) {
    return selected.filter(Boolean);
  }

  return state.orgs
    .filter((org) => org && org.id && org.ativa !== false)
    .map((org) => org.id);
}

function searchCandidateValues(raw) {
  const value = keySearchValue(raw);
  if (!value || value.length < 3) return [];

  return ticketTypeSearchValues().map((type) => ({
    type,
    chaveBusca: `${type}:${value}`
  }));
}

async function runRemoteTicketSearch(raw) {
  const token = ++state.searchToken;
  const searchRaw = normalizeKey(raw);

  if (!searchRaw || searchRaw.length < 3) {
    clearSearchBucket();
    setText(els.liveStatus, 'Ao vivo');
    return;
  }

  const orgIds = orgSearchValues();
  const candidates = searchCandidateValues(searchRaw).map((item) => item.chaveBusca);

  if (!candidates.length) {
    clearSearchBucket();
    setText(els.liveStatus, 'Ao vivo');
    return;
  }

  setText(els.liveStatus, 'Buscando...');

  try {
    const found = new Map();
    const chamadosRef = collection(db, 'chamados');
    const chaveChunks = [];
    for (let i = 0; i < candidates.length; i += 10) chaveChunks.push(candidates.slice(i, i + 10));

    const effectiveOrgIds = !isOperatorOrAdmin()
      ? (state.profile?.organizacaoId ? [state.profile.organizacaoId] : [])
      : (orgIds.length ? orgIds : [null]);

    for (const orgId of effectiveOrgIds) {
      for (const chunk of chaveChunks) {
        if (token !== state.searchToken) return;
        const parts = [chamadosRef, where('chaveBusca', 'in', chunk), limit(20)];
        if (orgId) parts.splice(1, 0, where('organizacaoId', '==', orgId));
        const snapshot = await getDocs(query(...parts));
        snapshot.docs.forEach((d) => found.set(d.id, { id: d.id, ...d.data() }));
      }
    }

    if (token !== state.searchToken) return;
    state.ticketBuckets.busca_remota = [...found.values()];
    mergeTicketBuckets();
    setText(els.liveStatus, found.size ? `Busca: ${found.size} encontrado(s)` : 'Ao vivo');
  } catch (error) {
    if (token !== state.searchToken) return;
    console.error('Erro na busca remota:', error);
    setText(els.liveStatus, 'Erro na busca');
    if (String(error?.message || '').includes('requires an index')) {
      showToast('O Firestore pediu um índice para a busca. Publique o firestore.indexes.json atualizado do pacote v21.', 'error');
      return;
    }
    showToast(`Erro ao pesquisar chamados: ${error.message}`, 'error');
  }
}

function refreshQueryBackedFilters() {
  scheduleRemoteFilterQuery();

  const searchRaw = normalizeKey(els.searchInput.value);
  if (state.searchTimer) window.clearTimeout(state.searchTimer);

  if (!searchRaw || searchRaw.length < 3) {
    if (state.ticketBuckets.busca_remota) delete state.ticketBuckets.busca_remota;
    renderTickets();
    return;
  }

  state.searchTimer = window.setTimeout(() => {
    runRemoteTicketSearch(searchRaw);
  }, 450);
}

function scheduleRemoteTicketSearch() {
  renderTickets();
  refreshQueryBackedFilters();
}

function renderAndRefreshSearch() {
  renderTickets();
  refreshQueryBackedFilters();
}


function filteredTickets() {
  const searchRaw = normalizeKey(els.searchInput.value);
  const search = searchRaw.toLowerCase();
  const searchDigits = digitsOnly(searchRaw);
  const status = els.statusFilter.value || 'ativos';
  const typeValues = selectedValues(els.ticketTypeFilter, 'todos');
  const orgValues = selectedValues(els.orgFilter, 'todas');
  const allTypes = typeValues.includes('todos');
  const allOrgs = orgValues.includes('todas');

  let tickets = state.tickets.filter((ticket) => {
    const ticketStatus = ticket.status || 'aberto';
    const ticketTipo = ticket.tipoChamado || 'nota_fiscal';

    if (status === 'ativos' && !ACTIVE_STATUSES.includes(ticketStatus)) return false;
    if (status !== 'todos' && status !== 'ativos' && ticketStatus !== status) return false;

    // Operadores só acompanham os próprios tratamentos na fila operacional.
    // Evita que consultas de busca/filtros tragam reservas de outras pessoas.
    if (isOperator() && ticketStatus === 'em_tratamento' && ticket.operadorTratamentoId !== state.user?.uid) return false;

    if (!allTypes && !typeValues.includes(ticketTipo)) return false;

    if (isOperatorOrAdmin() && !allOrgs && !orgValues.includes(ticket.organizacaoId)) {
      return false;
    }

    if (!isOperatorOrAdmin() && ticket.organizacaoId !== state.profile?.organizacaoId) {
      return false;
    }

    if (!ticketMatchesMainDateFilter(ticket)) return false;

    if (search) {
      const chave = String(ticket.chave || '').toLowerCase();
      const codigo = String(ticket.codigoProduto || '').toLowerCase();
      const chaveDigits = digitsOnly(chave);
      const title = ticketTitle(ticket).toLowerCase();
      const typeLabel = ticketTypeLabel(ticketTipo).toLowerCase();
      const matchText = chave.includes(search) || codigo.includes(search) || title.includes(search) || typeLabel.includes(search);
      const matchDigits = searchDigits && (chaveDigits.includes(searchDigits) || digitsOnly(codigo).includes(searchDigits));
      if (!matchText && !matchDigits) return false;
    }

    return true;
  });

  if (!isOperatorOrAdmin() && status === 'ativos' && !search && !hasMainDateFilter()) {
    tickets = tickets.slice(0, 20);
  }

  return sortTicketsForDisplay(tickets);
}



function ticketTableRowHtml(ticket) {
  const status = ticket.status || 'aberto';
  const unread = state.notifications.some((n) => n.ticketId === ticket.id && !n.lida);
  const reservedByMe = status === 'em_tratamento' && ticket.operadorTratamentoId === state.user?.uid;
  const reserveText = status === 'em_tratamento'
    ? `<strong>${escapeHtml(ticket.operadorTratamentoNome || 'Em tratamento')}</strong><small class="muted">${reservedByMe ? 'Reservado por você' : 'Responsável'}</small>`
    : `<span class="muted">—</span><small class="muted">Disponível</small>`;
  const title = escapeHtml(ticketTitle(ticket));
  const reference = escapeHtml(ticketRawLine(ticket));
  return `
    <td><span class="table-status-cell">${statusBadge(status)}</span></td>
    <td class="table-reserve">${reserveText}</td>
    <td><strong class="table-main">${title}</strong><small class="table-kicker" title="${reference}">${reference}</small></td>
    <td><strong class="table-type">${escapeHtml(ticketTypeLabel(ticket.tipoChamado || 'nota_fiscal'))}</strong></td>
    <td>${orgChipHtml(ticket.organizacaoNome)}</td>
    <td><strong class="table-person">${escapeHtml(ticket.criadoPorNome || ticket.criadoPorEmail || '—')}</strong></td>
    <td><span class="table-date">${escapeHtml(formatDate(ticket.criadoEm))}</span><small class="table-kicker">${escapeHtml(ticketQueueLabel(ticket))}</small></td>
    <td class="table-actions">
      ${reserveButtonHtml(ticket)}
      <button class="btn ghost table-open-btn" type="button" data-open-ticket-id="${escapeHtml(ticket.id)}">Abrir</button>
    </td>
  `;
}

function renderTickets() {
  const tickets = filteredTickets();
  const counts = tickets.reduce((acc, ticket) => {
    acc[ticket.status || 'aberto'] = (acc[ticket.status || 'aberto'] || 0) + 1;
    return acc;
  }, {});

  setText(els.countAberto, counts.aberto || 0);
  setText(els.countReaberto, counts.reaberto || 0);
  setText(els.countTratamento, counts.em_tratamento || 0);
  setText(els.countInformacoesDivergentes, counts.informacoes_divergentes || 0);
  setText(els.countDevolverRecusar, counts.devolver_recusar || 0);
  setText(els.countFinalizado, counts.finalizado || 0);
  setText(els.countTotal, tickets.length);
  updateBrowserTitleAlert();

  const body = els.ticketList;
  if (!body) return;

  if (!tickets.length) {
    body.innerHTML = '<tr class="empty-table-row"><td colspan="8">Nenhum chamado encontrado para os filtros selecionados.</td></tr>';
  } else {
    body.querySelector('.empty-table-row')?.remove();
    const wanted = new Set(tickets.map((ticket) => ticket.id));
    body.querySelectorAll('tr[data-ticket-id]').forEach((row) => {
      if (!wanted.has(row.dataset.ticketId)) row.remove();
    });
    // Mantém o mesmo elemento <tr> para mudanças de status; apenas conteúdo mutável é atualizado.
    const byId = new Map([...body.querySelectorAll('tr[data-ticket-id]')].map((row) => [row.dataset.ticketId, row]));
    tickets.forEach((ticket, i) => {
      let row = byId.get(ticket.id);
      const isNew = !row;
      if (isNew) {
        row = document.createElement('tr');
        row.dataset.ticketId = ticket.id;
        row.tabIndex = 0;
      }
      const selected = ticket.id === state.selectedTicketId;
      const unread = state.notifications.some((n) => n.ticketId === ticket.id && !n.lida);
      row.className = `xabuia-table-row ${selected ? 'selected' : ''} ${unread ? 'xabuia-unread-ticket' : ''}`;
      const signature = JSON.stringify([
        ticket.status, ticket.tipoChamado, ticket.chave, ticket.codigoProduto,
        ticket.organizacaoNome, ticket.criadoPorNome, ticket.criadoPorEmail,
        ticket.operadorTratamentoId, ticket.operadorTratamentoNome,
        timestampMillis(ticket.criadoEm), timestampMillis(ticket.atualizadoEm),
        timestampMillis(ticket.reabertoEm), timestampMillis(ticket.tratamentoIniciadoEm), unread
      ]);
      if (isNew || row.dataset.signature !== signature) {
        row.innerHTML = ticketTableRowHtml(ticket);
        row.dataset.signature = signature;
      }
      if (body.children[i] !== row) body.insertBefore(row, body.children[i] || null);
    });
  }

  const selected = state.tickets.find((t) => t.id === state.selectedTicketId);
  const detailDialog = $('ticketDetailDialog');
  if (detailDialog?.open && selected) {
    const liveStatus = $('detailLiveStatus');
    if (liveStatus) liveStatus.innerHTML = statusBadge(selected.status);
    // Não reconstruir o painel: preserva a resposta que o operador está digitando.
  }
  if (state.selectedTicketId && !selected) {
    state.selectedTicketId = null;
    state.historyLoadedFor = null;
    if (detailDialog?.open) detailDialog.close();
  }
}

async function selectTicket(ticketId) {
  const ticket = state.tickets.find((t) => t.id === ticketId);
  if (!ticket) return showToast('Chamado não está disponível na lista atual.', 'error');
  state.selectedTicketId = ticketId;
  state.historyLoadedFor = null;
  renderTickets();
  const dialog = $('ticketDetailDialog');
  if (dialog && !dialog.open) dialog.showModal();
  const title = $('detailModalTitle');
  if (title) title.textContent = ticketTitle(ticket);
  const statusBox = $('detailLiveStatus');
  if (statusBox) statusBox.innerHTML = statusBadge(ticket.status);
  await renderTicketDetail(ticket);
}


async function renderTicketDetail(ticket) {
  if (!ticket) {
    els.ticketDetail.className = 'card detail-card empty';
    els.ticketDetail.innerHTML = `
      <h2>Selecione um chamado</h2>
      <p class="muted">Clique em um chamado para ver a nota, a ocorrência inicial e adicionar novas observações.</p>
    `;
    return;
  }

  const tipo = ticket.tipoChamado || 'nota_fiscal';
  const status = ticket.status || 'aberto';
  const assignedLine = ticket.status === 'em_tratamento' && ticket.operadorTratamentoNome
    ? `<span class="detail-assigned-chip">Tratando: <strong>${escapeHtml(ticket.operadorTratamentoNome)}</strong></span>`
    : '';

  els.ticketDetail.className = 'card detail-card detail-card-v30';
  els.ticketDetail.innerHTML = `
    <section class="detail-summary-panel detail-summary-panel-v30 ticket-framed ticket-status-${escapeHtml(status)}">
      <div class="ticket-type-legend detail-type-legend">${escapeHtml(ticketTypeLabel(tipo))}</div>

      <div class="detail-frame-top-v30">
        <div class="detail-summary-meta detail-summary-meta-v30">
          ${orgChipHtml(ticket.organizacaoNome, 'org-chip-detail')}
          <span>Atualizado ${formatDate(ticket.atualizadoEm)}</span>
          ${assignedLine}
          <span class="queue-age detail-queue-age">${escapeHtml(ticketQueueLabel(ticket))}</span>
        </div>
        ${statusBadge(status)}
      </div>

      <div class="detail-frame-grid-v30">
        <div class="detail-facts-card-v30">
          ${renderTicketDetailFacts(ticket)}
        </div>

        <div id="openingSummaryBox" class="opening-summary opening-summary-v30 opening-summary-loading">
          Carregando ocorrência inicial...
        </div>
      </div>
    </section>

    <section id="ticketAttachmentsPanel" class="ticket-attachments-panel">
      <div class="empty-state">Carregando anexos do chamado...</div>
    </section>

    <div class="occurrence-panel">
      ${isOperatorOrAdmin() ? `
        <div class="occurrence-toolbar">
          <label class="field compact status-field">
            <span>Status</span>
            <select id="detailStatusSelect">
              <option value="aberto">Aberto</option>
              <option value="reaberto">Reaberto</option>
              <option value="em_tratamento">Em tratamento</option>
              <option value="informacoes_divergentes">Informações divergentes</option>
              <option value="devolver_recusar">Devolver e recusar</option>
              <option value="finalizado">Finalizado</option>
            </select>
          </label>
          ${CLOSED_STATUSES.includes(ticket.status) ? `<button id="reopenTicketBtn" class="btn ghost" type="button">Reabrir chamado</button>` : ''}
        </div>
      ` : CLOSED_STATUSES.includes(ticket.status) ? `<div class="occurrence-toolbar"><button id="reopenTicketBtn" class="btn ghost" type="button">Reabrir chamado</button></div>` : ''}

      <label class="field occurrence-textarea">
        <span>Nova ocorrência</span>
        <textarea id="newHistoryText" rows="4" placeholder="Digite uma nova ocorrência. Se colar uma tabela do Excel, ela aparecerá formatada no histórico."></textarea>
      </label>

      <div class="history-attachment">
        <input id="historyFileInput" class="hidden-file" type="file" accept="image/*,.pdf,.txt,.csv,.xml,.xlsx,.xls" multiple />
        <div id="historyPasteZone" class="paste-zone paste-zone-small" tabindex="0" role="button" aria-label="Adicionar anexo na ocorrência">
          <div class="paste-empty">
            <strong>Anexo da ocorrência</strong>
            <small>Arraste, solte ou clique para anexar. Máximo 5 arquivos por vez.</small>
          </div>
          <div id="historyPastePreview" class="paste-preview hidden"></div>
        </div>
        <button id="clearHistoryFileBtn" class="btn ghost hidden" type="button">Remover anexo</button>
      </div>

      <div class="occurrence-actions">
        <button id="addHistoryBtn" class="btn primary compact-add" type="button">Adicionar</button>
      </div>
    </div>

    <h3>Linha do tempo do chamado</h3>
    <div id="unifiedTimelineList" class="history unified-timeline"><div class="empty-state">Carregando linha do tempo...</div></div>
  `;

  if (isOperatorOrAdmin()) {
    const select = $('detailStatusSelect');
    select.value = ticket.status || 'aberto';
  }

  const reopenButton = $('reopenTicketBtn');
  if (reopenButton) reopenButton.addEventListener('click', () => reopenTicket(ticket, 'Chamado reaberto manualmente.'));

  clearHistoryAttachment();
  setupHistoryPasteZone();
  $('addHistoryBtn').addEventListener('click', () => addHistory(ticket));
  if (state.historyLoadedFor !== ticket.id) {
    await loadUnifiedTimeline(ticket.id);
    state.historyLoadedFor = ticket.id;
  }
}

function timelineEventLabel(item) {
  const status = STATUS_LABELS[item.status] || item.status || 'Status';
  const anterior = STATUS_LABELS[item.statusAnterior] || item.statusAnterior || '';
  const novo = STATUS_LABELS[item.statusNovo] || item.statusNovo || '';

  if (item.tipoEvento === 'entrada_status') return `Entrou em ${status}`;
  if (item.tipoEvento === 'saida_status') return `Saiu de ${status}`;
  if (anterior && novo) return `Mudou de ${anterior} para ${novo}`;
  return `Status: ${status}`;
}

async function loadStatusTimeline(ticketId) {
  const timelineList = $('statusTimelineList');
  if (!timelineList) return;

  try {
    const q = query(collection(db, 'chamados', ticketId, 'status_eventos'), orderBy('criadoEm', 'asc'), limit(HISTORY_LIMIT));
    const snapshot = await getDocs(q);
    const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (!items.length) {
      timelineList.innerHTML = '<div class="empty-state">Ainda não há linha do tempo gravada para este chamado. Eventos novos aparecerão daqui em diante.</div>';
      return;
    }

    timelineList.innerHTML = items.map((item) => `
      <div class="history-item">
        <div class="history-item-head">
          <strong>${escapeHtml(item.usuarioNome || item.usuarioEmail || 'Sistema')}</strong>
          ${statusBadge(item.status)}
        </div>
        <div class="history-text">
          <strong>${escapeHtml(timelineEventLabel(item))}</strong>
          ${item.contabilizaTempo && item.duracaoMin != null ? `<br><small>Tempo no status: ${escapeHtml(formatMinutes(Number(item.duracaoMin)))}</small>` : ''}
          ${item.texto ? `<br>${escapeHtml(item.texto)}` : ''}
        </div>
        <small>${formatDate(item.criadoEm)}</small>
      </div>
    `).join('');
  } catch (error) {
    console.warn('Não foi possível carregar status_eventos:', error);
    timelineList.innerHTML = '<div class="empty-state">Não consegui carregar a linha do tempo de status. Confira se o firestore.rules V27 foi publicado.</div>';
  }
}


async function loadHistory(ticketId) {
  const historyList = $('historyList');
  if (!historyList) return;

  const q = query(collection(db, 'chamados', ticketId, 'historico'), orderBy('criadoEm', 'asc'), limit(HISTORY_LIMIT));
  const snapshot = await getDocs(q);
  const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (!items.length) {
    historyList.innerHTML = '<div class="empty-state">Nenhuma observação registrada.</div>';
    return;
  }

  historyList.innerHTML = items.map((item) => `
    <div class="history-item">
      <div class="history-item-head">
        <strong>${escapeHtml(item.usuarioNome || item.usuarioEmail || 'Sistema')}</strong>
        ${historyTypeBadge(item.tipo)}
      </div>
      ${renderTextContent(item.texto)}
      ${renderAttachmentLinks(item.anexo, 'Abrir anexo')}
      <small>${formatDate(item.criadoEm)}</small>
    </div>
  `).join('');
}


function timelineEventIcon(item) {
  const type = item?.tipo || item?.tipoEvento || item?.status || '';
  if (String(type).includes('criacao')) return '＋';
  if (String(type).includes('reab')) return '↻';
  if (String(type).includes('trat') || item?.status === 'em_tratamento') return '⏱';
  if (String(type).includes('final')) return '✓';
  if (String(type).includes('diverg') || String(type).includes('devolver')) return '!';
  if (item?.source === 'status') return '•';
  if (hasAttachment(item?.anexo)) return '📎';
  return '✎';
}


function normalizeTimelineHistoryItem(item) {
  return {
    ...item,
    source: 'historico',
    sortAt: timestampMillis(item.criadoEm),
    title: historyTypeLabel(item.tipo),
    cssType: String(item.tipo || 'observacao').replace(/[^a-z0-9_-]/gi, '_')
  };
}

function normalizeTimelineStatusItem(item) {
  return {
    ...item,
    source: 'status',
    sortAt: timestampMillis(item.criadoEm),
    title: timelineEventLabel(item),
    cssType: String(item.status || item.tipoEvento || 'status').replace(/[^a-z0-9_-]/gi, '_')
  };
}

function timelineSameUser(a, b) {
  const aId = a?.usuarioId || a?.operadorId || '';
  const bId = b?.usuarioId || b?.operadorId || '';
  if (aId && bId && aId === bId) return true;

  const aName = normalizeKey(a?.usuarioNome || a?.operadorNome || a?.usuarioEmail || a?.operadorEmail || '').toLowerCase();
  const bName = normalizeKey(b?.usuarioNome || b?.operadorNome || b?.usuarioEmail || b?.operadorEmail || '').toLowerCase();
  return Boolean(aName && bName && aName === bName);
}

function timelineSameText(a, b) {
  const aText = normalizeKey(a?.texto || '').toLowerCase();
  const bText = normalizeKey(b?.texto || '').toLowerCase();
  if (!aText || !bText) return false;
  return aText === bText || aText.includes(bText) || bText.includes(aText);
}

function shouldMergeStatusIntoHistory(history, status) {
  if (!history || !status) return false;
  const diff = Math.abs((history.sortAt || 0) - (status.sortAt || 0));
  if (diff > 120000) return false;
  if (timelineSameText(history, status)) return true;
  return diff <= 120000 && timelineSameUser(history, status);
}

function shouldMergeStatusGroup(group, status) {
  if (!group?.statusEvents?.length || !status) return false;
  const base = group.statusEvents[0];
  const diff = Math.abs((group.sortAt || 0) - (status.sortAt || 0));
  if (diff > 120000) return false;
  if (timelineSameText(base, status)) return true;
  return timelineSameUser(base, status) && diff <= 120000;
}

function createHistoryTimelineGroup(history) {
  return {
    id: `historico-${history.id}`,
    source: 'historico',
    history,
    primary: history,
    statusEvents: [],
    sortAt: history.sortAt || 0,
    cssType: history.cssType || 'observacao'
  };
}

function createStatusTimelineGroup(status) {
  return {
    id: `status-${status.id}`,
    source: 'status',
    history: null,
    primary: status,
    statusEvents: [status],
    sortAt: status.sortAt || 0,
    cssType: status.cssType || 'status'
  };
}

function buildUnifiedTimelineGroups(historyItems, statusItems) {
  const groups = historyItems.map(createHistoryTimelineGroup);
  const statusOnlyGroups = [];

  statusItems.forEach((status) => {
    const historyGroup = groups.find((group) => shouldMergeStatusIntoHistory(group.history, status));
    if (historyGroup) {
      historyGroup.statusEvents.push(status);
      historyGroup.sortAt = Math.max(historyGroup.sortAt || 0, status.sortAt || 0);
      if (status.status) historyGroup.lastStatus = status.status;
      return;
    }

    const existingStatusGroup = statusOnlyGroups.find((group) => shouldMergeStatusGroup(group, status));
    if (existingStatusGroup) {
      existingStatusGroup.statusEvents.push(status);
      existingStatusGroup.sortAt = Math.max(existingStatusGroup.sortAt || 0, status.sortAt || 0);
      existingStatusGroup.lastStatus = status.status || existingStatusGroup.lastStatus;
      return;
    }

    statusOnlyGroups.push(createStatusTimelineGroup(status));
  });

  return [...groups, ...statusOnlyGroups]
    .filter((group) => group.sortAt || group.primary?.criadoEm)
    .sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0));
}

function timelineGroupTitle(group) {
  const history = group.history;
  const statuses = group.statusEvents || [];
  const hasTreatment = statuses.some((item) => item.status === 'em_tratamento' || item.statusNovo === 'em_tratamento');
  const hasReopen = statuses.some((item) => item.status === 'reaberto' || item.statusNovo === 'reaberto');
  const hasFinal = statuses.some((item) => item.status === 'finalizado' || item.statusNovo === 'finalizado');
  const text = normalizeKey(history?.texto || statuses.map((item) => item.texto || '').find(Boolean) || '').toLowerCase();

  if (history?.tipo === 'criacao') return 'Criação do chamado';
  if (hasTreatment && text.includes('reservado')) return 'Reserva do chamado';
  if (hasTreatment && history) return 'Tratativa / Em tratamento';
  if (hasReopen && history) return 'Reabertura do chamado';
  if (hasFinal && history) return 'Finalização do chamado';
  if (history) return history.title || historyTypeLabel(history.tipo);
  if (statuses.length > 1) return 'Mudança de status';
  return statuses[0]?.title || 'Status';
}

function timelineGroupBadge(group) {
  if (group.history) return historyTypeBadge(group.history.tipo);
  const last = [...(group.statusEvents || [])].sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0))[0];
  return statusBadge(last?.status || last?.statusNovo || 'aberto');
}

function timelineGroupIcon(group) {
  if (group.history?.tipo === 'criacao') return '＋';
  if ((group.statusEvents || []).some((item) => item.status === 'em_tratamento' || item.statusNovo === 'em_tratamento')) return '⏱';
  if ((group.statusEvents || []).some((item) => item.status === 'reaberto' || item.statusNovo === 'reaberto')) return '↻';
  if ((group.statusEvents || []).some((item) => item.status === 'finalizado' || item.statusNovo === 'finalizado')) return '✓';
  if (group.history) return timelineEventIcon(group.history);
  return timelineEventIcon(group.primary);
}

function uniqueStatusEvents(events = []) {
  const seen = new Set();
  return [...events]
    .sort((a, b) => (a.sortAt || 0) - (b.sortAt || 0))
    .filter((item) => {
      const key = `${item.tipoEvento || ''}|${item.status || ''}|${item.statusAnterior || ''}|${item.statusNovo || ''}|${item.duracaoMin ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function renderTimelineStatusFlow(group) {
  const events = uniqueStatusEvents(group.statusEvents || []);
  if (!events.length) return '';

  return `
    <div class="timeline-status-flow">
      ${events.map((item) => `
        <div class="timeline-status-line">
          <span>${escapeHtml(timelineEventLabel(item))}</span>
          ${item.contabilizaTempo && item.duracaoMin != null ? `<small>Tempo no status: ${escapeHtml(formatMinutes(Number(item.duracaoMin)))}</small>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderUnifiedTimelineGroup(group) {
  const history = group.history;
  const user = history?.usuarioNome || history?.usuarioEmail || group.primary?.usuarioNome || group.primary?.usuarioEmail || 'Sistema';
  const text = history
    ? renderTextContent(history.texto || '')
    : (() => {
        const statusText = uniqueStatusEvents(group.statusEvents || []).map((item) => normalizeKey(item.texto || '')).find(Boolean);
        return statusText ? `<div class="history-text">${escapeHtml(statusText)}</div>` : '';
      })();
  const anexo = history?.anexo || null;
  const sourceClass = history ? 'historico' : 'status';
  const cssType = history?.cssType || group.cssType || 'status';

  return `
    <div class="timeline-item timeline-${escapeHtml(sourceClass)} timeline-type-${escapeHtml(cssType)}">
      <div class="timeline-marker">${escapeHtml(timelineGroupIcon(group))}</div>
      <div class="timeline-card timeline-card-grouped">
        <div class="history-item-head timeline-head">
          <div>
            <strong>${escapeHtml(timelineGroupTitle(group))}</strong>
            <small>${escapeHtml(user)}</small>
          </div>
          ${timelineGroupBadge(group)}
        </div>
        ${text}
        ${renderTimelineStatusFlow(group)}
        <small class="timeline-date">${formatDate(group.primary?.criadoEm || history?.criadoEm)}</small>
      </div>
    </div>
  `;
}

function findOpeningHistoryItem(historyItems = []) {
  const ordered = [...historyItems].sort((a, b) => (a.sortAt || 0) - (b.sortAt || 0));
  return ordered.find((item) => item.tipo === 'criacao' && normalizeKey(item.texto || ''))
    || ordered.find((item) => normalizeKey(item.texto || ''))
    || null;
}


function renderOpeningSummary(opening) {
  const box = $('openingSummaryBox');
  if (!box) return;

  if (!opening) {
    box.className = 'opening-summary opening-summary-v30 opening-summary-empty';
    box.innerHTML = `
      <div class="opening-summary-head">
        <strong>Ocorrência inicial</strong>
      </div>
      <div class="opening-summary-body muted">Sem texto de abertura encontrado.</div>
    `;
    return;
  }

  box.className = 'opening-summary opening-summary-v30';
  box.innerHTML = `
    <div class="opening-summary-head">
      <div>
        <strong>Ocorrência inicial</strong>
        <small>${escapeHtml(opening.usuarioNome || opening.usuarioEmail || 'Sistema')} • ${formatDate(opening.criadoEm)}</small>
      </div>
    </div>
    <div class="opening-summary-body">
      ${renderTextContent(opening.texto || '')}
    </div>
  `;
}

async function loadUnifiedTimeline(ticketId) {
  const timelineList = $('unifiedTimelineList');
  if (!timelineList) return;

  try {
    const [historySnapshot, statusSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'chamados', ticketId, 'historico'), orderBy('criadoEm', 'asc'), limit(HISTORY_LIMIT))),
      getDocs(query(collection(db, 'chamados', ticketId, 'status_eventos'), orderBy('criadoEm', 'asc'), limit(HISTORY_LIMIT))).catch((error) => {
        console.warn('Não foi possível carregar status_eventos:', error);
        return null;
      })
    ]);

    const historyItems = historySnapshot.docs.map((d) => normalizeTimelineHistoryItem({ id: d.id, ...d.data() }));
    const statusItems = statusSnapshot ? statusSnapshot.docs.map((d) => normalizeTimelineStatusItem({ id: d.id, ...d.data() })) : [];
    const groups = buildUnifiedTimelineGroups(historyItems, statusItems);
    const openingItem = findOpeningHistoryItem(historyItems);
    const timelineGroups = openingItem
      ? groups.filter((group) => group.history?.id !== openingItem.id)
      : groups;

    renderOpeningSummary(openingItem);
    const selectedTicket = state.tickets.find((item) => item.id === ticketId) || null;
    renderTicketAttachmentsPanel(selectedTicket, historyItems);

    if (!timelineGroups.length) {
      timelineList.innerHTML = '<div class="empty-state">Nenhuma outra movimentação registrada ainda.</div>';
      return;
    }

    timelineList.innerHTML = timelineGroups.map(renderUnifiedTimelineGroup).join('');
  } catch (error) {
    console.warn('Não foi possível carregar a linha do tempo unificada:', error);
    renderOpeningSummary(null);
    renderTicketAttachmentsPanel(state.tickets.find((item) => item.id === ticketId) || null, []);
    timelineList.innerHTML = '<div class="empty-state">Não consegui carregar a linha do tempo. Confira a conexão e as permissões.</div>';
  }
}

function historyTypeForStatusChange(status) {
  if (status === 'em_tratamento') return 'tratativa';
  if (status === 'reaberto') return 'reabertura';
  if (status === 'finalizado') return 'finalizado';
  if (status === 'informacoes_divergentes') return 'informacoes_divergentes';
  if (status === 'devolver_recusar') return 'devolver_recusar';
  return 'status';
}

async function addHistory(ticket) {
  const ticketId = typeof ticket === 'string' ? ticket : ticket?.id;
  const currentStatus = (typeof ticket === 'object' && ticket?.status) ? ticket.status : 'aberto';
  const selectedStatus = $('detailStatusSelect')?.value || currentStatus;
  const statusChanged = isOperatorOrAdmin() && selectedStatus !== currentStatus;

  const textarea = $('newHistoryText');
  let texto = normalizeKey(textarea.value);
  const files = getHistoryAttachmentFiles();

  if (!ticketId) return showToast('Chamado inválido.', 'error');

  if (statusChanged && selectedStatus === 'em_tratamento' && !texto) {
    texto = statusAutoOccurrenceText(selectedStatus);
  }

  if (statusChanged && selectedStatus !== 'em_tratamento' && !texto) {
    textarea.focus();
    return showToast('Digite uma nova ocorrência explicando a alteração de status.', 'error');
  }

  if (!texto && !files.length && !statusChanged) {
    return showToast('Digite a ocorrência ou anexe um arquivo antes de adicionar.', 'error');
  }

  const addButton = $('addHistoryBtn');
  if (addButton) {
    addButton.disabled = true;
    addButton.textContent = 'Salvando...';
  }

  try {
    const ticketRef = doc(db, 'chamados', ticketId);
    const { anexo, warning } = await tryUploadTicketFile(ticketId, files);
    const textoFinal = texto || `Anexo enviado: ${attachmentNamesFromFiles(files)}`;
    const historyType = statusChanged ? historyTypeForStatusChange(selectedStatus) : 'observacao';

    const updatePayload = {
      ...(statusChanged ? ticketStatusPayload(selectedStatus) : {}),
      ...lastOccurrencePayload(textoFinal, historyType, anexo),
      ...(anexo ? { anexo } : {})
    };

    let previousForEvents = ticket;
    if (statusChanged) {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ticketRef);
        if (!snap.exists()) throw new Error('Chamado não encontrado.');
        const current = { id: snap.id, ...snap.data() };
        const serverStatus = current.status || 'aberto';
        if (serverStatus !== currentStatus) {
          throw new Error('O status mudou em outra sessão. Feche e abra o chamado novamente.');
        }
        if (serverStatus === 'em_tratamento' && current.operadorTratamentoId &&
            current.operadorTratamentoId !== state.user?.uid && !isAdmin()) {
          throw new Error('Chamado reservado por outro operador.');
        }
        if (selectedStatus === 'em_tratamento' && !['aberto', 'reaberto', 'em_tratamento'].includes(serverStatus)) {
          throw new Error('Não é possível reservar um chamado encerrado.');
        }
        previousForEvents = current;
        transaction.update(ticketRef, updatePayload);
        transaction.set(doc(collection(db, 'chamados', ticketId, 'historico')), historyPayload(textoFinal, historyType, anexo ? { anexo } : {}));
      });
    } else {
      const batch = writeBatch(db);
      batch.update(ticketRef, updatePayload);
      batch.set(doc(collection(db, 'chamados', ticketId, 'historico')), historyPayload(textoFinal, historyType, anexo ? { anexo } : {}));
      await batch.commit();
    }

    let eventWarning = '';
    if (statusChanged && typeof ticket === 'object') {
      eventWarning = [
        await tryCommitStatusTimelineEvent(ticketRef, previousForEvents, selectedStatus, textoFinal, updatePayload),
        await tryCommitOperatorEvent(previousForEvents, selectedStatus, textoFinal)
      ].filter(Boolean).join(' ');
    }

    textarea.value = '';
    clearHistoryAttachment();
    state.historyLoadedFor = null;
    await loadUnifiedTimeline(ticketId);
    state.historyLoadedFor = ticketId;

    const finalWarning = [warning, eventWarning].filter(Boolean).join(' ');
    if (statusChanged) {
      showToast(finalWarning || `Status e ocorrência salvos: ${STATUS_LABELS[selectedStatus]}.`, finalWarning ? 'error' : 'success');
    } else {
      showToast(finalWarning || 'Ocorrência adicionada.', finalWarning ? 'error' : 'success');
    }
  } catch (error) {
    console.error('Erro ao salvar ocorrência completa:', error);
    const message = error?.code === 'permission-denied'
      ? 'Permissão negada pelo Firestore. Confira se as regras mais recentes foram publicadas e recarregue com Ctrl + F5.'
      : error.message;
    showToast(`Erro ao salvar ocorrência: ${message}`, 'error');
  } finally {
    if (addButton) {
      addButton.disabled = false;
      addButton.textContent = 'Adicionar';
    }
  }
}

async function addSystemHistory(ticketId, texto, tipo = 'status', extra = {}) {
  await addHistoryDoc(ticketId, texto, tipo, extra);
}

function fileExtension(name = '') {
  const clean = String(name || '').toLowerCase().split('?')[0].split('#')[0];
  const parts = clean.split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function attachmentContentType(file) {
  const ext = fileExtension(file?.name || '');
  return file?.type || ATTACHMENT_MIME_BY_EXT[ext] || 'application/octet-stream';
}

function isAllowedAttachmentFile(file) {
  if (!file) return false;
  const ext = fileExtension(file.name || '');
  const type = attachmentContentType(file);
  return ATTACHMENT_EXTENSIONS.has(ext) || type.startsWith('image/');
}

function validateAttachmentFile(file) {
  if (!file) return 'Arquivo inválido.';
  if (file.size > MAX_ATTACHMENT_SIZE) return `${file.name || 'arquivo'} ultrapassa 5 MB.`;
  if (!isAllowedAttachmentFile(file)) return `${file.name || 'arquivo'} não é um tipo permitido.`;
  return '';
}

function cleanStorageFileName(name = '') {
  const base = String(name || 'anexo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return base || `anexo-${Date.now()}`;
}

function normalizeFileArray(files) {
  return [...(files || [])].filter(Boolean);
}

function attachmentSummary(anexos = []) {
  const items = normalizeFileArray(anexos);
  if (!items.length) return null;

  if (items.length === 1) return items[0];

  const totalSize = items.reduce((sum, item) => sum + Number(item.tamanho || item.size || 0), 0);
  return {
    nome: `${items.length} anexos`,
    tipo: 'multi',
    tamanho: totalSize,
    path: items[0]?.path || '',
    url: items[0]?.url || '',
    arquivos: items
  };
}

function attachmentItems(anexo) {
  if (!anexo) return [];
  if (Array.isArray(anexo)) return anexo.filter(Boolean);
  if (Array.isArray(anexo.arquivos)) return anexo.arquivos.filter(Boolean);
  if (anexo.url || anexo.path || anexo.nome) return [anexo];
  return [];
}

function hasAttachment(anexo) {
  return attachmentItems(anexo).length > 0;
}

function renderAttachmentLinks(anexo, label = 'Abrir anexo') {
  const items = attachmentItems(anexo);
  if (!items.length) return '';

  return `
    <div class="attachment-links">
      ${items.map((item, index) => item?.url ? `
        <a class="attachment-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
          ${escapeHtml(items.length > 1 ? `${label} ${index + 1}:` : `${label}:`)} ${escapeHtml(item.nome || 'arquivo')}
        </a>
      ` : '').join('')}
    </div>
  `;
}
function formatAttachmentSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return '';
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function attachmentKindLabel(item = {}) {
  const type = String(item.tipo || '').toLowerCase();
  const name = String(item.nome || '').toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(name)) return 'IMG';
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'PDF';
  if (type.includes('sheet') || type.includes('excel') || /\.(xlsx|xls|csv)$/.test(name)) return 'XLS';
  if (type.includes('xml') || name.endsWith('.xml')) return 'XML';
  if (type.includes('text') || name.endsWith('.txt')) return 'TXT';
  return 'ARQ';
}

function attachmentEntryKey(item = {}) {
  return item.storagePath || item.path || item.url || `${item.nome || 'arquivo'}|${item.tamanho || 0}`;
}

function collectTicketAttachmentEntries(ticket, historyItems = []) {
  const entries = [];
  const seen = new Set();

  function pushAttachments(anexo, meta = {}) {
    attachmentItems(anexo).forEach((item) => {
      if (!item?.url) return;
      const key = attachmentEntryKey(item);
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({
        nome: item.nome || 'arquivo',
        tipo: item.tipo || '',
        tamanho: Number(item.tamanho || item.size || 0) || 0,
        url: item.url,
        path: item.storagePath || item.path || '',
        criadoEm: meta.criadoEm || item.criadoEm || null,
        usuarioNome: meta.usuarioNome || meta.usuarioEmail || '',
        origem: meta.origem || '',
        texto: meta.texto || ''
      });
    });
  }

  historyItems.forEach((item) => {
    pushAttachments(item.anexo, {
      criadoEm: item.criadoEm,
      usuarioNome: item.usuarioNome || item.usuarioEmail || 'Sistema',
      origem: historyTypeLabel(item.tipo),
      texto: item.texto || ''
    });
  });

  pushAttachments(ticket?.anexo, {
    criadoEm: ticket?.ultimaOcorrenciaEm || ticket?.atualizadoEm || ticket?.criadoEm || null,
    usuarioNome: ticket?.ultimaOcorrenciaUsuarioNome || ticket?.ultimaOcorrenciaUsuarioEmail || '',
    origem: 'Última ocorrência',
    texto: ticket?.ultimaOcorrenciaTexto || ''
  });

  return entries.sort((a, b) => timestampMillis(b.criadoEm) - timestampMillis(a.criadoEm));
}

function ensureTicketAttachmentsPanelStyles() {
  if (document.getElementById('ticketAttachmentsPanelStyles')) return;
  const style = document.createElement('style');
  style.id = 'ticketAttachmentsPanelStyles';
  style.textContent = [
    '.ticket-attachments-panel { margin: 14px 0; border: 1px solid #d9e2f2; border-radius: 16px; background: #fff; padding: 14px; }',
    '.ticket-attachments-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }',
    '.ticket-attachments-head strong { display: block; font-size: 16px; }',
    '.ticket-attachments-head small { color: #6b7280; }',
    '.ticket-attachments-badge { min-width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; padding: 0 10px; border-radius: 999px; background: #eef4ff; color: #2456d8; font-weight: 700; }',
    '.ticket-attachments-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }',
    '.ticket-attachment-card { display: flex; align-items: flex-start; gap: 10px; border: 1px solid #e4e9f3; border-radius: 14px; padding: 10px 12px; background: #fafcff; min-width: 0; }',
    '.ticket-attachment-icon { flex: 0 0 42px; height: 42px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; letter-spacing: .04em; background: #eef4ff; color: #2456d8; }',
    '.ticket-attachment-body { min-width: 0; flex: 1; }',
    '.ticket-attachment-name { font-weight: 700; color: #18202f; word-break: break-word; }',
    '.ticket-attachment-meta { margin-top: 4px; color: #6b7280; font-size: 12px; line-height: 1.4; }',
    '.ticket-attachment-actions { margin-top: 8px; }',
    '.ticket-attachment-actions a { font-weight: 700; text-decoration: none; }',
    '.ticket-attachments-more { margin-top: 10px; color: #6b7280; font-size: 12px; }'
  ].join(' ');
  document.head.appendChild(style);
}

function renderTicketAttachmentsPanel(ticket, historyItems = []) {
  const panel = $('ticketAttachmentsPanel');
  if (!panel) return;

  ensureTicketAttachmentsPanelStyles();

  const entries = collectTicketAttachmentEntries(ticket, historyItems);
  if (!entries.length) {
    panel.innerHTML = `
      <div class="ticket-attachments-head">
        <div>
          <strong>Anexos do chamado</strong>
          <small>Nenhum anexo enviado até agora.</small>
        </div>
        <span class="ticket-attachments-badge">0</span>
      </div>
    `;
    return;
  }

  const visible = entries.slice(0, MAX_ATTACHMENT_PANEL_ITEMS);
  const hiddenCount = Math.max(0, entries.length - visible.length);

  panel.innerHTML = `
    <div class="ticket-attachments-head">
      <div>
        <strong>Anexos do chamado</strong>
        <small>Todos os anexos reunidos em um lugar só.</small>
      </div>
      <span class="ticket-attachments-badge">${entries.length}</span>
    </div>
    <div class="ticket-attachments-grid">
      ${visible.map((item) => `
        <div class="ticket-attachment-card">
          <div class="ticket-attachment-icon">${escapeHtml(attachmentKindLabel(item))}</div>
          <div class="ticket-attachment-body">
            <div class="ticket-attachment-name">${escapeHtml(item.nome || 'arquivo')}</div>
            <div class="ticket-attachment-meta">
              ${item.usuarioNome ? `${escapeHtml(item.usuarioNome)} • ` : ''}${escapeHtml(formatDate(item.criadoEm) || 'Sem data')}<br>
              ${escapeHtml(item.origem || 'Anexo')} ${item.tamanho ? `• ${escapeHtml(formatAttachmentSize(item.tamanho))}` : ''}
            </div>
            <div class="ticket-attachment-actions">
              <a class="attachment-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Abrir anexo</a>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    ${hiddenCount ? `<div class="ticket-attachments-more">Mostrando ${visible.length} de ${entries.length} anexos para a tela não ficar poluída.</div>` : ''}
  `;
}


function attachmentNamesFromFiles(files) {
  const items = normalizeFileArray(files);
  if (!items.length) return 'anexo';
  if (items.length === 1) return items[0].name || 'arquivo';
  return `${items.length} anexos`;
}

async function uploadTicketFile(ticketId, file, index = 0) {
  if (!file) return null;

  const validation = validateAttachmentFile(file);
  if (validation) throw new Error(validation);

  const cleanName = cleanStorageFileName(file.name || `anexo-${index + 1}`);
  const path = `xabuia/chamados/${ticketId}/${Date.now()}-${index + 1}-${cleanName}`;
  const contentType = attachmentContentType(file);
  const fileRef = ref(storage, path);

  await uploadBytes(fileRef, file, { contentType });
  const url = await getDownloadURL(fileRef);

  return {
    nome: file.name || cleanName,
    tipo: contentType,
    tamanho: file.size,
    path,
    storagePath: path,
    url
  };
}

async function uploadTicketFiles(ticketId, files) {
  const fileList = normalizeFileArray(Array.isArray(files) ? files : (files ? [files] : []));
  if (!fileList.length) return null;

  if (fileList.length > MAX_ATTACHMENTS_PER_ACTION) {
    throw new Error(`Envie no máximo ${MAX_ATTACHMENTS_PER_ACTION} anexos por vez.`);
  }

  const uploaded = [];
  for (let index = 0; index < fileList.length; index += 1) {
    uploaded.push(await uploadTicketFile(ticketId, fileList[index], index));
  }

  return attachmentSummary(uploaded);
}

async function tryUploadTicketFile(ticketId, fileOrFiles) {
  const files = normalizeFileArray(Array.isArray(fileOrFiles) ? fileOrFiles : (fileOrFiles ? [fileOrFiles] : []));
  if (!files.length) return { anexo: null, warning: '' };

  try {
    const anexo = await uploadTicketFiles(ticketId, files);
    return { anexo, warning: '' };
  } catch (error) {
    console.warn('Anexo não enviado:', error);
    const message = String(error?.message || '');
    const code = String(error?.code || '');
    const storageHint = code.includes('storage/') || message.toLowerCase().includes('storage') || message.includes('permission');
    return {
      anexo: null,
      warning: storageHint
        ? 'Chamado salvo, mas o anexo não foi enviado. Confira as regras do Storage e use a pasta xabuia/.'
        : `Chamado salvo, mas o anexo não foi enviado: ${message || code}`
    };
  }
}

function ticketStatusPayload(status) {
  const payload = {
    status,
    atualizadoEm: serverTimestamp()
  };

  if (status === 'em_tratamento') {
    payload.operadorTratamentoId = state.user.uid;
    payload.operadorTratamentoNome = selectedUserName();
    payload.operadorTratamentoEmail = state.user.email;
    payload.tratamentoIniciadoEm = serverTimestamp();
  }

  if (['aberto', 'reaberto'].includes(status)) {
    payload.operadorTratamentoId = null;
    payload.operadorTratamentoNome = null;
    payload.operadorTratamentoEmail = null;
    payload.tratamentoIniciadoEm = null;
  }

  if (status === 'finalizado') {
    payload.finalizadoPor = state.user.uid;
    payload.finalizadoPorNome = selectedUserName();
    payload.finalizadoPorEmail = state.user.email;
    payload.finalizadoEm = serverTimestamp();
  }

  if (status === 'informacoes_divergentes') {
    payload.informacoesDivergentesPor = state.user.uid;
    payload.informacoesDivergentesPorNome = selectedUserName();
    payload.informacoesDivergentesPorEmail = state.user.email;
    payload.informacoesDivergentesEm = serverTimestamp();
  }

  if (status === 'devolver_recusar') {
    payload.devolverRecusarPor = state.user.uid;
    payload.devolverRecusarPorNome = selectedUserName();
    payload.devolverRecusarPorEmail = state.user.email;
    payload.devolverRecusarEm = serverTimestamp();
  }

  if (status === 'reaberto') {
    payload.reabertoPor = state.user.uid;
    payload.reabertoPorNome = selectedUserName();
    payload.reabertoPorEmail = state.user.email;
    payload.reabertoEm = serverTimestamp();
  }

  return payload;
}

async function reopenTicket(ticket, texto = 'Chamado reaberto.') {
  const ticketRef = doc(db, 'chamados', ticket.id);
  const updatePayload = {
    ...ticketStatusPayload('reaberto'),
    ...lastOccurrencePayload(texto, 'reabertura')
  };

  const batch = writeBatch(db);
  batch.update(ticketRef, updatePayload);
  batch.set(doc(collection(db, 'chamados', ticket.id, 'historico')), historyPayload(texto, 'reabertura'));
  await batch.commit();

  await tryCommitStatusTimelineEvent(ticketRef, ticket, 'reaberto', texto, updatePayload);
  await tryCommitOperatorEvent(ticket, 'reaberto', texto);

  state.historyLoadedFor = null;
  await loadUnifiedTimeline(ticket.id).catch(() => {});
  showToast('Chamado reaberto.', 'success');
}

async function updateTicketStatus(ticket, status, customText = '') {
  if (!STATUS_LABELS[status]) return;
  const defaultText = status === 'em_tratamento'
    ? statusAutoOccurrenceText(status)
    : `Status alterado para ${STATUS_LABELS[status]}.`;
  const texto = normalizeKey(customText || defaultText);
  const tipo = historyTypeForStatusChange(status);
  const ticketRef = doc(db, 'chamados', ticket.id);
  const updatePayload = {
    ...ticketStatusPayload(status),
    ...lastOccurrencePayload(texto, tipo)
  };

  const batch = writeBatch(db);
  batch.update(ticketRef, updatePayload);
  batch.set(doc(collection(db, 'chamados', ticket.id, 'historico')), historyPayload(texto, tipo));
  await batch.commit();

  await tryCommitStatusTimelineEvent(ticketRef, ticket, status, texto, updatePayload);
  await tryCommitOperatorEvent(ticket, status, texto);

  state.historyLoadedFor = null;
  await loadUnifiedTimeline(ticket.id).catch(() => {});
  showToast(status === 'em_tratamento' ? 'Chamado reservado para você.' : 'Status atualizado.', 'success');
}

async function reserveTicket(ticketId) {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket) return showToast('Chamado não encontrado na lista atual.', 'error');
  if (!canReserveTicket(ticket)) return showToast('Este chamado não pode ser reservado agora.', 'error');

  const buttons = [...document.querySelectorAll(`[data-reserve-ticket-id="${CSS.escape(ticketId)}"]`)];
  buttons.forEach((button) => { button.disabled = true; button.textContent = 'Reservando...'; });

  const ticketRef = doc(db, 'chamados', ticketId);
  const texto = statusAutoOccurrenceText('em_tratamento');
  let oldTicket = null;
  const optimistic = {
    ...ticket, status: 'em_tratamento',
    operadorTratamentoId: state.user.uid,
    operadorTratamentoNome: selectedUserName(),
    operadorTratamentoEmail: state.user.email,
    tratamentoIniciadoEm: new Date(), atualizadoEm: new Date()
  };
  state.optimisticReservations.set(ticketId, { ticket: optimistic, until: Date.now() + 30000 });
  mergeTicketBuckets();
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ticketRef);
      if (!snap.exists()) throw new Error('Este chamado não existe mais.');
      const current = { id: snap.id, ...snap.data() };
      if (!['aberto', 'reaberto'].includes(current.status || 'aberto')) {
        throw new Error('Outro operador já reservou ou finalizou este chamado.');
      }
      oldTicket = current;
      const updatePayload = {
        ...ticketStatusPayload('em_tratamento'),
        ...lastOccurrencePayload(texto, 'tratativa')
      };
      transaction.update(ticketRef, updatePayload);
      transaction.set(doc(collection(db, 'chamados', ticketId, 'historico')), historyPayload(texto, 'tratativa'));
    });
    // Eventos complementares mantidos para compatibilidade com relatórios existentes.
    await tryCommitStatusTimelineEvent(ticketRef, oldTicket, 'em_tratamento', texto);
    await tryCommitOperatorEvent(oldTicket, 'em_tratamento', texto);
    showToast('Chamado reservado para você. Ele permanece na posição original.', 'success');
  } catch (error) {
    state.optimisticReservations.delete(ticketId);
    mergeTicketBuckets();
    console.error('Erro ao reservar chamado:', error);
    const message = error?.code === 'permission-denied'
      ? 'Permissão negada pelas regras do Firestore. Verifique as regras publicadas.'
      : error.message;
    showToast(`Não foi possível reservar: ${message}`, 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; button.textContent = 'Reservar'; });
  }
}


async function createTicket(event) {
  event.preventDefault();

  const tipoChamado = els.ticketTypeInput?.value || 'nf_caminhao_porta';
  const chave = limparChaveNfe(els.ticketKeyInput.value);
  const observacao = normalizeKey(els.ticketObsInput.value);
  const tipoHistorico = 'criacao';
  const files = getTicketAttachmentFiles();

  syncTicketKeyInput(true);

  if (!isInvoiceTicketType(tipoChamado)) {
    return showToast('Este formulário não é de nota fiscal.', 'error');
  }

  if (!chaveNfeValida(chave)) {
    els.ticketKeyInput.focus();
    return showToast('Chave de acesso inválida. Informe exatamente 44 números.', 'error');
  }

  if (!observacao) {
    els.ticketObsInput.focus();
    return showToast('Preencha a observação inicial.', 'error');
  }

  let org;
  if (isOperatorOrAdmin()) {
    org = state.orgs.find((item) => item.id === els.ticketOrgSelect.value);
  } else {
    org = { id: state.profile.organizacaoId, nome: state.profile.organizacaoNome };
  }

  if (!org?.id) return showToast('Selecione uma organização.', 'error');

  els.saveTicketBtn.disabled = true;
  els.saveTicketBtn.textContent = 'Salvando...';

  try {
    const chaveBusca = `${tipoChamado}:${keySearchValue(chave)}`;
    const deterministicRef = doc(db, 'chamados', ticketDocId(org.id, chaveBusca));

    const existingInMemory = state.tickets.find((ticket) => (
      ticket.organizacaoId === org.id
      && (ticket.chaveBusca === chaveBusca || `${ticket.tipoChamado || 'nota_fiscal'}:${keySearchValue(ticket.chave)}` === chaveBusca)
    ));

    let existingSnap = null;
    if (!existingInMemory) {
      try {
        existingSnap = await getDoc(deterministicRef);
      } catch (error) {
        if (error?.code !== 'permission-denied') throw error;
        console.warn('Consulta prévia do chamado foi negada; tentando salvar direto.', error);
      }
    }

    const existingRef = existingInMemory ? doc(db, 'chamados', existingInMemory.id) : deterministicRef;
    const existingTicket = existingInMemory || (existingSnap?.exists() ? { id: deterministicRef.id, ...existingSnap.data() } : null);

    if (existingTicket) {
      const { anexo, warning } = await tryUploadTicketFile(existingRef.id, files);
      const updatePayload = {
        ...(CLOSED_STATUSES.includes(existingTicket.status)
          ? ticketStatusPayload('reaberto')
          : { atualizadoEm: serverTimestamp() }),
        ...requesterUpdatePayload(),
        ...lastOccurrencePayload(observacao, CLOSED_STATUSES.includes(existingTicket.status) ? 'reabertura' : 'observacao', anexo),
        ...(anexo ? { anexo } : {})
      };

      const batch = writeBatch(db);
      batch.update(existingRef, updatePayload);
      batch.set(doc(collection(db, 'chamados', existingRef.id, 'historico')), historyPayload(observacao, CLOSED_STATUSES.includes(existingTicket.status) ? 'reabertura' : 'observacao', anexo ? { anexo } : {}));
      await batch.commit();

      if (CLOSED_STATUSES.includes(existingTicket.status)) await tryCommitStatusTimelineEvent(existingRef, existingTicket, 'reaberto', observacao, updatePayload);
      if (CLOSED_STATUSES.includes(existingTicket.status)) await tryCommitOperatorEvent(existingTicket, 'reaberto', observacao);

      showToast(warning || (CLOSED_STATUSES.includes(existingTicket.status) ? 'Chamado reaberto com nova ocorrência.' : 'Nova ocorrência adicionada ao chamado existente, sem alterar o responsável.'), warning ? 'error' : 'success');
      state.selectedTicketId = existingRef.id;
    } else {
      const { anexo, warning } = await tryUploadTicketFile(deterministicRef.id, files);
      const createPayload = createTicketBasePayload({ tipoChamado, chave, chaveBusca, org, observacao, tipoHistorico });

      await setDoc(deterministicRef, createPayload);

      const batch = writeBatch(db);
      if (anexo) {
        batch.update(deterministicRef, {
          ...lastOccurrencePayload(observacao, tipoHistorico, anexo),
          anexo
        });
      }
      batch.set(doc(collection(db, 'chamados', deterministicRef.id, 'historico')), historyPayload(observacao, tipoHistorico, anexo ? { anexo } : {}));
      await batch.commit();

      await tryCommitStatusTimelineEvent(deterministicRef, { id: deterministicRef.id, ...createPayload, status: 'aberto' }, 'aberto', observacao, createPayload);

      state.selectedTicketId = deterministicRef.id;
      showToast(warning || 'Chamado criado com sucesso.', warning ? 'error' : 'success');
    }

    els.ticketForm.reset();
    clearTicketAttachment();
    syncTicketKeyInput(false);
    els.ticketDialog.close();
  } catch (error) {
    const message = error?.code === 'permission-denied'
      ? 'Permissão negada pelo Firestore. Publique o firestore.rules V27 atualizado.'
      : error.message;
    showToast(`Erro ao salvar chamado: ${message}`, 'error');
  } finally {
    els.saveTicketBtn.disabled = false;
    els.saveTicketBtn.textContent = 'Salvar chamado';
  }
}

async function createProductTicket(event) {
  event.preventDefault();

  const tipoChamado = els.productTypeInput?.value || 'reativacao_produtos';
  const codigoProduto = normalizeProductCode(els.productCodeInput.value);
  const observacao = normalizeKey(els.productObsInput.value);
  const files = getProductAttachmentFiles();

  if (!isProductTicketType(tipoChamado)) {
    return showToast('Este formulário de produto ainda não está configurado.', 'error');
  }

  if (!codigoProduto) {
    els.productCodeInput.focus();
    return showToast('Informe o código do produto.', 'error');
  }

  if (!observacao) {
    els.productObsInput.focus();
    return showToast('Preencha a observação inicial.', 'error');
  }

  let org;
  if (isOperatorOrAdmin()) {
    org = state.orgs.find((item) => item.id === els.productOrgSelect.value);
  } else {
    org = { id: state.profile.organizacaoId, nome: state.profile.organizacaoNome };
  }

  if (!org?.id) return showToast('Selecione uma organização.', 'error');

  els.saveProductTicketBtn.disabled = true;
  els.saveProductTicketBtn.textContent = 'Salvando...';

  try {
    const chave = codigoProduto;
    const chaveBusca = `${tipoChamado}:${keySearchValue(codigoProduto)}`;
    const deterministicRef = doc(db, 'chamados', ticketDocId(org.id, chaveBusca));

    const existingInMemory = state.tickets.find((ticket) => (
      ticket.organizacaoId === org.id
      && (ticket.chaveBusca === chaveBusca || `${ticket.tipoChamado}:${keySearchValue(ticket.codigoProduto || ticket.chave)}` === chaveBusca)
    ));

    let existingSnap = null;
    if (!existingInMemory) {
      try {
        existingSnap = await getDoc(deterministicRef);
      } catch (error) {
        if (error?.code !== 'permission-denied') throw error;
        console.warn('Consulta prévia do chamado foi negada; tentando salvar direto.', error);
      }
    }

    const existingRef = existingInMemory ? doc(db, 'chamados', existingInMemory.id) : deterministicRef;
    const existingTicket = existingInMemory || (existingSnap?.exists() ? { id: deterministicRef.id, ...existingSnap.data() } : null);

    if (existingTicket) {
      const { anexo, warning } = await tryUploadTicketFile(existingRef.id, files);
      const updatePayload = {
        ...(CLOSED_STATUSES.includes(existingTicket.status)
          ? ticketStatusPayload('reaberto')
          : { atualizadoEm: serverTimestamp() }),
        ...requesterUpdatePayload(),
        ...lastOccurrencePayload(observacao, CLOSED_STATUSES.includes(existingTicket.status) ? 'reabertura' : 'observacao', anexo),
        ...(anexo ? { anexo } : {})
      };

      const batch = writeBatch(db);
      batch.update(existingRef, updatePayload);
      batch.set(doc(collection(db, 'chamados', existingRef.id, 'historico')), historyPayload(observacao, CLOSED_STATUSES.includes(existingTicket.status) ? 'reabertura' : 'observacao', anexo ? { anexo } : {}));
      await batch.commit();

      if (CLOSED_STATUSES.includes(existingTicket.status)) await tryCommitStatusTimelineEvent(existingRef, existingTicket, 'reaberto', observacao, updatePayload);
      if (CLOSED_STATUSES.includes(existingTicket.status)) await tryCommitOperatorEvent(existingTicket, 'reaberto', observacao);

      showToast(warning || (CLOSED_STATUSES.includes(existingTicket.status) ? 'Chamado de produto reaberto com nova ocorrência.' : 'Nova ocorrência adicionada ao chamado existente, sem alterar o responsável.'), warning ? 'error' : 'success');
      state.selectedTicketId = existingRef.id;
    } else {
      const { anexo, warning } = await tryUploadTicketFile(deterministicRef.id, files);
      const createPayload = createTicketBasePayload({
        tipoChamado,
        chave,
        chaveBusca,
        codigoProduto,
        org,
        observacao,
        tipoHistorico: 'criacao'
      });

      await setDoc(deterministicRef, createPayload);

      const batch = writeBatch(db);
      if (anexo) {
        batch.update(deterministicRef, {
          ...lastOccurrencePayload(observacao, 'criacao', anexo),
          anexo
        });
      }
      batch.set(doc(collection(db, 'chamados', deterministicRef.id, 'historico')), historyPayload(observacao, 'criacao', anexo ? { anexo } : {}));
      await batch.commit();

      await tryCommitStatusTimelineEvent(deterministicRef, { id: deterministicRef.id, ...createPayload, status: 'aberto' }, 'aberto', observacao, createPayload);

      state.selectedTicketId = deterministicRef.id;
      showToast(warning || 'Chamado de produto criado com sucesso.', warning ? 'error' : 'success');
    }

    els.productTicketForm.reset();
    clearProductAttachment();
    updateProductObsPreview();
    els.productTicketDialog.close();
  } catch (error) {
    const message = error?.code === 'permission-denied'
      ? 'Permissão negada pelo Firestore. Publique o firestore.rules V27 atualizado.'
      : error.message;
    showToast(`Erro ao salvar chamado: ${message}`, 'error');
  } finally {
    els.saveProductTicketBtn.disabled = false;
    els.saveProductTicketBtn.textContent = 'Salvar chamado';
  }
}

function renderApp() {
  const profile = state.profile;
  els.userLine.textContent = `${profile.nome || state.user.email} • ${roleLabel(profile.papel)} • ${profile.organizacaoNome || 'Todas as organizações'}`;
  els.adminBtn.classList.toggle('hidden', !isAdmin());
  els.adminQueryActiveBtn?.classList.toggle('hidden', !isAdmin());
  if (els.adminQueryActiveBtn) els.adminQueryActiveBtn.textContent = 'Consultar por filtros';
  els.adminClearQueryBtn?.classList.toggle('hidden', !isAdmin());
  els.adminPanel?.classList.toggle('hidden', true);
  els.orgFilterWrap.classList.toggle('hidden', !isOperatorOrAdmin());
  els.ticketOrgWrap?.classList.toggle('hidden', !isOperatorOrAdmin());
  els.productOrgWrap?.classList.toggle('hidden', !isOperatorOrAdmin());
  showOnly(els.appView);
  loadMyNotices();
  renderOrgSelects();
  ensureMainDates();
  startTicketsListener();
  refreshQueryBackedFilters();
}

function renderAdmin() {
  if (!isAdmin()) return;
  ensureAdminSlaControls();

  const orgHtml = state.orgs.length ? state.orgs.map((org) => `
    <div class="mini-item">
      <div class="mini-item-head">
        <div>
          <strong>${escapeHtml(org.nome)}</strong><br>
          <small class="muted">ID: ${escapeHtml(org.id)}</small>
        </div>
        <span class="pill">${org.ativa === false ? 'Inativa' : 'Ativa'}</span>
      </div>
      <button class="btn ghost" type="button" data-toggle-org="${org.id}" data-active="${org.ativa === false ? 'true' : 'false'}">
        ${org.ativa === false ? 'Reativar' : 'Desativar'}
      </button>
    </div>
  `).join('') : '<div class="empty-state">Nenhuma organização cadastrada. Cadastre a primeira acima.</div>';

  els.orgAdminList.innerHTML = orgHtml;
  if (els.quickOrgList) els.quickOrgList.innerHTML = orgHtml;

  els.usersAdminList.innerHTML = state.users.length ? state.users.map((user) => `
    <div class="mini-item">
      <div class="mini-item-head">
        <div>
          <strong>${escapeHtml(user.nome || user.email)}</strong><br>
          <small class="muted">${user.usuario ? '@' + escapeHtml(user.usuario) + ' • ' : 'Sem usuário curto • '}${escapeHtml(user.email || '')}</small><br>
          <small class="muted">${escapeHtml(user.organizacaoNome || 'Todas as organizações')}</small>
        </div>
        <span class="pill">${user.ativo === false ? 'Banido' : roleLabel(user.papel)}</span>
      </div>
      <div class="mini-controls">
        <select data-role-user="${user.id}">
          <option value="usuario">Usuário</option>
          <option value="operador">Operador</option>
          <option value="admin">Admin</option>
        </select>
        <select data-org-user="${user.id}">
          <option value="">Todas/sem organização</option>
          ${state.orgs.map((org) => `<option value="${org.id}">${escapeHtml(org.nome)}</option>`).join('')}
        </select>
        <button class="btn ${user.ativo === false ? 'ghost' : 'danger'}" type="button" data-toggle-user="${user.id}" data-active="${user.ativo === false ? 'true' : 'false'}">
          ${user.ativo === false ? 'Reativar' : 'Banir'}
        </button>
      </div>
    </div>
  `).join('') : '<div class="empty-state">Nenhum usuário encontrado.</div>';

  state.users.forEach((user) => {
    const roleSelect = els.usersAdminList.querySelector(`[data-role-user="${CSS.escape(user.id)}"]`);
    const orgSelect = els.usersAdminList.querySelector(`[data-org-user="${CSS.escape(user.id)}"]`);
    if (roleSelect) roleSelect.value = user.papel || 'usuario';
    if (orgSelect) orgSelect.value = user.organizacaoId || '';
  });
}


function localDateStart(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function localDateEnd(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function todayInputValue() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function firstDayMonthInputValue() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

function ensureMainDates() {
  const today = todayInputValue();
  if (els.mainDateStart && !els.mainDateStart.value) els.mainDateStart.value = today;
  if (els.mainDateEnd && !els.mainDateEnd.value) els.mainDateEnd.value = today;
}

function ensureReportDates() {
  if (!els.operatorReportStart || !els.operatorReportEnd) return;
  if (!els.operatorReportStart.value) els.operatorReportStart.value = firstDayMonthInputValue();
  if (!els.operatorReportEnd.value) els.operatorReportEnd.value = todayInputValue();
}

function operatorReportKey(uid, name, email) {
  return uid || email || name || 'sem-operador';
}

function operatorReportName(uid, name, email) {
  if (name) return name;
  const user = state.users.find((item) => item.id === uid || item.email === email);
  return user?.nome || user?.email || email || 'Sem operador';
}

function currentAdminQueryStatuses() {
  const selectedStatus = els.statusFilter?.value || 'ativos';
  if (selectedStatus === 'ativos') return ACTIVE_STATUSES;
  if (selectedStatus === 'todos') return ALL_TICKET_STATUSES;
  return [selectedStatus];
}

function adminQueryDescription(statuses) {
  if (!statuses?.length) return 'filtros';
  if (statuses.length === ACTIVE_STATUSES.length && ACTIVE_STATUSES.every((status) => statuses.includes(status))) return 'fila ativa';
  if (statuses.length === ALL_TICKET_STATUSES.length) return 'todos os status';
  return statuses.map((status) => STATUS_LABELS[status] || status).join(', ');
}

async function fetchAdminTicketsByStatuses(statuses = ACTIVE_STATUSES, perStatusLimit = ADMIN_ACTIVE_QUERY_LIMIT_PER_STATUS) {
  if (!isAdmin()) return [];
  const chamadosRef = collection(db, 'chamados');
  const found = new Map();

  for (const status of statuses) {
    const snapshot = await getDocs(query(
      chamadosRef,
      where('status', '==', status),
      limit(perStatusLimit)
    ));
    snapshot.docs.forEach((d) => found.set(d.id, { id: d.id, ...d.data() }));
  }

  return sortTicketsForDisplay([...found.values()]);
}

async function fetchAdminActiveTickets() {
  return fetchAdminTicketsByStatuses(ACTIVE_STATUSES, ADMIN_ACTIVE_QUERY_LIMIT_PER_STATUS);
}

async function fetchAdminFilteredTickets() {
  return fetchAdminTicketsByStatuses(currentAdminQueryStatuses(), ADMIN_FILTERED_QUERY_LIMIT_PER_STATUS);
}

async function adminQueryActiveTickets() {
  if (!isAdmin()) return;
  const btn = els.adminQueryActiveBtn;
  const statuses = currentAdminQueryStatuses();
  const description = adminQueryDescription(statuses);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Consultando...';
  }
  setText(els.liveStatus, `Consultando ${description}...`);

  try {
    const tickets = await fetchAdminFilteredTickets();
    state.ticketBuckets = { admin_consulta_filtros: tickets };
    mergeTicketBuckets();
    setText(els.liveStatus, `Consulta admin: ${tickets.length} chamado(s) • ${description}`);
    showToast(`${tickets.length} chamado(s) carregado(s) para o admin (${description}).`, 'success');
  } catch (error) {
    console.error('Erro na consulta admin:', error);
    setText(els.liveStatus, 'Erro na consulta admin');
    showToast(`Erro ao consultar chamados: ${error.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Consultar por filtros';
    }
  }
}

function adminClearManualQuery() {
  if (!isAdmin()) return;
  stopTicketsListener();
  state.tickets = [];
  state.selectedTicketId = null;
  renderTickets();
  renderTicketDetail(null);
  setText(els.liveStatus, 'Admin: consulta manual econômica');
}

function rowSlaLimit(ticket, settings) {
  if (ticket.status === 'reaberto') return settings.reaberto;
  if (ticket.status === 'em_tratamento') return settings.em_tratamento;
  return settings.aberto;
}

async function generateAdminSlaReport() {
  if (!isAdmin() || !els.adminSlaReportBox) return;
  const settings = currentAdminSlaSettingsFromInputs();
  const btn = els.adminSlaQueryBtn;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Consultando...';
  }

  els.adminSlaReportBox.innerHTML = '<div class="empty-state">Consultando chamados ativos e calculando tempo na tela...</div>';

  try {
    const tickets = await fetchAdminActiveTickets();
    const overdue = tickets
      .map((ticket) => ({ ticket, age: ticketAgeMinutes(ticket), limit: rowSlaLimit(ticket, settings) }))
      .filter((row) => row.age != null && row.age >= row.limit)
      .sort((a, b) => b.age - a.age);

    const summary = ACTIVE_STATUSES.map((status) => {
      const rows = overdue.filter((row) => row.ticket.status === status);
      return `${STATUS_LABELS[status]}: ${rows.length}`;
    }).join(' • ');

    if (!overdue.length) {
      els.adminSlaReportBox.innerHTML = `<div class="empty-state">Nenhum chamado acima do limite configurado. ${escapeHtml(summary)}</div>`;
      return;
    }

    els.adminSlaReportBox.innerHTML = `
      <p class="muted"><strong>${overdue.length}</strong> chamado(s) acima do limite. ${escapeHtml(summary)}</p>
      <div class="table-wrap">
        <table class="report-table sla-table">
          <thead>
            <tr>
              <th>Chamado</th>
              <th>Status</th>
              <th>Tempo</th>
              <th>Limite</th>
              <th>Operador</th>
              <th>Organização</th>
            </tr>
          </thead>
          <tbody>
            ${overdue.map(({ ticket, age, limit: rowLimit }) => `
              <tr>
                <td><strong>${escapeHtml(ticketTitle(ticket))}</strong><br><small>${escapeHtml(ticketRawLine(ticket))}</small></td>
                <td>${statusBadge(ticket.status)}</td>
                <td><strong>${escapeHtml(formatMinutes(age))}</strong></td>
                <td>${escapeHtml(formatMinutes(rowLimit))}</td>
                <td>${escapeHtml(ticket.operadorTratamentoNome || ticket.operadorTratamentoEmail || '—')}</td>
                <td>${escapeHtml(ticket.organizacaoNome || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    console.error('Erro no relatório de SLA:', error);
    els.adminSlaReportBox.innerHTML = `<div class="empty-state">Erro ao consultar SLA: ${escapeHtml(error.message)}</div>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Consultar SLA';
    }
  }
}

async function generateOperatorReport() {
  if (!isAdmin() || !els.operatorReportBox) return;
  ensureReportDates();

  const start = localDateStart(els.operatorReportStart.value);
  const end = localDateEnd(els.operatorReportEnd.value);
  const startDate = localDateStartDate(els.operatorReportStart.value);
  const endDate = localDateEndDate(els.operatorReportEnd.value);

  if (!start || !end || start > end || !startDate || !endDate) {
    els.operatorReportBox.innerHTML = '<div class="empty-state">Informe um intervalo de datas válido.</div>';
    return;
  }

  const btn = els.operatorReportBtn;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Gerando...';
  }

  els.operatorReportBox.innerHTML = '<div class="empty-state">Consultando eventos dos operadores no período informado...</div>';

  const rows = new Map();
  const ensure = (uid, name, email) => {
    const key = operatorReportKey(uid, name, email);
    if (!rows.has(key)) {
      rows.set(key, {
        uid: uid || '',
        nome: operatorReportName(uid, name, email),
        email: email || '',
        iniciados: 0,
        finalizados: 0,
        reabertos: 0,
        divergentes: 0,
        devolvidos: 0,
        duracoes: []
      });
    }
    return rows.get(key);
  };

  function addRowEvent(event) {
    const row = ensure(event.operadorId, event.operadorNome, event.operadorEmail);
    if (event.tipo === 'em_tratamento') row.iniciados += 1;
    if (event.tipo === 'finalizado') row.finalizados += 1;
    if (event.tipo === 'reaberto') row.reabertos += 1;
    if (event.tipo === 'informacoes_divergentes') row.divergentes += 1;
    if (event.tipo === 'devolver_recusar') row.devolvidos += 1;
    const duration = Number(event.duracaoStatusAnteriorMin);
    if (Number.isFinite(duration) && duration >= 0) row.duracoes.push(duration);
  }

  async function countLegacyByDateField(field, applyTicket) {
    const q = query(
      collection(db, 'chamados'),
      where(field, '>=', startDate),
      where(field, '<=', endDate),
      limit(1000)
    );
    const snapshot = await getDocs(q);
    snapshot.docs.forEach((d) => applyTicket({ id: d.id, ...d.data() }));
    return snapshot.size;
  }

  try {
    let usedEvents = false;

    try {
      const eventsQuery = query(
        collection(db, 'operador_eventos'),
        where('criadoEm', '>=', startDate),
        where('criadoEm', '<=', endDate),
        limit(3000)
      );
      const eventsSnapshot = await getDocs(eventsQuery);
      eventsSnapshot.docs.forEach((d) => addRowEvent({ id: d.id, ...d.data() }));
      usedEvents = eventsSnapshot.size > 0;
    } catch (eventError) {
      console.warn('Relatório por eventos indisponível; usando campos atuais dos chamados:', eventError);
    }

    if (!usedEvents) {
      els.operatorReportBox.innerHTML = '<div class="empty-state">Sem eventos novos no período. Usando relatório legado pelos campos atuais dos chamados...</div>';

      await countLegacyByDateField('tratamentoIniciadoEm', (ticket) => {
        ensure(ticket.operadorTratamentoId, ticket.operadorTratamentoNome, ticket.operadorTratamentoEmail).iniciados += 1;
      });

      await countLegacyByDateField('finalizadoEm', (ticket) => {
        ensure(ticket.finalizadoPor, ticket.finalizadoPorNome, ticket.finalizadoPorEmail).finalizados += 1;
      });

      await countLegacyByDateField('reabertoEm', (ticket) => {
        ensure(ticket.reabertoPor, ticket.reabertoPorNome, ticket.reabertoPorEmail).reabertos += 1;
      });

      await countLegacyByDateField('informacoesDivergentesEm', (ticket) => {
        ensure(
          ticket.informacoesDivergentesPor,
          ticket.informacoesDivergentesPorNome,
          ticket.informacoesDivergentesPorEmail
        ).divergentes += 1;
      });

      await countLegacyByDateField('devolverRecusarEm', (ticket) => {
        ensure(
          ticket.devolverRecusarPor,
          ticket.devolverRecusarPorNome,
          ticket.devolverRecusarPorEmail
        ).devolvidos += 1;
      });
    }

    const data = [...rows.values()]
      .map((row) => ({
        ...row,
        total: row.iniciados + row.finalizados + row.reabertos + row.divergentes + row.devolvidos,
        tempoMedio: row.duracoes.length
          ? Math.round(row.duracoes.reduce((acc, value) => acc + value, 0) / row.duracoes.length)
          : null
      }))
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));

    if (!data.length) {
      els.operatorReportBox.innerHTML = '<div class="empty-state">Nenhuma tratativa encontrada nesse intervalo.</div>';
      return;
    }

    els.operatorReportBox.innerHTML = `
      <p class="muted">${usedEvents ? 'Relatório por eventos: conta cada vez que um operador pegou/tratou o chamado.' : 'Relatório legado: usa o estado atual gravado no chamado.'}</p>
      <div class="table-wrap">
        <table class="report-table">
          <thead>
            <tr>
              <th>Operador</th>
              <th>Em tratamento</th>
              <th>Finalizados</th>
              <th>Reabertos</th>
              <th>Divergentes</th>
              <th>Devolver/recusar</th>
              <th>Tempo médio até ação</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${data.map((row) => `
              <tr>
                <td><strong>${escapeHtml(row.nome)}</strong><br><small>${escapeHtml(row.email || row.uid)}</small></td>
                <td>${row.iniciados}</td>
                <td>${row.finalizados}</td>
                <td>${row.reabertos}</td>
                <td>${row.divergentes}</td>
                <td>${row.devolvidos}</td>
                <td>${escapeHtml(formatMinutes(row.tempoMedio))}</td>
                <td><strong>${row.total}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    if (String(error?.message || '').includes('requires an index')) {
      els.operatorReportBox.innerHTML = '<div class="empty-state">O Firestore pediu um índice para esse relatório. Abra o console do navegador e clique no link do erro para criar o índice sugerido.</div>';
      return;
    }
    els.operatorReportBox.innerHTML = `<div class="empty-state">Erro ao gerar relatório: ${escapeHtml(error.message)}</div>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Gerar relatório';
    }
  }
}


async function saveOrganizationByName(nome) {
  nome = normalizeKey(nome);
  if (!nome) return;
  const orgId = safeIdFromName(nome);

  await setDoc(doc(db, 'organizacoes', orgId), {
    nome,
    ativa: true,
    criadoPor: state.user.uid,
    criadoPorEmail: state.user.email,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  }, { merge: true });

  showToast('Organização salva no Firestore.', 'success');
}

async function createOrg(event) {
  event.preventDefault();
  const input = event.currentTarget?.id === 'quickOrgForm' ? els.quickOrgNameInput : els.orgNameInput;
  await saveOrganizationByName(input.value);
  input.value = '';
}

async function toggleOrg(orgId, active) {
  await updateDoc(doc(db, 'organizacoes', orgId), {
    ativa: active,
    atualizadoEm: serverTimestamp()
  });
  showToast(active ? 'Organização reativada.' : 'Organização desativada.', 'success');
}

async function updateUserRole(userId, papel) {
  await updateDoc(doc(db, 'usuarios', userId), {
    papel,
    atualizadoEm: serverTimestamp()
  });
  showToast('Permissão atualizada.', 'success');
}

async function updateUserOrg(userId, orgId) {
  const org = state.orgs.find((item) => item.id === orgId);
  await updateDoc(doc(db, 'usuarios', userId), {
    organizacaoId: org?.id || null,
    organizacaoNome: org?.nome || 'Todas as organizações',
    atualizadoEm: serverTimestamp()
  });
  showToast('Organização do usuário atualizada.', 'success');
}

async function toggleUser(userId, active) {
  if (userId === state.user.uid && !active) {
    return showToast('Você não pode banir a própria conta em uso.', 'error');
  }
  await updateDoc(doc(db, 'usuarios', userId), {
    ativo: active,
    atualizadoEm: serverTimestamp()
  });
  showToast(active ? 'Usuário reativado.' : 'Usuário banido.', 'success');
}

async function completeOnboarding(event) {
  event.preventDefault();
  const nome = normalizeKey(els.onboardingNameInput.value);
  const org = state.orgs.find((item) => item.id === els.onboardingOrgSelect.value);

  if (!nome || !org) return showToast('Informe seu nome e escolha uma organização.', 'error');

  const data = {
    uid: state.user.uid,
    nome,
    email: state.user.email,
    organizacaoId: org.id,
    organizacaoNome: org.nome,
    papel: 'usuario',
    ativo: true,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  };

  await setDoc(doc(db, 'usuarios', state.user.uid), data);
  if (state.user.displayName !== nome) await updateProfile(state.user, { displayName: nome });
  state.profile = { id: state.user.uid, ...data };
  renderApp();
}

function validXabuiaEmail(value) {
  // Mensagem clara para login curto e demais formatos incompletos, antes de chamar Firebase.
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function setAuthMode(mode) {
  state.mode = mode;
  const isRegister = mode === 'register';
  els.tabLogin.classList.toggle('active', !isRegister);
  els.tabRegister.classList.toggle('active', isRegister);
  els.nameField.classList.toggle('hidden', !isRegister);
  if (els.emailInput) {
    els.emailInput.type = 'email';
    els.emailInput.autocomplete = 'email';
    els.emailInput.placeholder = 'nome@empresa.com.br';
  }
  if (els.emailFieldLabel) els.emailFieldLabel.textContent = 'E-mail Xabuia';
  els.authSubmitBtn.textContent = isRegister ? 'Criar conta' : 'Entrar';
  els.passwordInput.autocomplete = isRegister ? 'new-password' : 'current-password';
}

async function submitAuth(event) {
  event.preventDefault();
  const email = normalizeKey(els.emailInput.value);
  const password = els.passwordInput.value;
  const displayName = normalizeKey(els.displayNameInput.value);

  if (!validXabuiaEmail(email)) {
    els.emailInput.focus();
    els.emailInput.setCustomValidity('E-mail inválido. Informe o endereço completo, como nome@empresa.com.br.');
    els.emailInput.reportValidity();
    showToast('E-mail inválido. Informe o endereço completo, como nome@empresa.com.br.', 'error');
    return;
  }
  els.emailInput.setCustomValidity('');

  try {
    if (state.mode === 'register') {
      if (!displayName) return showToast('Informe seu nome.', 'error');

      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName });
        showToast('Conta criada. Agora escolha a organização.', 'success');
      } catch (error) {
        if (error?.code !== 'auth/email-already-in-use') throw error;

        // Se o usuário clicou em "Criar conta" por engano, tentamos entrar com a mesma senha.
        // Se essa conta for Google, essa tentativa falha e mostramos a instrução correta.
        try {
          await signInWithEmailAndPassword(auth, email, password);
          showToast('Esse e-mail já existia. Entrei com a senha informada.', 'success');
        } catch (_) {
          setAuthMode('login');
          els.passwordInput.focus();
          showToast('Esse e-mail já tem cadastro. Mudei para Entrar. Se a conta foi criada pelo Google, use o botão Google; se quer senha, clique em Definir ou recuperar senha.', 'error');
        }
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    showToast(authErrorMessage(error), 'error');
  }
}

async function loginWithGoogle() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    if (['auth/popup-blocked', 'auth/cancelled-popup-request'].includes(error?.code)) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    showToast(authErrorMessage(error), 'error');
  }
}

async function resetPassword() {
  const email = normalizeKey(els.emailInput.value);
  if (!validXabuiaEmail(email)) {
    els.emailInput.focus();
    return showToast('E-mail inválido. Informe seu endereço completo para recuperar a senha.', 'error');
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Enviei o link para definir/recuperar a senha. Confira seu e-mail.', 'success');
  } catch (error) {
    showToast(authErrorMessage(error), 'error');
  }
}

function authErrorMessage(error) {
  const code = error?.code || '';
  const map = {
    'auth/invalid-credential': 'E-mail ou senha inválidos. Se essa conta foi criada pelo Google, use Entrar/Criar com Google; senha local não é criada automaticamente.',
    'auth/invalid-email': 'E-mail inválido. Informe o endereço completo, como nome@empresa.com.br.',
    'auth/wrong-password': 'Senha inválida. Se essa conta foi criada pelo Google, use Entrar/Criar com Google.',
    'auth/user-not-found': 'Não encontrei esse e-mail. Crie a conta ou entre com Google.',
    'auth/email-already-in-use': 'Este e-mail já possui cadastro. Clique em Entrar, use o botão Google se foi criado pelo Gmail, ou recupere/defina a senha por e-mail.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/popup-closed-by-user': 'Login com Google cancelado.',
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Vou tentar pelo redirecionamento.',
    'auth/account-exists-with-different-credential': 'Esse e-mail já existe com outro método. Entre pelo método usado antes ou defina uma senha por e-mail.',
    'auth/unauthorized-domain': 'Domínio não autorizado no Firebase Authentication.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
    'auth/network-request-failed': 'Falha de rede. Confira sua conexão.',
    'auth/operation-not-allowed': 'Este provedor de login não está habilitado no Firebase.'
  };
  return map[code] || error.message || 'Erro de autenticação.';
}

async function logout() {
  await signOut(auth);
}

function startMyProfileListener() {
  if (state.unsubProfile) { state.unsubProfile(); state.unsubProfile = null; }
  if (!state.user?.uid || !state.profile) return;
  const userId = state.user.uid;
  state.unsubProfile = onSnapshot(doc(db, 'usuarios', userId), (snap) => {
    if (!snap.exists() || !state.user || state.user.uid !== userId) return;
    const next = { ...state.profile, ...snap.data() };
    if (next.ativo === false) {
      state.profile = next;
      stopTicketsListener();
      if (state.unsubUsers) { state.unsubUsers(); state.unsubUsers = null; }
      $('ticketDetailDialog')?.close();
      showOnly(els.blockedView);
      return;
    }
    const changed = ['papel', 'organizacaoId', 'organizacaoNome', 'ativo'].some(k => next[k] !== state.profile?.[k]);
    state.profile = next;
    if (changed) {
      $('ticketDetailDialog')?.close();
      state.selectedTicketId = null;
      showToast('Seu perfil/permissões foram atualizados.', 'success');
      renderApp();
    }
  }, (error) => console.warn('[Xabuia] Não foi possível acompanhar o próprio perfil:', error));
}

function cleanupListeners() {
  stopTicketsListener();
  if (state.unsubOrgs) state.unsubOrgs();
  if (state.unsubUsers) state.unsubUsers();
  if (state.unsubProfile) state.unsubProfile();
  state.unsubOrgs = null;
  state.unsubUsers = null;
  state.unsubProfile = null;
}


function previewFileListHtml(files) {
  const fileList = normalizeFileArray(files);
  if (!fileList.length) return '';

  const firstImage = fileList.find((file) => attachmentContentType(file).startsWith('image/'));
  const names = fileList.map((file) => {
    const sizeKb = file.size ? `${Math.round(file.size / 1024)} KB` : '';
    return `<li>${escapeHtml(file.name || 'arquivo')} <small>${escapeHtml(sizeKb)}</small></li>`;
  }).join('');

  return `
    ${firstImage ? `<img src="${URL.createObjectURL(firstImage)}" alt="Prévia do anexo" />` : ''}
    <div>
      <strong>${fileList.length === 1 ? '1 anexo selecionado' : `${fileList.length} anexos selecionados`}</strong>
      <ul class="attachment-preview-list">${names}</ul>
    </div>
  `;
}

function prepareAttachmentFiles(files) {
  const incoming = normalizeFileArray(files).slice(0, MAX_ATTACHMENTS_PER_ACTION);
  const valid = [];
  const errors = [];

  incoming.forEach((file) => {
    const error = validateAttachmentFile(file);
    if (error) {
      errors.push(error);
    } else {
      valid.push(file);
    }
  });

  if (normalizeFileArray(files).length > MAX_ATTACHMENTS_PER_ACTION) {
    errors.push(`Limite de ${MAX_ATTACHMENTS_PER_ACTION} anexos por vez.`);
  }

  if (errors.length) showToast(errors[0], 'error');
  return valid;
}

function applyAttachmentState(kind, files) {
  const prepared = prepareAttachmentFiles(files);
  const first = prepared[0] || null;

  if (kind === 'ticket') {
    state.pendingTicketFiles = prepared;
    state.pendingTicketFile = first;
    updateAttachmentPreview(els.ticketPasteZone, els.ticketPastePreview, els.clearTicketFileBtn, prepared);
  }

  if (kind === 'product') {
    state.pendingProductFiles = prepared;
    state.pendingProductFile = first;
    updateAttachmentPreview(els.productPasteZone, els.productPastePreview, els.clearProductFileBtn, prepared);
  }

  if (kind === 'history') {
    state.pendingHistoryFiles = prepared;
    state.pendingHistoryFile = first;
    updateAttachmentPreview($('historyPasteZone'), $('historyPastePreview'), $('clearHistoryFileBtn'), prepared);
  }
}

function updateAttachmentPreview(zone, preview, clearBtn, files) {
  const fileList = normalizeFileArray(files);

  if (zone) zone.classList.toggle('has-file', fileList.length > 0);

  if (preview) {
    preview.innerHTML = fileList.length ? previewFileListHtml(fileList) : '';
    preview.classList.toggle('hidden', !fileList.length);
  }

  if (clearBtn) clearBtn.classList.toggle('hidden', !fileList.length);
}

function setTicketAttachment(files) {
  applyAttachmentState('ticket', Array.isArray(files) ? files : normalizeFileArray(files?.length != null && !files.name ? files : [files]));
}

function clearTicketAttachment() {
  state.pendingTicketFile = null;
  state.pendingTicketFiles = [];
  if (els.ticketFileInput) els.ticketFileInput.value = '';
  updateAttachmentPreview(els.ticketPasteZone, els.ticketPastePreview, els.clearTicketFileBtn, []);
}

function setProductAttachment(files) {
  applyAttachmentState('product', Array.isArray(files) ? files : normalizeFileArray(files?.length != null && !files.name ? files : [files]));
}

function clearProductAttachment() {
  state.pendingProductFile = null;
  state.pendingProductFiles = [];
  if (els.productFileInput) els.productFileInput.value = '';
  updateAttachmentPreview(els.productPasteZone, els.productPastePreview, els.clearProductFileBtn, []);
}

function setHistoryAttachment(files) {
  applyAttachmentState('history', Array.isArray(files) ? files : normalizeFileArray(files?.length != null && !files.name ? files : [files]));
}

function clearHistoryAttachment() {
  state.pendingHistoryFile = null;
  state.pendingHistoryFiles = [];
  const input = $('historyFileInput');
  if (input) input.value = '';
  updateAttachmentPreview($('historyPasteZone'), $('historyPastePreview'), $('clearHistoryFileBtn'), []);
}

function getTicketAttachmentFiles() {
  return state.pendingTicketFiles?.length ? state.pendingTicketFiles : normalizeFileArray(els.ticketFileInput?.files || []);
}

function getProductAttachmentFiles() {
  return state.pendingProductFiles?.length ? state.pendingProductFiles : normalizeFileArray(els.productFileInput?.files || []);
}

function getHistoryAttachmentFiles() {
  return state.pendingHistoryFiles?.length ? state.pendingHistoryFiles : normalizeFileArray($('historyFileInput')?.files || []);
}

function filesFromClipboard(event) {
  const items = [...(event.clipboardData?.items || [])];
  return items
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      const ext = file.type.includes('jpeg') ? 'jpg' : 'png';
      return new File([file], `imagem-colada-${Date.now()}-${index + 1}.${ext}`, { type: file.type || `image/${ext}` });
    })
    .filter(Boolean);
}

function firstImageFromClipboard(event) {
  return filesFromClipboard(event)[0] || null;
}

function setupAttachmentZone({ zone, input, clearBtn, setter, clearer, pasteMessage }) {
  if (!zone || !input) return;

  input.multiple = true;
  input.accept = ATTACHMENT_ACCEPT;

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => setter(input.files));
  clearBtn?.addEventListener('click', clearer);

  zone.addEventListener('paste', (event) => {
    const files = filesFromClipboard(event);
    if (!files.length) return;
    event.preventDefault();
    setter(files);
    showToast(pasteMessage || 'Imagem colada no anexo.', 'success');
  });

  zone.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));

  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('drag-over');
    const files = normalizeFileArray(event.dataTransfer?.files || []);
    if (files.length) setter(files);
  });
}

function setupPasteZone() {
  setupAttachmentZone({
    zone: els.ticketPasteZone,
    input: els.ticketFileInput,
    clearBtn: els.clearTicketFileBtn,
    setter: setTicketAttachment,
    clearer: clearTicketAttachment,
    pasteMessage: 'Imagem colada no anexo.'
  });
}

function setupProductPasteZone() {
  setupAttachmentZone({
    zone: els.productPasteZone,
    input: els.productFileInput,
    clearBtn: els.clearProductFileBtn,
    setter: setProductAttachment,
    clearer: clearProductAttachment,
    pasteMessage: 'Imagem colada no anexo.'
  });
}

function setupHistoryPasteZone() {
  setupAttachmentZone({
    zone: $('historyPasteZone'),
    input: $('historyFileInput'),
    clearBtn: $('clearHistoryFileBtn'),
    setter: setHistoryAttachment,
    clearer: clearHistoryAttachment,
    pasteMessage: 'Imagem colada na ocorrência.'
  });
}

function activeAttachmentSetter() {
  if (els.ticketDialog?.open) return setTicketAttachment;
  if (els.productTicketDialog?.open) return setProductAttachment;
  if ($('ticketDetailDialog')?.open && $('historyPasteZone') && state.selectedTicketId) return setHistoryAttachment;
  return null;
}

function setupPageDropAttachments() {
  document.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    if (!activeAttachmentSetter()) return;
    event.preventDefault();
  });

  document.addEventListener('drop', (event) => {
    const files = normalizeFileArray(event.dataTransfer?.files || []);
    if (!files.length) return;

    const setter = activeAttachmentSetter();
    if (!setter) return;

    event.preventDefault();
    setter(files);
    showToast(files.length === 1 ? 'Anexo selecionado.' : `${Math.min(files.length, MAX_ATTACHMENTS_PER_ACTION)} anexos selecionados.`, 'success');
  });
}

getRedirectResult(auth).catch((error) => {
  if (error) showToast(authErrorMessage(error), 'error');
});

onAuthStateChanged(auth, async (user) => {
  cleanupListeners();
  state.user = user;
  state.profile = null;
  state.tickets = [];
  state.users = [];
  state.selectedTicketId = null;
  state.notifications = [];
  updateNoticeButton();

  if (!user) {
    showOnly(els.authView);
    return;
  }

  try {
    hideConnectionHelp();
    const profile = await loadOrCreateProfile(user);

    if (!profile) {
      els.onboardingNameInput.value = user.displayName || '';
      showOnly(els.onboardingView);
      startOrgListener();
      return;
    }

    state.profile = profile;

    if (profile.ativo === false) {
      showOnly(els.blockedView);
      return;
    }

    startOrgListener();
    renderApp();
    startMyProfileListener();
  } catch (error) {
    const message = String(error?.message || '');
    const isPermission = error?.code === 'permission-denied' || message.toLowerCase().includes('missing or insufficient permissions');
    const isOffline = error?.code === 'unavailable' || message.toLowerCase().includes('offline') || message.toLowerCase().includes('failed to get document');
    const friendly = isPermission
      ? 'Firestore negou o acesso. Publique o arquivo firestore.rules em Firestore Database > Regras.'
      : message;

    showToast(`Erro ao iniciar sessão: ${friendly}`, 'error');
    if (isPermission || isOffline) showConnectionHelp(friendly);
    showOnly(els.authView);
  }
});

els.tabLogin.addEventListener('click', () => setAuthMode('login'));
els.tabRegister.addEventListener('click', () => setAuthMode('register'));
// Validação amigável antes de tentar autenticar; nenhuma senha é enviada se o e-mail for inválido.
els.emailInput.addEventListener('input', () => els.emailInput.setCustomValidity(''));
els.emailInput.addEventListener('invalid', () => {
  els.emailInput.setCustomValidity('E-mail inválido. Informe o endereço completo, como nome@empresa.com.br.');
  showToast('E-mail inválido. Informe o endereço completo, como nome@empresa.com.br.', 'error');
});
els.authSubmitBtn?.addEventListener('click', () => {
  if (!validXabuiaEmail(els.emailInput.value)) {
    els.emailInput.setCustomValidity('E-mail inválido. Informe o endereço completo, como nome@empresa.com.br.');
    els.emailInput.reportValidity();
    showToast('E-mail inválido. Informe o endereço completo, como nome@empresa.com.br.', 'error');
  } else els.emailInput.setCustomValidity('');
});
els.authForm.addEventListener('submit', submitAuth);
els.xabuiaSoundBtn?.addEventListener('click', toggleXabuiaSound);
els.xabuiaAlertsBtn?.addEventListener('click', showMyNotices);
els.googleBtn.addEventListener('click', loginWithGoogle);
els.resetPasswordBtn.addEventListener('click', resetPassword);
els.logoutBtn.addEventListener('click', logout);
els.logoutOnboardingBtn.addEventListener('click', logout);
els.logoutBlockedBtn.addEventListener('click', logout);
els.onboardingForm.addEventListener('submit', completeOnboarding);
els.newTicketBtn.addEventListener('click', () => {
  els.ticketTypeDialog.showModal();
});

function openInvoiceForm(tipoChamado) {
  els.ticketTypeDialog.close();
  els.ticketForm.reset();
  clearTicketAttachment();
  if (els.ticketTypeInput) els.ticketTypeInput.value = tipoChamado;
  if (els.ticketDialogTitle) els.ticketDialogTitle.textContent = `Novo chamado • ${ticketTypeLabel(tipoChamado)}`;
  syncTicketKeyInput(false);
  els.ticketDialog.showModal();
  window.setTimeout(() => els.ticketKeyInput?.focus(), 50);
}

function openProductForm(tipoChamado) {
  els.ticketTypeDialog.close();
  els.productTicketForm?.reset();
  clearProductAttachment();
  updateProductObsPreview();
  if (els.productTypeInput) els.productTypeInput.value = tipoChamado;
  if (els.productDialogTitle) els.productDialogTitle.textContent = `Novo chamado • ${ticketTypeLabel(tipoChamado)}`;
  els.productTicketDialog?.showModal();
  window.setTimeout(() => els.productCodeInput?.focus(), 50);
}

els.chooseInvoiceTruckBtn?.addEventListener('click', () => openInvoiceForm('nf_caminhao_porta'));
els.chooseInvoiceAdvanceBtn?.addEventListener('click', () => openInvoiceForm('nf_adiantamento'));
els.chooseProductReactivationBtn?.addEventListener('click', () => openProductForm('reativacao_produtos'));
els.chooseNewProductBtn?.addEventListener('click', () => openProductForm('novos_produtos'));
els.choosePedidoAndamentoBtn?.addEventListener('click', () => openProductForm('pedido_em_andamento'));
els.chooseDivergenciaFlowBtn?.addEventListener('click', () => openProductForm('divergencia_flow'));

els.ticketForm.addEventListener('submit', createTicket);
els.productTicketForm?.addEventListener('submit', createProductTicket);
els.productObsInput?.addEventListener('input', updateProductObsPreview);
els.adminBtn.addEventListener('click', () => {
  ensureReportDates();
  startUsersListener();
  renderAdmin();
  els.adminDialog.showModal();
});
els.orgForm.addEventListener('submit', createOrg);
els.operatorReportBtn?.addEventListener('click', generateOperatorReport);
els.adminQueryActiveBtn?.addEventListener('click', adminQueryActiveTickets);
els.adminClearQueryBtn?.addEventListener('click', adminClearManualQuery);
els.adminSlaQueryBtn?.addEventListener('click', generateAdminSlaReport);
els.quickOrgForm?.addEventListener('submit', createOrg);
els.searchInput.addEventListener('input', scheduleRemoteTicketSearch);
els.ticketTypeFilter?.addEventListener('change', (event) => {
  handleTicketTypeFilterChange(event);
  renderAndRefreshSearch();
});
els.statusFilter.addEventListener('change', renderAndRefreshSearch);
els.orgFilter.addEventListener('change', (event) => {
  handleOrgFilterChange(event);
  renderAndRefreshSearch();
});

els.mainDateStart?.addEventListener('change', () => {
  ensureMainDates();
  renderAndRefreshSearch();
});
els.mainDateEnd?.addEventListener('change', () => {
  ensureMainDates();
  renderAndRefreshSearch();
});

els.ticketKeyInput?.addEventListener('input', () => {
  syncTicketKeyInput(false);
});

els.ticketKeyInput?.addEventListener('paste', () => {
  window.setTimeout(() => syncTicketKeyInput(false), 0);
});

els.ticketKeyInput?.addEventListener('blur', () => {
  syncTicketKeyInput(true);
});

document.addEventListener('click', (event) => {
  document.querySelectorAll('.multi-dropdown[open]').forEach((dropdown) => {
    if (!dropdown.contains(event.target)) dropdown.open = false;
  });

  const closeId = event.target?.dataset?.closeDialog;
  if (closeId) $(closeId)?.close();

  const reserveButton = event.target.closest?.('[data-reserve-ticket-id]');
  if (reserveButton) {
    event.preventDefault();
    event.stopPropagation();
    reserveTicket(reserveButton.dataset.reserveTicketId);
    return;
  }

  const noticeTicketButton = event.target.closest?.('[data-xabuia-alert-ticket]');
  if (noticeTicketButton) {
    els.xabuiaAlertsDialog?.close();
    const id = noticeTicketButton.dataset.xabuiaAlertTicket;
    if (state.tickets.some((t) => t.id === id)) selectTicket(id);
    else showToast('O chamado não está na sua lista atual. Ajuste os filtros para localizá-lo.', 'error');
    return;
  }

  const openTicketButton = event.target.closest?.('[data-open-ticket-id]');
  if (openTicketButton) { event.preventDefault(); event.stopPropagation(); selectTicket(openTicketButton.dataset.openTicketId); return; }

  const ticketButton = event.target.closest?.('tr[data-ticket-id]');
  if (ticketButton) selectTicket(ticketButton.dataset.ticketId);

  const orgButton = event.target.closest?.('[data-toggle-org]');
  if (orgButton) toggleOrg(orgButton.dataset.toggleOrg, orgButton.dataset.active === 'true');

  const userButton = event.target.closest?.('[data-toggle-user]');
  if (userButton) toggleUser(userButton.dataset.toggleUser, userButton.dataset.active === 'true');
});

document.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const ticketCard = event.target.closest?.('[data-ticket-id]');
  if (!ticketCard || event.target.closest?.('button, input, select, textarea, a')) return;
  event.preventDefault();
  selectTicket(ticketCard.dataset.ticketId);
});

document.addEventListener('change', (event) => {
  const roleUser = event.target?.dataset?.roleUser;
  if (roleUser) updateUserRole(roleUser, event.target.value);

  const orgUser = event.target?.dataset?.orgUser;
  if (orgUser) updateUserOrg(orgUser, event.target.value);
});

document.addEventListener('paste', (event) => {
  const files = filesFromClipboard(event);
  if (!files.length) return;

  const setter = activeAttachmentSetter();
  if (!setter) return;

  event.preventDefault();
  setter(files);
  showToast(files.length === 1 ? 'Imagem colada no anexo.' : `${files.length} imagens coladas no anexo.`, 'success');
});

setupPasteZone();
setupProductPasteZone();
setupPageDropAttachments();
setAuthMode('login');