// Comercial V2.5.6 — corrigir atribuição sem reescrever fatos históricos.
// Só consulta compradores ao abrir esta tela; cache durante 15 minutos.
import { auth, db, activeProfile, canRecord, collection, doc, runTransaction, increment, serverTimestamp } from './firebase-core.js';
import { getDocsFromServer } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
const $ = selector => document.querySelector(selector);
const TTL = 15 * 60 * 1000;
const clean = v => String(v ?? '').trim().replace(/\s+/g,' ');
let cache = { until: 0, rows: [] };
let active = null;
let busy = false;
let openSequence = 0;

async function activeBuyers() {
  if (Date.now() < cache.until) return cache.rows;
  const snap = await getDocsFromServer(collection(db, 'compradores_v2'));
  const rows = snap.docs.map(x => ({ id:x.id, ...x.data() }))
    .filter(x => x.ativo !== false && clean(x.nome).length >= 2)
    .sort((a,b) => clean(a.nome).localeCompare(clean(b.nome),'pt-BR'));
  cache = { until:Date.now() + TTL, rows };
  return rows;
}
export function setupBuyerCorrection({ getSnapshot, getProfile, onSaved, toast }) {
  const overlay = $('#buyerCorrectionOverlay');
  const form = $('#buyerCorrectionForm');
  const save = $('#saveBuyerCorrection');
  if (!overlay || !form || !save) throw new Error('Janela de correção de comprador ausente. Atualize index.html.');

  function close() {
    if (busy) return;
    overlay.classList.add('hidden');
    form.reset();
    active = null;
    openSequence++;
  }
  $('#closeBuyerCorrection').addEventListener('click',close);
  $('#cancelBuyerCorrection').addEventListener('click',close);
  overlay.addEventListener('click',e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown',e => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
      e.stopImmediatePropagation(); close();
    }
  },true);

  async function open(id) {
    if (busy) return;
    const user = auth.currentUser;
    if (!user || !activeProfile(getProfile()) || !canRecord(getProfile())) {
      toast('Sua conta não tem permissão para corrigir compradores.',true);return;
    }
    const snap = getSnapshot();
    const divergence = snap?.divs?.find(d => d.id === id);
    if (!divergence) { toast('Divergência não encontrada no pacote local.',true); return; }
    const token = ++openSequence;
    active = { divergence, passageIds: snap.passes.filter(p => p.divergenciaId===id).map(p=>p.id), token };
    form.reset();
    $('#buyerCorrectionSubtitle').textContent=`NF ${divergence.numeroNf || '—'} • ${divergence.tipoNome || 'Divergência'} • ${divergence.setor || 'Setor'}`;
    $('#buyerCorrectionCurrent').textContent=clean(divergence.compradorNome || divergence.compradorAtualNome || 'Não informado');
    $('#buyerCorrectionSelect').replaceChildren(new Option('Carregando compradores ativos...',''));
    save.disabled=true;
    overlay.classList.remove('hidden');
    try {
      const rows = await activeBuyers();
      if (active?.token !== token) return;
      const select=$('#buyerCorrectionSelect');
      select.replaceChildren(new Option('Selecione o comprador correto',''), ...rows.map(x=>new Option(x.nome,x.id)));
      save.disabled=!rows.length;
      if (!rows.length) toast('Nenhum comprador ativo disponível.',true);
    } catch(e) {
      console.error('[Comercial Corrigir Comprador] Lista:',e);
      toast('Não foi possível buscar compradores ativos. Verifique conexão e permissões.',true);
    }
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || !active) return;
    const user=auth.currentUser, profile=getProfile();
    if (!user || !activeProfile(profile) || !canRecord(profile)) return toast('Sessão sem permissão.',true);
    const {divergence,passageIds}=active;
    const buyerId=$('#buyerCorrectionSelect').value;
    const chosen=cache.rows.find(x=>x.id===buyerId);
    const reason=clean($('#buyerCorrectionReason').value).slice(0,500);
    if (!chosen || chosen.ativo===false) return toast('Escolha um comprador ativo.',true);
    if (reason.length<5) return toast('Explique o motivo em pelo menos 5 caracteres.',true);
    if (!navigator.onLine) return toast('A correção precisa de conexão. Os relatórios podem continuar offline.',true);
    const oldBuyerId=divergence.compradorAtualId || divergence.compradorId || '';
    const oldBuyerName=clean(divergence.compradorAtualNome || divergence.compradorNome || 'Não informado');
    if (oldBuyerId===chosen.id) return toast('Este comprador já está atribuído à divergência.',true);
    const msg=`Corrigir somente a divergência “${divergence.tipoNome}” da NF ${divergence.numeroNf}?\n\nDe: ${oldBuyerName}\nPara: ${chosen.nome}\n\nO histórico anterior será preservado. Os tempos não serão alterados.`;
    if (!confirm(msg)) return;
    const divRef=doc(db,'divergencias_v2',divergence.id);
    const buyerRef=doc(db,'compradores_v2',chosen.id);
    const passRefs=passageIds.map(pid=>doc(db,'passagens_v2',pid));
    const eventRef=doc(collection(db,'eventos_v2'));
    const operator=clean(profile.nome || user.displayName || user.email || 'Usuário');
    const changedAt=new Date().toISOString();
    busy=true;save.disabled=true;save.textContent='Corrigindo...';
    try {
      await runTransaction(db,async tx=>{
        // Firestore exige todas as leituras antes das gravações.
        const dSnap=await tx.get(divRef);
        const bSnap=await tx.get(buyerRef);
        const passSnaps=[];
        for (const ref of passRefs) passSnaps.push(await tx.get(ref));
        if (!dSnap.exists() || !bSnap.exists()) throw Error('Divergência ou comprador não encontrado. Atualize do Firebase.');
        const serverD=dSnap.data(), serverBuyer=bSnap.data();
        if (serverBuyer.ativo===false || clean(serverBuyer.nome)!==clean(chosen.nome)) throw Error('Cadastro do comprador mudou. Reabra a correção.');
        if (serverD.chave!==divergence.chave || Number(serverD.revisao || 0)!==Number(divergence.revisao || 0)) throw Error('Outro operador alterou a ocorrência. Atualize do Firebase.');
        if ((serverD.compradorAtualId || serverD.compradorId || '') !== oldBuyerId) throw Error('O comprador foi alterado por outro operador. Atualize os dados.');
        if (Number(serverD.passagensCount || 0)>passRefs.length) throw Error('O pacote está incompleto. Clique em Atualizar do Firebase antes de corrigir.');
        for (const p of passSnaps) {
          if (!p.exists() || p.data().divergenciaId!==divergence.id || p.data().chave!==divergence.chave) throw Error('Passagem alterada ou ausente. Atualize os dados.');
        }
        const prevName=clean(serverD.compradorAtualNome || serverD.compradorNome || 'Não informado');
        tx.update(divRef,{
          compradorId:chosen.id, compradorNome:chosen.nome,
          compradorAtualId:chosen.id, compradorAtualNome:chosen.nome,
          compradorCorrigidoEm:serverTimestamp(), revisao:increment(1)
        });
        for (const ref of passRefs) tx.update(ref,{compradorId:chosen.id,compradorNome:chosen.nome});
        tx.set(eventRef,{
          chave:divergence.chave, divergenciaId:divergence.id,
          acao:'corrigir_comprador', setor:serverD.setor || '',
          compradorAnteriorId:serverD.compradorAtualId || serverD.compradorId || '',
          compradorAnteriorNome:prevName,
          compradorId:chosen.id,compradorNome:chosen.nome,
          texto:`Comprador corrigido: ${prevName} → ${chosen.nome}. Motivo: ${reason}`,
          motivo:reason,origem:'site_correcao_comprador',
          usuarioId:user.uid,usuarioNome:operator,usuarioEmail:user.email || '',
          criadoEm:serverTimestamp(),registradoEm:serverTimestamp()
        });
      });
      let localOk=true;
      try {
        await onSaved({divId:divergence.id,passageIds,eventId:eventRef.id,
          oldBuyerId,oldBuyerName,newBuyerId:chosen.id,newBuyerName:chosen.nome,
          reason, changedAt,operator:{uid:user.uid,nome:operator,email:user.email||''}});
      } catch(e){localOk=false;console.warn('[Comercial] Correção no Firestore salva, mas cache local não atualizado:',e);}
      busy=false;close();
      toast(localOk ? 'Comprador corrigido! Relatórios recalculados localmente.' : 'Comprador corrigido no Firebase. Recarregue o pacote para atualizar os gráficos.',!localOk);
    } catch(e) {
      console.error('[Comercial Corrigir Comprador] Gravação:',e);
      toast(e?.code==='permission-denied'?'Permissão negada. Publique as regras atualizadas da correção de comprador.':(e.message || 'Não foi possível corrigir.'),true);
    } finally { busy=false;save.disabled=false;save.textContent='Confirmar comprador correto'; }
  });
  return {open};
}
