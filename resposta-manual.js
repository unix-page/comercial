// Comercial V2.5.5 — resposta retroativa pelo painel (sem consultas em filtros/relatórios).
// Somente no clique de abrir a resposta consulta o catálogo; transação fecha 1 passagem.
import { auth, db, activeProfile, canRecord, collection, doc, query, where,
  runTransaction, serverTimestamp, increment } from './firebase-core.js';
import { getDocsFromServer, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { ms, norm } from './painel-local.js';

const $ = s => document.querySelector(s);
const TTL = 15 * 60 * 1000;
const responseCache = new Map();
let active = null;
let busy = false;
let counter = 0;

const sectorTitle = { comercial: 'Comercial', fiscal: 'Fiscal (Sicofe)', cadastro: 'Cadastro' };
const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
function isReturnToSupplier(response) {
  const name = norm(response.nome);
  return response.efeito === 'devolver' || (name.includes('devolver') && name.includes('recusar'));
}
function isCrfError(response) { return response.erroCrf === true || norm(response.nome).startsWith('informacoes divergentes'); }
function localDatetime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
function formatDate(value) { const t = ms(value); return t ? new Date(t).toLocaleString('pt-BR') : '—'; }
function safeText(value) { return clean(value).slice(0, 3000); }

async function responseOptions(sector) {
  const c = responseCache.get(sector);
  if (c && c.expires > Date.now()) return c.items;
  const snap = await getDocsFromServer(query(collection(db, 'respostas_v2'), where('setor', '==', sector)));
  const items = snap.docs.map(x => ({ id: x.id, ...x.data() }))
    .filter(x => x.ativo !== false)
    .sort((a, b) => clean(a.nome).localeCompare(clean(b.nome), 'pt-BR'));
  responseCache.set(sector, { items, expires: Date.now() + TTL });
  return items;
}

export function setupManualResponse({ getSnapshot, getProfile, onSaved, toast }) {
  const overlay = $('#manualResponseOverlay');
  const form = $('#manualResponseForm');
  const closeButton = $('#closeManualResponse');
  const saveButton = $('#saveManualResponse');
  if (!overlay || !form || !saveButton) throw new Error('Formulário de resposta manual ausente no index.html.');

  function close() {
    if (busy) return;
    overlay.classList.add('hidden');
    active = null;
    form.reset();
  }
  closeButton.addEventListener('click', close);
  $('#cancelManualResponse')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) { e.stopImmediatePropagation(); close(); }
  }, true);

  async function open(divergenceId) {
    if (busy) return;
    const user = auth.currentUser, profile = getProfile();
    if (!user || !canRecord(profile) || !activeProfile(profile)) {
      toast('Somente usuários ativos com permissão de registrar ocorrências podem responder.', true); return;
    }
    const snapshot = getSnapshot();
    const divergence = snapshot?.divs?.find(d => d.id === divergenceId);
    if (!divergence) { toast('Divergência não encontrada nos dados carregados.', true); return; }
    if (!divergence.passagemAbertaId) { toast('Esta divergência já foi respondida. Atualize o pacote se necessário.', true); return; }
    const passage = snapshot.passes.find(p => p.id === divergence.passagemAbertaId);
    if (!passage || passage.fimEm) { toast('Passagem aberta não disponível no pacote salvo. Atualize do Firebase.', true); return; }
    const startMs = ms(passage.inicioEm);
    if (!startMs) { toast('Não encontrei a data de abertura original. Atualize os dados.', true); return; }
    const sector = divergence.setorAtual || divergence.setor;
    if (!sectorTitle[sector]) { toast('Setor não reconhecido para esta divergência.', true); return; }
    active = { divergence, passage, sector, startMs, openToken: ++counter };
    form.reset();
    $('#manualResponseTitle').textContent = `Responder • NF ${divergence.numeroNf || '—'}`;
    $('#manualResponseSubtitle').textContent = `${divergence.tipoNome || 'Divergência'} • ${sectorTitle[sector]} • ${divergence.compradorNome || divergence.compradorAtualNome || 'Comprador não informado'}`;
    $('#manualResponseStart').textContent = formatDate(passage.inicioEm);
    $('#manualResponseAt').value = localDatetime(Date.now());
    $('#manualResponseAt').min = localDatetime(startMs);
    $('#manualResponseAt').max = localDatetime(Date.now());
    $('#manualResponseSelect').replaceChildren(new Option('Carregando respostas do setor...', ''));
    saveButton.disabled = true;
    overlay.classList.remove('hidden');
    try {
      const items = await responseOptions(sector);
      if (active?.openToken !== counter) return;
      $('#manualResponseSelect').replaceChildren(new Option('Selecione uma resposta cadastrada', ''),
        ...items.map(r => new Option(r.nome, r.id)));
      if (!items.length) toast('Não há respostas ativas cadastradas para este setor.', true);
      saveButton.disabled = items.length === 0;
    } catch (e) {
      console.error('[Comercial Resposta Manual] Catálogo:', e);
      toast('Falha ao buscar respostas. É necessário estar online para gravar.', true);
    }
  }

  function selected() {
    const list = active && responseCache.get(active.sector)?.items || [];
    return list.find(r => r.id === $('#manualResponseSelect').value);
  }
  function updateRequirement() {
    const required = isReturnToSupplier(selected() || {});
    $('#manualResponseNote').required = required;
    $('#manualResponseNoteLabel').textContent = required ? 'Justificativa — obrigatória para devolver e recusar' : 'Observação — opcional';
  }
  $('#manualResponseSelect').addEventListener('change', updateRequirement);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!active || busy) return;
    const user = auth.currentUser, profile = getProfile();
    if (!user || !canRecord(profile) || !activeProfile(profile)) return toast('Sua sessão não permite registrar respostas.', true);
    const { divergence, passage, sector, startMs } = active;
    const response = selected();
    const atRaw = $('#manualResponseAt').value;
    const happenedMs = new Date(atRaw).getTime();
    const note = safeText($('#manualResponseNote').value);
    if (!response || response.setor !== sector || response.ativo === false) return toast('Selecione uma resposta ativa do setor.', true);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(atRaw) || !Number.isFinite(happenedMs)) return toast('Informe data e hora válidas.', true);
    if (happenedMs < startMs) return toast('A resposta não pode ser anterior à abertura da passagem.', true);
    if (happenedMs > Date.now() + 59999) return toast('A resposta não pode estar no futuro.', true);
    if (isReturnToSupplier(response) && !note) return toast('Devolver e recusar exige uma justificativa.', true);
    if (!navigator.onLine) return toast('O painel offline permite consultar, mas precisa de conexão para registrar respostas.', true);
    const attributed = isCrfError(response) ? 'crf_erro' : sector;
    const text = note || `Resposta recebida: ${response.nome}.`;
    const time = Timestamp.fromDate(new Date(happenedMs));
    const name = clean(profile.nome || user.displayName || user.email || 'Operador');
    if (!confirm(`Confirmar retorno de ${sectorTitle[sector]} em ${formatDate(time)}?\nResposta: ${response.nome}\n\nO horário do WhatsApp será usado no cálculo. Seu registro ficará identificado na auditoria.`)) return;
    const divRef = doc(db, 'divergencias_v2', divergence.id);
    const passRef = doc(db, 'passagens_v2', passage.id);
    const noteRef = doc(db, 'notas_v2', divergence.chave);
    const responseRef = doc(db, 'respostas_v2', response.id);
    const eventRef = doc(collection(db, 'eventos_v2'));
    const savedAt = new Date().toISOString();
    busy = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Registrando...';
    try {
      await runTransaction(db, async tx => {
        const dSnap = await tx.get(divRef);
        const pSnap = await tx.get(passRef);
        const nSnap = await tx.get(noteRef);
        const rSnap = await tx.get(responseRef);
        if (!dSnap.exists() || !pSnap.exists() || !rSnap.exists()) throw new Error('Divergência, passagem ou resposta não encontrada. Atualize o relatório.');
        const d = dSnap.data(), p = pSnap.data(), r = rSnap.data();
        if (d.passagemAbertaId !== passage.id || p.fimEm || p.divergenciaId !== divergence.id || d.chave !== divergence.chave || p.chave !== divergence.chave) {
          throw new Error('Esta passagem já foi respondida ou alterada por outro usuário. Atualize do Firebase.');
        }
        if (r.ativo === false || r.setor !== sector || r.nome !== response.nome) throw new Error('Esta resposta foi alterada ou inativada no cadastro. Atualize a página.');
        const realStart = ms(p.inicioEm);
        if (!realStart || happenedMs < realStart) throw new Error('O horário é anterior à abertura real desta passagem.');
        if (happenedMs > Date.now() + 59999) throw new Error('Data/hora da resposta no futuro.');
        if (!nSnap.exists()) throw new Error('Nota principal não encontrada. Atualize do Firebase antes de responder.');
        const responseName = r.nome;
        tx.update(passRef, {
          fimEm: time, fechadoPor: user.uid, fechamento: 'resposta',
          respostaId: response.id, respostaNome: responseName, atribuicaoTempo: attributed
        });
        tx.update(divRef, {
          atualizadoEm: serverTimestamp(), ultimaOcorrenciaTexto: text, ultimaOcorrenciaEm: time,
          status: 'respondida', passagemAbertaId: null,
          ultimaRespostaId: response.id, ultimaRespostaNome: responseName,
          encerradoEm: time, revisao: increment(1)
        });
        tx.update(noteRef, {
          atualizadoEm: serverTimestamp(), ultimaAcao: 'responder', ultimaOcorrenciaTexto: text
        });
        tx.set(eventRef, {
          chave: divergence.chave, divergenciaId: divergence.id, acao: 'responder',
          setor: sector, compradorId: d.compradorAtualId || d.compradorId || '',
          compradorNome: d.compradorAtualNome || d.compradorNome || '',
          respostaId: response.id, respostaNome: responseName, atribuicaoTempo: attributed,
          passagemId: passage.id, texto: text,
          chamadoInfradeskId: p.chamadoInfradeskId || '',
          categoriaNota: d.categoriaNota || '', empresa: '',
          usuarioId: user.uid, usuarioNome: name, usuarioEmail: user.email || '',
          origem: 'site_manual', referencia: 'whatsapp',
          ocorridoEm: time, criadoEm: serverTimestamp(), registradoEm: serverTimestamp()
        });
      });
      // Dados do pacote local são atualizados sem baixar novamente o período inteiro.
      let localUpdated = true;
      try { await onSaved({
        divId: divergence.id, passId: passage.id, eventId: eventRef.id,
        setor: sector, time: new Date(happenedMs).toISOString(), registradoEm: savedAt,
        resposta: { id: response.id, nome: response.nome }, attributed, text,
        user: { uid: user.uid, nome: name, email: user.email || '' }
      }); } catch (localError) {
        console.warn('[Comercial] Resposta gravada no servidor, mas a cópia local não atualizou:', localError);
        localUpdated = false;
      }
      toast(localUpdated
        ? 'Resposta manual registrada! Relógio encerrado na data/hora informadas.'
        : 'Resposta gravada no Firebase, mas o pacote local não foi atualizado. Clique em Atualizar do Firebase.', !localUpdated);
      busy = false; close();
    } catch (err) {
      console.error('[Comercial Resposta Manual]', err);
      toast(err?.code === 'permission-denied' ? 'Permissão negada ao registrar. Confira seu perfil ativo e as regras atuais.' : (err.message || 'Falha ao salvar resposta.'), true);
    } finally {
      busy = false;
      saveButton.disabled = false;
      saveButton.textContent = 'Registrar resposta e encerrar relógio';
    }
  });
  return { open };
}
