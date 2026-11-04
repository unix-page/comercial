// ==UserScript==
// @name         Comercial • Infradesk • Registro de divergências V2.5.8 (KANBAN + SIGMA)
// @namespace    comercial/infradesk
// @version      2.5.8
// @description  Oficial: mesmas ocorrências no Kanban e na grade SIGMA; abertura do Comercial diretamente pela tabela; validação da fila 6.
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
    // Sem SDK: proteção restrita ao arraste com origem na fila 6.
    // Requer loader corrigido para voltar a autorizar saídas.
    let origin=null;
    const started=e=>{
      if (e.button != null && e.button!==0) return;
      const card=e.target instanceof Element?e.target.closest('.chamado-item[data-chamado-id]'):null;
      const col=card?.closest('ul.list-status-chamados[data-status-id]');
      origin=col?.getAttribute('data-status-id')==='6'
        ? {x:e.clientX,y:e.clientY,denied:false}:null;
    };
    const moving=e=>{
      if (!origin) return;
      const targetColumn=Array.from(document.querySelectorAll('.wrap-status'))
        .find(w=>{const r=w.getBoundingClientRect();return r.width>0&&r.height>0&&
          e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;})
        ?.querySelector('ul.list-status-chamados[data-status-id]')?.getAttribute('data-status-id');
      if (!targetColumn || targetColumn==='6') return;
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
      if (!origin.denied) {
        origin.denied=true;
        const box=document.createElement('div');
        box.textContent='Comercial indisponível. Não é permitido mover uma nota de Em Análise Terceiro. Recarregue o Infradesk ou procure o suporte.';
        box.style.cssText='position:fixed;top:18px;right:18px;z-index:2147483647;background:#a32236;color:white;padding:14px;border-radius:9px;max-width:420px;font:13px system-ui';
        document.body.appendChild(box);
        setTimeout(()=>box.remove(),6500);
      }
    };
    window.addEventListener('mousedown',e=>{
      started(e);
      if (!origin) return;
      // Bloqueia o Sortable antes da inicialização, mesmo sem SDK Firebase.
      if (e.target instanceof Element &&
          !e.target.closest('button,input,select,textarea,option,[contenteditable="true"]')) {
        if (e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
      }
    },{capture:true,passive:false});
    window.addEventListener('mousemove',moving,{capture:true,passive:false});
    window.addEventListener('mouseup',()=>{origin=null;},{capture:true});
    console.error('[Comercial V2.5.8] Firebase compat ausente: saída da fila 6 bloqueada até corrigir o loader.');
    return;
  }
  window.__COMERCIAL_APP_RUNNING__ = true;
  window.__COMERCIAL_APP_VERSION__ = '2.5.8';
  window.__COMERCIAL_TEST_BUILD__ = false;

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
  const NEW_DIVERGENCE_VALUE = '__comercial_abrir_nova__';
  const sectors = { fiscal:'Fiscal (Sicofe)', comercial:'Comercial', cadastro:'Cadastro' };
  const TTL = 15 * 60 * 1000;
  const CARD_CACHE_TTL = 5 * 60 * 1000;
  const CARD_CACHE_KEY = 'comercial_v2_card_cache_uid';
  const KANBAN_STATUS_ID = '6'; // Xabuia: Em Análise Terceiro.
  const KANBAN_STATUS_LABEL = 'em analise terceiro';
  // Proteção FAIL-CLOSED: não inicia Sortable na fila 6 sem autorização.
  // Cliques e ações continuam livres; uma tentativa de arraste exige validação.
  // A ordenação interna da fila 6 também aguarda validação (medida conservadora).
  const MOVE_CHECK_TTL_MS = 12000; // nova tentativa imediata após resposta, sem leituras por pixel
  const MOVE_ERROR_COOLDOWN_MS = 4500; // nova tentativa de conexão após curto intervalo
  const MOVE_SERVER_TIMEOUT_MS = 8000;
  const moveGate = { results: new Map(), pending: new Map(), gesture: null, startDenied: null };
  const moveDebug = {
    version:'2.5.8', windowCaptureActive:false, gestures:0, blocked:0,
    checks:0, dragStartDenied:0, lastEvent:'', lastOutcome:'', lastNote:''
  };
  window.__COMERCIAL_KANBAN_DIAGNOSTICO__ = moveDebug;
  const state = {
    user: null, profile: null, profileAt: 0,
    catalog: { types: [], responses: [], expiresAt: 0 },
    buyers: new Map(),
    card: null, data: null, supplier: null,
    divergences: [], selected: null, busy: false,
    viewToken: 0, mode: 'escolher', autoDetails: '',
    allBuyers: { items: [], expiresAt: 0, promise: null }, supplierSaving: false
  };

  function readCardCache() {
    try { return JSON.parse(localStorage.getItem(CARD_CACHE_KEY + '_' + (auth.currentUser?.uid || 'anon')) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeCardCache(cache) { try { localStorage.setItem(CARD_CACHE_KEY + '_' + (auth.currentUser?.uid || 'anon'), JSON.stringify(cache || {})); } catch (_) {} }
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
    const open = ordered.find(hasOpenDivergence);
    const chosen = open || ordered[0];
    const setorKey = chosen?.setorAtual || chosen?.setor || '';
    const setorNome = sectors[setorKey] || setorKey || 'Setor';
    const comprador = trim(chosen?.compradorAtualNome || chosen?.compradorNome || '');
    const abertas = ordered.filter(hasOpenDivergence).length;
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
    if (!isTargetCard(card)) { removeCardBox(card); return; }
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
    if (!isTargetCard(card)) { removeCardBox(card); return false; }
    const data = extract(card);
    if (!data) return false;
    const entry = cardCacheEntry(data.chave);
    if (!entry) { removeCardBox(card); return false; }
    renderCardBox(card, entry.summary);
    return Boolean(entry.summary);
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
    // Grade SIGMA: cada chamado é uma TR, e não um LI .chamado-item.
    // Os campos seguem exatamente o HTML da tabela que recebemos.
    if (card?.matches?.('#sigma-corpo-tabela tr[data-sigma-chamado-id]')) {
      const info=sigmaRowInfo(card);
      const parsed=parseKey(info?.key || '');
      if (!parsed) return null;
      const fornecedorNome=trim($('.sigma-fornecedor',card)?.textContent || 'Fornecedor não identificado');
      const tipo=trim($('.sigma-tipo strong',card)?.textContent || '');
      const status=trim($('.sigma-status-badge',card)?.textContent || '');
      return {
        ...parsed,
        chamadoInfradeskId: info.id,
        fornecedorNome,
        fornecedorTexto: fornecedorNome,
        fornecedorId: '',
        empresa: '', // A grade apresentada não informa a unidade.
        categoriaNota: tipo,
        statusInfradesk: status,
        descricaoInfradesk: ''
      };
    }
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
  // A coluna 3 do Kanban é identificada pelo ID 6, não pelo índice visual do card.
  function kanbanColumn(card) {
    return card?.closest?.('ul.list-status-chamados[data-status-id], ul[data-status-id]');
  }
  function isTargetCard(card) {
    const col = kanbanColumn(card);
    const id = trim(col?.getAttribute('data-status-id') || '');
    const desc = trim(col?.getAttribute('data-status-descricao') || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    return id === KANBAN_STATUS_ID || desc.includes(KANBAN_STATUS_LABEL);
  }
  function clearMoveCache(chave) {
    const key = onlyDigits(chave || '');
    if (key) moveGate.results.delete(key);
  }
  function hasOpenDivergence(data) {
    // Toda divergência sem resposta impede saída, inclusive registros legados.
    return Boolean(data && !isAnswered(data));
  }
  // Regra: uma divergência respondida comprova que foi aberta e depois encerrada.
  // Só libera se existe >=1, >=1 respondida e nenhuma pendente/aberta.
  function moveVerdict(key) {
    const uid=auth.currentUser?.uid;
    if (!uid) return {status:'login'};
    if (navigator.onLine === false) return {status:'offline'};
    const result=moveGate.results.get(key);
    if (!result || result.uid !== uid || Date.now() >= result.allowUntil) return {status:'consultar'};
    return result;
  }
  function moveMessage(verdict,nf) {
    const prefix=`NF ${nf}: `;
    switch(verdict?.status) {
      case 'login': return prefix+'você precisa estar logado no Comercial para mover esta nota de Em Análise Terceiro. Clique no ícone Comercial da nota e entre.';
      case 'perfil': return prefix+'sua conta Comercial não possui perfil ativo. A saída de Em Análise Terceiro está bloqueada.';
      case 'offline': return prefix+'sem conexão. Por segurança, não é possível sair de Em Análise Terceiro.';
      case 'erro': return prefix+'não foi possível confirmar as ocorrências no Comercial. Saída bloqueada; verifique a conexão e tente novamente.';
      case 'sem-registro': return prefix+'é obrigatório abrir pelo menos uma divergência no Comercial e registrar sua resposta antes de sair desta fila.';
      case 'sem-resposta': return prefix+'existe ocorrência registrada, mas nenhuma respondida/fechada no Comercial. A nota não pode sair desta fila.';
      case 'pendente': return prefix+`${verdict.open} ocorrência(s) aberta(s) no Comercial. Responda todas antes de sair desta fila.`;
      case 'consultar': return prefix+'validando sua sessão e ocorrências no Comercial. Aguarde a conferência e arraste novamente.';
      default: return prefix+'a movimentação não foi autorizada pelo Comercial.';
    }
  }
  async function verifyMoveByServer(chave) {
    const key=onlyDigits(chave);
    if (moveGate.pending.has(key)) return moveGate.pending.get(key);
    const uid=auth.currentUser?.uid;
    if (!uid || navigator.onLine === false) return null;
    const task=(async()=>{
      let timeoutId;
      try {
        const verified=await Promise.race([
          (async()=>{
            await loadProfile(true); // perfil atualizado no servidor, somente sob demanda
            if (auth.currentUser?.uid !== uid) throw new Error('Sessão Comercial alterada.');
            if (!state.profile || state.profile.ativo === false) return {status:'perfil'};
            const response=await db.collection('divergencias_v2').where('chave','==',key).get({source:'server'});
            if (auth.currentUser?.uid !== uid) throw new Error('Sessão Comercial alterada.');
            const rows=response.docs.map(snap=>({id:snap.id,...snap.data()}));
            const open=rows.filter(hasOpenDivergence).length;
            const answered=rows.filter(isAnswered).length;
            const summary=summarizeDivergences(rows,key);
            rememberCardSummary(key,summary);
            $$('.chamado-item[data-chamado-id]')
              .filter(card=>isTargetCard(card)&&extract(card)?.chave===key)
              .forEach(renderCardFromCache);
            const status=!rows.length?'sem-registro':open>0?'pendente':!answered?'sem-resposta':'permitido';
            return {status,total:rows.length,open,answered};
          })(),
          new Promise((_,reject)=>{
            timeoutId=setTimeout(()=>reject(new Error('Consulta excedeu o tempo limite.')),MOVE_SERVER_TIMEOUT_MS);
          })
        ]);
        if (auth.currentUser?.uid !== uid) return null;
        const result={...verified,uid,checkedAt:Date.now(),allowUntil:Date.now()+MOVE_CHECK_TTL_MS};
        moveGate.results.set(key,result);
        return result;
      } catch(error) {
        console.warn('[Comercial Kanban] Consulta obrigatória falhou. Saída bloqueada:',error);
        if (auth.currentUser?.uid !== uid) return null;
        const result={status:'erro',uid,checkedAt:Date.now(),allowUntil:Date.now()+MOVE_ERROR_COOLDOWN_MS};
        moveGate.results.set(key,result);
        return result;
      } finally { clearTimeout(timeoutId); }
    })().finally(()=>moveGate.pending.delete(key));
    moveGate.pending.set(key,task);
    return task;
  }

  // A página usa jQuery UI Sortable. Ao entrar em uma OUTRA coluna,
  // intercepta o mousemove em window/capture ANTES do Sortable no document.
  // Não intercepta cliques, pequenos movimentos ou a ordenação da própria fila.
  const MOVE_CONTROL = [
    '[data-action="mover"]', '[data-action="alterar-status"]',
    '[data-action="move"]', '[data-action="change-status"]',
    '[title*="Mover"]', '[title*="mover"]',
    '[aria-label*="Mover"]', '[aria-label*="mover"]',
    '.drag-handle', '.sortable-handle', '.move-handle'
  ].join(',');
  let lastMoveNotice={text:'',at:0};
  function moveNotice(message,isError=true) {
    if (lastMoveNotice.text===message && Date.now()-lastMoveNotice.at<2600) return;
    lastMoveNotice={text:message,at:Date.now()};
    alertUser(message,isError);
  }
  function blockEvent(event) {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation?.();
  }
  function gesturePoint(event) {
    const t=event.touches?.[0]||event.changedTouches?.[0]||event;
    return (Number.isFinite(t.clientX)&&Number.isFinite(t.clientY))?{x:t.clientX,y:t.clientY}:null;
  }
  function eventCard(target) {
    return target instanceof Element?target.closest('.chamado-item[data-chamado-id]'):null;
  }
  // Usar os limites reais das colunas, não um simples movimento do mouse.
  // Esta verificação acontece na CAPTURA, antes do Sortable do Infradesk.
  function moveDestinationColumn(at) {
    if (!at) return '';
    for (const wrapper of $$('.wrap-status')) {
      const list=wrapper.querySelector('ul.list-status-chamados[data-status-id]');
      if (!list) continue;
      const rect=wrapper.getBoundingClientRect();
      if (rect.width>0 && rect.height>0 &&
          at.x>=rect.left && at.x<=rect.right && at.y>=rect.top && at.y<=rect.bottom)
        return trim(list.getAttribute('data-status-id'));
    }
    return '';
  }
  const MOVE_DISTANCE = 8; // tolerância antes de considerar uma tentativa de arraste
  // TRAVA DE ORIGEM: bloquear o mousedown NA CAPTURA impede que o jQuery UI
  // Sortable inicialize _mouseStart(). Parar mousemove depois de iniciar o
  // Sortable NÃO garante que o evento de mouseup não grave o status remoto.
  // Os outros status não passam por esta guarda.
  function guardSortableStart(event) {
    if (event.button !== 0) return;
    const target=event.target instanceof Element ? event.target : null;
    const card=eventCard(target);
    if (!card || !isTargetCard(card)) return;
    // Elementos interativos não devem sofrer interferência no clique.
    // jQuery UI já ignora inputs/botões; manter abertura do Comercial intacta.
    if (target.closest('button,input,textarea,select,option,[contenteditable="true"]')) return;
    const data=extract(card);
    const verdict=data?.chave ? moveVerdict(data.chave) : {status:'chave-invalida'};
    if (verdict.status==='permitido') {
      moveGate.startDenied=null;
      moveDebug.lastOutcome='ARRASTE AUTORIZADO NA ORIGEM';
      return;
    }
    // Bloqueia a inicialização do Sortable, não apenas o movimento visual.
    blockEvent(event);
    const point=gesturePoint(event);
    moveGate.startDenied={key:data?.chave||'',nf:data?.numeroNf||'?',card,
      x:point?.x??0,y:point?.y??0,at:Date.now(),signaled:false};
    moveDebug.dragStartDenied++;
    moveDebug.lastEvent='mousedown / sortable cancelado ANTES de iniciar';
    moveDebug.lastOutcome=(verdict.status||'chave-invalida').toUpperCase()+' / bloqueado na origem';
    // A validação/aviso será disparada SOMENTE quando tentar arrastar para
    // fora da coluna. Um simples clique nunca dispara mensagem de bloqueio.
  }
  function inspectDeniedDrag(event) {
    const g=moveGate.startDenied;
    if (!g) return;
    const at=gesturePoint(event);
    if (!at) return;
    if (Math.hypot(at.x-g.x,at.y-g.y)<MOVE_DISTANCE) return;
    const destination=moveDestinationColumn(at);
    if (!destination || destination===KANBAN_STATUS_ID || g.signaled) return;
    g.signaled=true;
    // Nunca há movimento real: Sortable não recebeu o mousedown.
    if (!g.key) moveNotice('Comercial: chave de acesso não identificada. Movimentação bloqueada.');
    else {
      const verdict=moveVerdict(g.key);
      if (verdict.status==='consultar') requestMoveVerification(g.key,g.nf);
      else moveNotice(moveMessage(verdict,g.nf));
    }
  }
  function clearDeniedDrag() { moveGate.startDenied=null; }
  function beginMoveGesture(event) {
    if (event.button != null && event.button !== 0) return;
    const card=eventCard(event.target);
    // O controle também protege arrastes iniciados sobre títulos, links e ícones.
    // Um clique normal não alcança outra coluna e nunca dispara o bloqueio.
    if (!card||!isTargetCard(card)) {moveGate.gesture=null;return;}
    const data=extract(card),at=gesturePoint(event);
    if (!data?.chave || !at) {moveGate.gesture=null;return;}
    // pointerdown normalmente precede mousedown no mesmo gesto; manter a primeira origem.
    if (moveGate.gesture?.card===card && Date.now()-moveGate.gesture.started<350) return;
    moveGate.gesture={card,key:data.chave,nf:data.numeroNf,x:at.x,y:at.y,
      started:Date.now(),inspected:false,blocked:false};
    moveDebug.gestures++;
    moveDebug.lastEvent=event.type+' / origem fila 6';
  }
  function clearMoveGesture(event) {
    // Native DnD cancela o pointer mas não termina o arraste.
    if (moveGate.gesture?.nativeDragging &&
        ['pointercancel','pointerup','mouseup'].includes(event?.type)) return;
    moveGate.gesture=null;
  }
  function requestMoveVerification(key,nf) {
    if (moveGate.pending.has(key)) return;
    moveDebug.checks++;
    moveNotice(`NF ${nf}: conferindo login e ocorrências no Comercial. Aguarde para arrastar novamente.`,false);
    void verifyMoveByServer(key).then(result=>{
      if (!result) {moveDebug.lastOutcome='SESSÃO ALTERADA / bloqueado';return;}
      moveDebug.lastOutcome=result.status.toUpperCase()+' / '+(result.status==='permitido'?'liberado':'bloqueado');
      moveNotice(result.status==='permitido'
        ? `NF ${nf}: Comercial validado (${result.answered} ocorrência(s) respondida(s), nenhuma pendente). Pode arrastar agora.`
        :moveMessage(result,nf),result.status!=='permitido');
    }).catch(error=>console.warn('[Comercial Kanban]',error));
  }
  function checkMoveAttempt(event,key,nf,gesture=null) {
    const verdict=moveVerdict(key);
    if (verdict.status==='permitido') {
      moveDebug.lastOutcome='LOGIN + OCORRÊNCIAS VÁLIDAS / liberado';
      return false;
    }
    blockEvent(event);
    if (gesture) {
      if (gesture.inspected) return true;
      gesture.inspected=true;
    }
    moveDebug.blocked++;
    moveDebug.lastEvent=event.type;
    moveDebug.lastOutcome=verdict.status.toUpperCase()+' / bloqueado';
    moveDebug.lastNote=nf;
    if (verdict.status==='consultar') requestMoveVerification(key,nf);
    else moveNotice(moveMessage(verdict,nf));
    return true;
  }
  function guardMoveMotion(event) {
    const g=moveGate.gesture;
    if (!g) return;
    if (event.type!=='dragover' && event.buttons!=null && event.buttons===0 &&
        !event.type.startsWith('touch') && event.pointerType!=='touch') return;
    if (g.blocked) {blockEvent(event);return;}
    const destination=moveDestinationColumn(gesturePoint(event));
    // Não validar por pixel deslocado! Só quando o mouse realmente entra
    // na área de outra fila. Permite clique e ordenar dentro da fila 6.
    if (!destination || destination===KANBAN_STATUS_ID) return;
    if (checkMoveAttempt(event,g.key,g.nf,g)) g.blocked=true;
  }
  function guardNativeDrag(event) {
    if (event.type==='dragstart') {
      if (!moveGate.gesture) {
        // Arrastar texto selecionado pode produzir um Text node.
        const target=event.target instanceof Node && event.target.nodeType===3
          ? event.target.parentElement : event.target;
        const card=eventCard(target);
        if (card&&isTargetCard(card)) {
          const data=extract(card),at=gesturePoint(event);
          if (data?.chave) moveGate.gesture={card,key:data.chave,nf:data.numeroNf,
            x:at?.x??0,y:at?.y??0,started:Date.now(),inspected:false,blocked:false};
        }
      }
      if (moveGate.gesture) moveGate.gesture.nativeDragging=true;
      // Só existe tentativa de saída quando cruzar a fronteira da coluna.
      return;
    }
    if (event.type==='drop') {
      const g=moveGate.gesture;
      if (!g) return;
      const destination=moveDestinationColumn(gesturePoint(event));
      if (destination && destination!==KANBAN_STATUS_ID)
        checkMoveAttempt(event,g.key,g.nf,g);
      return;
    }
    guardMoveMotion(event);
  }
  function guardMoveControl(event) {
    const card=eventCard(event.target);
    if (!card||!isTargetCard(card)) return;
    const control=event.target instanceof Element?event.target.closest(MOVE_CONTROL):null;
    if (!control) return;
    // Não bloquear clique que somente abre um menu. Aqui precisa destino explícito.
    const destination=trim(control.getAttribute('data-target-status-id')||
      control.getAttribute('data-destino-status-id')||control.getAttribute('data-novo-status-id')||'');
    if (!destination||destination===KANBAN_STATUS_ID) return;
    const data=extract(card);
    if (data?.chave) checkMoveAttempt(event,data.chave,data.numeroNf);
  }
  function installKanbanProtection() {
    // CRÍTICO: registrar primeiro no capture, ANTES do handler do Sortable.
    window.addEventListener('mousedown',guardSortableStart,{capture:true,passive:false});
    for (const type of ['pointerdown','mousedown','touchstart'])
      window.addEventListener(type,beginMoveGesture,{capture:true,passive:true});
    window.addEventListener('pointermove',inspectDeniedDrag,{capture:true,passive:true});
    window.addEventListener('mousemove',inspectDeniedDrag,{capture:true,passive:true});
    window.addEventListener('mouseup',inspectDeniedDrag,{capture:true,passive:true});
    for (const type of ['pointerup','mouseup','pointercancel','touchend','touchcancel'])
      window.addEventListener(type,clearDeniedDrag,{capture:true,passive:true});
    for (const type of ['pointermove','mousemove','touchmove'])
      window.addEventListener(type,guardMoveMotion,{capture:true,passive:false});
    // Evitar limpar no pointerup antes do mouseup, que encerra o Sortable.
    for (const type of ['pointerup','mouseup','touchend','pointercancel','touchcancel','dragend'])
      window.addEventListener(type,clearMoveGesture,{capture:true,passive:true});
    window.addEventListener('dragstart',guardNativeDrag,{capture:true,passive:false});
    window.addEventListener('dragover',guardNativeDrag,{capture:true,passive:false});
    window.addEventListener('drop',guardNativeDrag,{capture:true,passive:false});
    window.addEventListener('click',guardMoveControl,{capture:true,passive:false});
    moveDebug.windowCaptureActive=true;
  }

  // ---------------------------------------------------------------------------
  // CONTROLE DA GRADE SIGMA — integração não invasiva com a interface de terceiros.
  // Usa o HTML disponível: #sigma-corpo-tabela, checkbox .sigma-check-item,
  // #sigma-feedback-status e #sigma-feedback-gravar.
  // Não altera eventos de detalhes, Comercial, Xabuia, feedback ou checkbox.
  // Não usa onSnapshot; consulta apenas NF selecionada para mudança de status.
  // Para garantia total de lotes, inserir a mesma verificação ANTES da chamada
  // à API no userscript que implementa "Ações em lote" (código não fornecido).
  // ---------------------------------------------------------------------------
  const sigmaGate = {
    selection:'', token:0, state:'livre', failures:[], pending:null, count:0,
    modalId:'', modalKey:'', modalProtected:false, modalNf:'',
    lastNotice:'', lastNoticeAt:0
  };
  const sigmaDebug = {
    version:'2.5.8', gradeDetected:false, selected:0, inThird:0,
    batchState:'livre', blocked:0, lastEvent:'', lastMessage:''
  };
  window.__COMERCIAL_SIGMA_DIAGNOSTICO__ = sigmaDebug;

  function sigmaRowStatus(row) {
    if (!row) return '';
    const badge=row.querySelector('.sigma-status-badge');
    const cls=badge?.className?.match?.(/(?:^|\s)status-(\d+)(?:\s|$)/);
    if (cls) return cls[1];
    const raw=row.getAttribute('data-sigma-assinatura') || '';
    if (raw) return raw.split('|')[1] || '';
    return /em an[aá]lise terceiro/i.test(badge?.textContent||'')?'6':'';
  }
  function sigmaRowInfo(row) {
    if (!row) return null;
    const id=row.getAttribute('data-sigma-chamado-id') || '';
    const raw=row.querySelector('[data-acao="copiar-chave"]')?.getAttribute('data-valor') ||
      row.querySelector('.sigma-chave-linha')?.getAttribute('title') ||
      row.querySelector('.sigma-chave-texto')?.textContent ||
      row.getAttribute('data-sigma-assinatura') || '';
    const keyMatch=String(raw).match(/\b\d{44}\b/);
    const key=keyMatch ? (parseKey(keyMatch[0])?.chave || '') : '';
    const nf=trim(row.querySelector('.sigma-nf-numero strong')?.textContent || '')
      .replace(/^NF\s*(?:N[ºo°.]*)?\s*:?\s*/i,'') || id;
    return {id,key,nf,status:sigmaRowStatus(row),row};
  }
  function sigmaRowById(id) {
    if (!id) return null;
    return $$('#sigma-corpo-tabela tr[data-sigma-chamado-id]')
      .find(row=>row.getAttribute('data-sigma-chamado-id')===id) || null;
  }
  function sigmaSelected() {
    return $$('#sigma-corpo-tabela .sigma-check-item:checked')
      .map(el=>sigmaRowInfo(el.closest('tr[data-sigma-chamado-id]'))).filter(Boolean);
  }
  function sigmaThirdSelected() {return sigmaSelected().filter(row=>row.status==='6');}
  function sigmaSelectionSignature(items) {
    return [auth.currentUser?.uid||'deslogado',
      ...items.map(x=>`${x.id}:${x.status}:${x.key}`).sort()].join('|');
  }
  function sigmaNotice(message,error=true) {
    if (!message) return;
    const now=Date.now();
    if (message===sigmaGate.lastNotice && now-sigmaGate.lastNoticeAt<2600) return;
    sigmaGate.lastNotice=message;sigmaGate.lastNoticeAt=now;
    sigmaDebug.lastMessage=message;
    moveNotice(message,error);
  }
  function sigmaBlockedReason(item,verdict) {
    if (!item.key) return `Chamado #${item.id}: chave de acesso ausente ou inválida. Não é possível validar a saída da fila 6.`;
    return moveMessage(verdict||{status:'erro'},item.nf||item.id);
  }
  function sigmaVerdict(item) {
    if (!item?.key) return {status:'erro'};
    return moveVerdict(item.key);
  }
  function sigmaBatchAllowed() {
    const rows=sigmaThirdSelected();
    if (!rows.length) return true; // sem notas da fila 6: não interferir.
    return sigmaGate.state==='liberado' &&
      sigmaGate.selection===sigmaSelectionSignature(sigmaSelected()) &&
      rows.every(item=>sigmaVerdict(item).status==='permitido');
  }
  function sigmaBatchMessage() {
    if (sigmaGate.failures.length) {
      const f=sigmaGate.failures;
      return `Ações em lote: ${f.length} nota(s) da fila Em Análise Terceiro não autorizada(s). `+
        f.slice(0,2).join(' ') + (f.length>2?` E mais ${f.length-2} bloqueio(s).`:'');
    }
    return sigmaGate.state==='conferindo'
      ? 'Ações em lote: conferindo o login e as ocorrências das notas da fila Em Análise Terceiro...'
      : 'Ações em lote: selecione apenas notas autorizadas a sair de Em Análise Terceiro.';
  }
  function sigmaIsBatchElement(node) {
    if (!(node instanceof Element) || !$('#sigma-corpo-tabela')) return false;
    const control=node.closest('button, a, select, [role="button"], [role="option"]');
    if (!control || control.closest('#sigma-corpo-tabela tr') || control.closest('.sigma-feedback-caixa')) return false;
    const attr=[control.id,control.className,control.getAttribute('data-acao'),
      control.getAttribute('name'),control.getAttribute('aria-label'),control.getAttribute('title'),
      control.closest('[id*="sigma-lote"], [class*="sigma-lote"], [id*="sigma-batch"], [class*="sigma-batch"]')?.className]
      .filter(Boolean).join(' ').toLowerCase();
    const title=trim(control.textContent||'').toLowerCase();
    // Sem HTML do cabeçalho do lote: procurar botões/menus de lote/status,
    // sem confundir ações individuais e filtros comuns do Infradesk.
    return /sigma/.test(attr) && /lote|batch|massa|status|mover|movimenta|finaliz/.test(attr+' '+title) ||
      /lote|batch|massa/.test(attr) ||
      /^(alterar status|mudar status|mover selecionad|finalizar selecionad)/.test(title);
  }
  function sigmaIsBatchStatusSelect(select) {
    if (!(select instanceof HTMLSelectElement) || select.id==='sigma-feedback-status') return false;
    const attrs=[select.id,select.name,select.className,
      select.closest('[id*="sigma-lote"], [class*="sigma-lote"], [id*="sigma-batch"], [class*="sigma-batch"]')?.id || ''].join(' ').toLowerCase();
    return /status/.test(attrs) && (/sigma|lote|batch|massa/.test(attrs));
  }
  function sigmaSetOptions(select,allowed) {
    if (!select) return;
    for (const option of Array.from(select.options)) {
      if (!option.hasAttribute('data-comercial-original-disabled'))
        option.setAttribute('data-comercial-original-disabled',option.disabled?'1':'0');
      const originallyDisabled=option.getAttribute('data-comercial-original-disabled')==='1';
      const next=originallyDisabled || (!allowed && option.value!=='6' && option.value!=='');
      if (option.disabled!==next) option.disabled=next;
    }
  }
  function sigmaSyncBatchControls() {
    if (!$('#sigma-corpo-tabela')) return;
    const selected=sigmaThirdSelected();
    const allowed=!selected.length || sigmaBatchAllowed();
    for (const select of Array.from(document.querySelectorAll('select')))
      if (sigmaIsBatchStatusSelect(select)) sigmaSetOptions(select,allowed);
  }
  async function sigmaVerifyBatch() {
    const items=sigmaSelected();
    const third=items.filter(x=>x.status==='6');
    const signature=sigmaSelectionSignature(items);
    sigmaDebug.selected=items.length;
    sigmaDebug.inThird=third.length;
    const stillCached=third.every(x=>sigmaVerdict(x).status!=='consultar');
    if (sigmaGate.selection===signature &&
      (sigmaGate.state==='conferindo' ||
        (stillCached && (sigmaGate.state==='liberado'||sigmaGate.state==='bloqueado')))) {
      sigmaSyncBatchControls();
      return sigmaGate.pending;
    }
    sigmaGate.token++;
    const token=sigmaGate.token;
    sigmaGate.selection=signature;
    sigmaGate.failures=[];
    sigmaGate.count=third.length;
    if (!third.length) {
      sigmaGate.state='livre';sigmaGate.pending=null;
      sigmaDebug.batchState='livre';sigmaSyncBatchControls();return;
    }
    sigmaGate.state='conferindo';
    sigmaDebug.batchState='conferindo';
    sigmaSyncBatchControls();
    if (!auth.currentUser?.uid || navigator.onLine===false) {
      sigmaGate.state='bloqueado';
      const msg=!auth.currentUser?.uid ? {status:'login'} : {status:'offline'};
      sigmaGate.failures=third.map(item=>sigmaBlockedReason(item,msg));
      sigmaDebug.batchState='bloqueado';
      sigmaSyncBatchControls();
      sigmaNotice(sigmaBatchMessage(),true);
      return;
    }
    const job=(async()=>{
      // Concorrência máxima 3: evita avalanche de reads no Firestore.
      let next=0;
      const reasons=[];
      const worker=async()=>{
        for (;;) {
          const index=next++;
          if (index>=third.length || token!==sigmaGate.token) return;
          const item=third[index];
          let verdict=sigmaVerdict(item);
          if (verdict.status==='consultar') verdict=await verifyMoveByServer(item.key);
          if (token!==sigmaGate.token) return;
          if (verdict?.status!=='permitido') reasons.push(sigmaBlockedReason(item,verdict));
        }
      };
      await Promise.all(Array.from({length:Math.min(3,third.length)},worker));
      if (token!==sigmaGate.token || sigmaSelectionSignature(sigmaSelected())!==signature) return;
      sigmaGate.failures=reasons;
      sigmaGate.state=reasons.length?'bloqueado':'liberado';
      sigmaDebug.batchState=sigmaGate.state;
      sigmaSyncBatchControls();
      if (reasons.length) sigmaNotice(sigmaBatchMessage(),true);
      else sigmaNotice(`${third.length} nota(s) da fila 6 validada(s). Ações em lote autorizadas.`,false);
    })().catch(err=>{
      if (token!==sigmaGate.token) return;
      sigmaGate.failures=['Erro ao conferir as notas selecionadas: '+err.message];
      sigmaGate.state='bloqueado';sigmaDebug.batchState='bloqueado';
      sigmaSyncBatchControls();
    }).finally(()=>{if(token===sigmaGate.token)sigmaGate.pending=null;});
    sigmaGate.pending=job;
    return job;
  }
  function sigmaModalContext() {
    const select=$('#sigma-feedback-status');
    if (!select || !$('#sigma-corpo-tabela')) return null;
    const title=trim($('#sigma-feedback-titulo')?.textContent || '');
    const id=title.match(/#(\d+)/)?.[1] || '';
    const item=sigmaRowInfo(sigmaRowById(id));
    return {select,id,item,
      protected: item ? item.status==='6' : select.value==='6',
      key:item?.key||'',nf:item?.nf||id};
  }
  function sigmaSyncModal() {
    const ctx=sigmaModalContext();
    if (!ctx) return;
    const changed=ctx.id!==sigmaGate.modalId || ctx.key!==sigmaGate.modalKey ||
      ctx.protected!==sigmaGate.modalProtected;
    sigmaGate.modalId=ctx.id;sigmaGate.modalKey=ctx.key;
    sigmaGate.modalNf=ctx.nf;sigmaGate.modalProtected=ctx.protected;
    let msgEl=$('#comercial-sigma-feedback-aviso');
    if (!ctx.protected) {
      sigmaSetOptions(ctx.select,true);
      msgEl?.remove();return;
    }
    const verdict=ctx.key?moveVerdict(ctx.key):{status:'erro'};
    const allowed=verdict.status==='permitido';
    sigmaSetOptions(ctx.select,allowed);
    if (!allowed && ctx.select.value!=='6') ctx.select.value='6';
    if (!msgEl) {
      msgEl=document.createElement('div');msgEl.id='comercial-sigma-feedback-aviso';
      msgEl.style.cssText='margin:6px 0 0;padding:7px 9px;border-radius:5px;font:12px/1.4 system-ui';
      ctx.select.insertAdjacentElement('afterend',msgEl);
    }
    msgEl.textContent=allowed
      ? `✓ Comercial validado: ${verdict.answered||1} ocorrência(s) respondida(s), nenhuma pendente. É permitido alterar o status.`
      : (verdict.status==='consultar'?'Conferindo login e ocorrências no Comercial...':sigmaBlockedReason({id:ctx.id,key:ctx.key,nf:ctx.nf},verdict));
    msgEl.style.background=allowed?'#e7f7ee':'#fff0f0';
    msgEl.style.color=allowed?'#196642':'#9b2334';
    if ((changed || verdict.status==='consultar') && verdict.status==='consultar' &&
        !moveGate.pending.has(ctx.key)) {
      void verifyMoveByServer(ctx.key).then(()=>sigmaSyncModal());
    }
  }
  function sigmaBlockModalAction(event) {
    const ctx=sigmaModalContext();
    if (!ctx?.protected || ctx.select.value==='6') return false;
    const verdict=ctx.key?moveVerdict(ctx.key):{status:'erro'};
    if (verdict.status==='permitido') return false;
    blockEvent(event);
    ctx.select.value='6';
    sigmaDebug.blocked++;sigmaDebug.lastEvent=event.type+' / feedback';
    sigmaSyncModal();
    sigmaNotice(sigmaBlockedReason({id:ctx.id,key:ctx.key,nf:ctx.nf},verdict));
    if (verdict.status==='consultar' && ctx.key)
      void verifyMoveByServer(ctx.key).then(()=>sigmaSyncModal());
    return true;
  }
  function sigmaHandleChange(event) {
    const target=event.target;
    if (!(target instanceof Element) || !$('#sigma-corpo-tabela')) return;
    if (target.matches('.sigma-check-lote, .sigma-check-item, #sigma-selecao-todos')) {
      queueMicrotask(()=>void sigmaVerifyBatch());
      return;
    }
    if (target.id==='sigma-feedback-status') {
      sigmaBlockModalAction(event);
      return;
    }
    if (sigmaIsBatchStatusSelect(target) && sigmaThirdSelected().length &&
        !sigmaBatchAllowed() && target.value!=='6' && target.value!=='') {
      blockEvent(event);
      // Opções não autorizadas não devem chegar ao código do SIGMA.
      target.value=Array.from(target.options).some(x=>x.value==='')?'':'6';
      sigmaDebug.blocked++;sigmaDebug.lastEvent='change / lote';
      sigmaNotice(sigmaBatchMessage());
      void sigmaVerifyBatch();
    }
  }
  // Enriquecimento opcional da grade com o HTML real do cartão Infradesk.
  // O mesmo endpoint é usado pelo próprio Infradesk para atualizar cartões.
  // Erro/permissão/timeout não impedem abrir o Comercial.
  async function enrichSigmaFromInfradesk(row) {
    const original = extract(row);
    if (!original?.chave || !original.chamadoInfradeskId || !window.fetch || !window.DOMParser) return;
    const token = state.viewToken;
    const id = original.chamadoInfradeskId;
    const abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timerId = abort ? setTimeout(()=>abort.abort(),3500) : null;
    try {
      const response = await fetch('/backend/chamados/card/' + encodeURIComponent(id), {
        credentials:'same-origin', ...(abort?{signal:abort.signal}:{})
      });
      if (!response.ok) return;
      const html = await response.text();
      const htmlDoc = new DOMParser().parseFromString(html,'text/html');
      const kanbanCard = htmlDoc.querySelector('.chamado-item[data-chamado-id]');
      if (!kanbanCard || kanbanCard.getAttribute('data-chamado-id')!==id) return;
      const full = extract(kanbanCard);
      if (!full || full.chave!==original.chave) return;
      if (token!==state.viewToken || state.data?.chave!==original.chave || state.data?.chamadoInfradeskId!==id) return;
      // Preencher somente campos ausentes da lista com informações do cartão real.
      for (const field of ['empresa','fornecedorId','descricaoInfradesk','categoriaNota','fornecedorTexto','fornecedorNome']) {
        if (!state.data[field] && full[field]) state.data[field]=full[field];
      }
      fillCardInfo(state.data);
      sigmaDebug.enriched=id;
    } catch (e) {
      console.debug('[Comercial SIGMA] Complemento de informações indisponível:',e?.message||e);
    } finally {if (timerId!==null) clearTimeout(timerId);}
  }

  // Ponte SIGMA -> modal Comercial já existente no Kanban. Sem outro login,
  // sem duplicar o modal e sem depender de API interna da extensão SIGMA.
  function sigmaOpenChamado(input) {
    // Aceita tanto a linha quanto o ID; mantém o mesmo painel do Kanban.
    const row=input instanceof Element
      ? (input.matches('tr[data-sigma-chamado-id]') ? input : input.closest('tr[data-sigma-chamado-id]'))
      : sigmaRowById(String(input ?? ''));
    if (!row) {
      moveNotice('Comercial: chamado não encontrado na grade SIGMA. Atualize a tabela.',true);
      return false;
    }
    if (!extract(row)) {
      moveNotice('Comercial: esta nota não possui uma chave de acesso válida de 44 dígitos.',true);
      return false;
    }
    sigmaDebug.lastEvent='abrir Comercial / grade SIGMA';
    sigmaDebug.lastOpened=row.getAttribute('data-sigma-chamado-id')||'';
    sigmaDebug.opens=(sigmaDebug.opens||0)+1;
    sigmaDebug.lastKeyFinal=extract(row)?.chave?.slice(-8)||'';
    // O modal é o MESMO do Kanban. A abertura não depende do login.
    try { if (!$('#comercial-v2-modal') && document.body) createUI(); }
    catch(error) { sigmaDebug.lastOpenError=error?.message||String(error); console.error('[Comercial SIGMA] Erro ao montar modal:',error); sigmaNotice('Comercial: erro ao montar janela: '+sigmaDebug.lastOpenError); return false; }
    console.info('[Comercial SIGMA] Abrindo chamado #'+sigmaDebug.lastOpened+' no modal original.');
    void openCard(row).catch(error=>{
      sigmaDebug.lastOpenError=error?.message||String(error);
      console.error('[Comercial SIGMA] Erro abrindo chamado:',error);
      sigmaNotice('Comercial: não foi possível abrir a janela ('+sigmaDebug.lastOpenError+').');
    });
    // A lista não possui necessariamente todos os campos do cartão do Kanban.
    // Buscar dados complementares sem atrasar a abertura nem salvar alterações.
    void enrichSigmaFromInfradesk(row);
    return true;
  }
  // API pública pequena para a extensão SIGMA também poder chamar diretamente.
  window.__COMERCIAL_SIGMA_BRIDGE__={
    version:'2.5.8',
    isReady:()=>Boolean($('#comercial-v2-modal')),
    openChamado:sigmaOpenChamado,
    abrir:sigmaOpenChamado,
    diagnostico:()=>({...sigmaDebug,app:window.__COMERCIAL_APP_VERSION__,modal:!!$('#comercial-v2-modal'),modalAberto:!!$('#comercial-v2-modal')?.classList.contains('open'),modalDisplay:$('#comercial-v2-modal')?getComputedStyle($('#comercial-v2-modal')).display:'ausente'})
  };
  // SIGMA pode instalar seu próprio handler de click ANTES do nosso.
  // A captura de pointerup é alternativa para o clique físico que um handler
  // anterior consumir; não interfere em cliques em outros botões, e não abre
  // quando há arrasto/seleção ou deslocamento do dedo/mouse.
  let sigmaComercialPress=null;
  let sigmaComercialLastOpen={id:'',at:0};
  function sigmaCommercialButton(targetOrEvent) {
    // composedPath permite reconhecer cliques em ícones SVG e em open Shadow DOM.
    const nodes=typeof targetOrEvent?.composedPath==='function'
      ? targetOrEvent.composedPath() : [targetOrEvent?.target||targetOrEvent];
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      const control = node.matches('[data-acao="comercial"]')
        ? node : node.closest('[data-acao="comercial"]');
      if (control && control.closest('tr[data-sigma-chamado-id]') &&
          control.closest('.sigma-grade, #sigma-corpo-tabela')) return control;
    }
    return null;
  }
  // Vinculação direta, como no Xabuia. O pointerdown no mouse abre ANTES do
  // evento click que o controlador SIGMA costuma consumir. No toque, aguarda o
  // click/pointerup para não disparar ao rolar a lista.
  // Mantém delegação e API pública como caminhos alternativos.
  function sigmaBindCommercialButtons() {
    const buttons=$$('#sigma-corpo-tabela tr[data-sigma-chamado-id] [data-acao="comercial"]');
    for (const button of buttons) {
      if (button.dataset.comercialBinding256==='1') continue;
      button.dataset.comercialBinding256='1';
      const invoke=(event)=>{
        const opened=sigmaOpenOnce(button);
        if (!opened) return;
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation?.();
        event.stopPropagation();
      };
      // Mouse físico: executa antes de qualquer delegação de click da SIGMA.
      button.addEventListener('pointerdown',event=>{
        if (event.button!==0 || (event.pointerType && event.pointerType!=='mouse')) return;
        sigmaDebug.lastInput='pointerdown-direto';
        invoke(event);
      },{capture:true});
      // Fallback para navegadores que não disparam Pointer Events.
      button.addEventListener('mousedown',event=>{
        if (window.PointerEvent || event.button!==0) return;
        sigmaDebug.lastInput='mousedown-direto';
        invoke(event);
      },{capture:true});
      button.addEventListener('click',event=>{
        sigmaDebug.lastInput='click-direto';
        invoke(event);
      },{capture:true});
      button.addEventListener('keydown',event=>{
        if (event.key!=='Enter' && event.key!==' ') return;
        sigmaDebug.lastInput='teclado-direto';
        invoke(event);
      },{capture:true});
    }
    sigmaDebug.buttonsFound=buttons.length;
    sigmaDebug.buttonsBound=buttons.filter(b=>b.dataset.comercialBinding256==='1').length;
  }
  // Vincula instantaneamente botões recém-desenhados. A grade SIGMA é
  // reconstruída por outro userscript e o scan geral tem debounce de 400 ms.
  let sigmaButtonObserver=null, sigmaObservedBody=null;
  function sigmaObserveButtons() {
    const body=$('#sigma-corpo-tabela');
    if (body===sigmaObservedBody) return;
    sigmaButtonObserver?.disconnect();
    sigmaObservedBody=body;
    if (!body) return;
    sigmaButtonObserver=new MutationObserver(mutations=>{
      if (mutations.some(m=>m.type==='childList')) sigmaBindCommercialButtons();
    });
    sigmaButtonObserver.observe(body,{subtree:true,childList:true});
    sigmaBindCommercialButtons();
  }
  function sigmaOpenOnce(button) {
    const id=button?.closest('tr[data-sigma-chamado-id]')?.getAttribute('data-sigma-chamado-id') || '';
    if (id && sigmaComercialLastOpen.id===id && Date.now()-sigmaComercialLastOpen.at<500 && $('#comercial-v2-modal')?.classList.contains('open')) return true;
    const opened=sigmaOpenChamado(button);
    if (opened) sigmaComercialLastOpen={id,at:Date.now()};
    return opened;
  }
  function sigmaHandlePointerDown(event) {
    const button=sigmaCommercialButton(event);
    if (!button || (event.button!=null && event.button!==0)) {sigmaComercialPress=null;return;}
    sigmaComercialPress={button,id:event.pointerId??null,x:event.clientX,y:event.clientY};
  }
  function sigmaHandlePointerUp(event) {
    const press=sigmaComercialPress;
    sigmaComercialPress=null;
    if (!press || (press.id!==null && event.pointerId!=null && event.pointerId!==press.id)) return;
    const button=sigmaCommercialButton(event);
    if (button!==press.button) return;
    if (Math.hypot(event.clientX-press.x,event.clientY-press.y)>12) return;
    // Abrir ANTES do click impede que um listener do SIGMA ocultando/consumindo
    // click deixe o usuário sem janela. O click subsequente é idempotente.
    sigmaOpenOnce(button);
  }
  function sigmaHandleClick(event) {
    const target=event.target;
    const openControl=sigmaCommercialButton(event);
    if (!openControl && (!(target instanceof Element) || !$('#sigma-corpo-tabela'))) return;
    if (openControl) {
      // Impedir o aviso antigo da extensão SIGMA quando ela tenta usar uma
      // função de abertura que não existe neste contexto.
      blockEvent(event);
      sigmaOpenOnce(openControl);
      return;
    }
    if (target.closest('[data-acao="feedback"]')) {
      // Não impedir abertura: apenas preparar a validação quando a janela aparecer.
      setTimeout(sigmaSyncModal,0);return;
    }
    if (target.closest('#sigma-feedback-gravar')) {
      sigmaBlockModalAction(event);return;
    }
    if (target.closest('#sigma-feedback-status')) {
      sigmaSyncModal();return;
    }
    if (target.closest('.sigma-check-lote, .sigma-check-item, #sigma-selecao-todos')) return;
    if (!sigmaThirdSelected().length) return;
    if (sigmaIsBatchElement(target) && !sigmaBatchAllowed()) {
      blockEvent(event);
      sigmaDebug.blocked++;sigmaDebug.lastEvent='click / lote';
      sigmaNotice(sigmaBatchMessage());
      void sigmaVerifyBatch();
    }
  }
  function sigmaHandleKeydown(event) {
    if (!['Enter',' '].includes(event.key)) return;
    const openControl=sigmaCommercialButton(event);
    if (openControl) {blockEvent(event);sigmaOpenOnce(openControl);return;}
    const target=event.target;
    if (!(target instanceof Element) || !$('#sigma-corpo-tabela')) return;
    if (target.id==='sigma-feedback-gravar') {sigmaBlockModalAction(event);return;}
    if (sigmaThirdSelected().length && sigmaIsBatchElement(target) && !sigmaBatchAllowed()) {
      blockEvent(event);sigmaDebug.blocked++;
      sigmaDebug.lastEvent='keydown / lote';
      sigmaNotice(sigmaBatchMessage());
      void sigmaVerifyBatch();
    }
  }
  function sigmaReset() {
    sigmaGate.token++;sigmaGate.selection='';sigmaGate.state='livre';
    sigmaGate.pending=null;sigmaGate.failures=[];
    sigmaGate.modalId='';sigmaGate.modalKey='';sigmaGate.modalProtected=false;
    sigmaDebug.batchState='livre';
  }
  function sigmaScan() {
    sigmaDebug.gradeDetected=Boolean($('#sigma-corpo-tabela'));
    if (!sigmaDebug.gradeDetected) return;
    sigmaObserveButtons();
    sigmaBindCommercialButtons();
    sigmaSyncModal();
    sigmaSyncBatchControls();
  }
  let sigmaHandlersInstalled=false;
  function installSigmaProtection() {
    if (sigmaHandlersInstalled) return;
    sigmaHandlersInstalled=true;
    window.addEventListener('change',sigmaHandleChange,{capture:true});
    window.addEventListener('pointerdown',sigmaHandlePointerDown,{capture:true,passive:true});
    window.addEventListener('pointerup',sigmaHandlePointerUp,{capture:true,passive:true});
    window.addEventListener('pointercancel',()=>{sigmaComercialPress=null;},{capture:true,passive:true});
    window.addEventListener('click',sigmaHandleClick,{capture:true});
    window.addEventListener('keydown',sigmaHandleKeydown,{capture:true});
    // A extensão SIGMA redesenha linhas/menus dinamicamente; scan() acompanha.
    console.info('[Comercial V2.5.8] Proteção da tabela SIGMA instalada. Diagnóstico: window.__COMERCIAL_SIGMA_DIAGNOSTICO__');
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
    updateManageSummary();
  }
  async function loadAllActiveBuyers(force=false) {
    const now=Date.now();
    if (!force && state.allBuyers.expiresAt>now) return state.allBuyers.items;
    if (state.allBuyers.promise) return state.allBuyers.promise;
    state.allBuyers.promise=(async()=>{
      const snap=await db.collection('compradores_v2').get();
      const items=snap.docs.map(d=>({id:d.id,...d.data()}))
        .filter(b=>b.ativo!==false).sort((a,b)=>trim(a.nome).localeCompare(trim(b.nome),'pt-BR'));
      state.allBuyers.items=items;
      state.allBuyers.expiresAt=Date.now()+TTL;
      items.forEach(b=>state.buyers.set(b.id,{value:b,expiresAt:Date.now()+TTL}));
      return items;
    })().finally(()=>{state.allBuyers.promise=null;});
    return state.allBuyers.promise;
  }
  function getSupplierName() {
    return trim(state.supplier?.razaoSocial || state.data?.fornecedorNome || '');
  }
  function updateManageSummary(){
    const button=$('#cv-manage-buyers');
    if (!button) return;
    const buyers=activeBuyers();
    button.textContent=`Vincular compradores ao CNPJ (${buyers.length})`;
    button.disabled=!canRecord() || state.busy || state.supplierSaving;
    const hint=$('#cv-supplier-hint');
    if(hint) hint.textContent=buyers.length
      ? `${buyers.map(b=>b.nome).join(' • ')}. Os vínculos valem para todos os setores.`
      : 'Nenhum comprador ativo vinculado. Use o botão para escolher compradores e confirmar a razão social.';
  }
  function renderSupplierBuyerChoices(items,selectedIds) {
    const search=trim($('#cv-manage-search')?.value||'').toLocaleLowerCase('pt-BR');
    const list=$('#cv-manage-list');
    if (!list) return;
    // Filtrar só a apresentação; checkboxes mantêm seleção no estado da janela.
    const filtered=items.filter(b=>trim(b.nome).toLocaleLowerCase('pt-BR').includes(search));
    list.replaceChildren();
    if (!filtered.length) {const p=document.createElement('p');p.textContent='Nenhum comprador ativo corresponde à busca.';list.append(p);return;}
    for(const buyer of filtered){
      const label=document.createElement('label');label.className='cv-manage-choice';
      const cb=document.createElement('input');cb.type='checkbox';cb.value=buyer.id;cb.checked=selectedIds.has(buyer.id);
      cb.addEventListener('change',()=>{if(cb.checked)selectedIds.add(buyer.id);else selectedIds.delete(buyer.id);});
      const span=document.createElement('span');span.textContent=buyer.nome;
      label.append(cb,span);list.append(label);
    }
  }
  function closeSupplierManager(){
    if(state.supplierSaving) return;
    $('#cv-manage-overlay')?.classList.remove('open');
  }
  async function openSupplierManager(){
    if (!canRecord() || !state.data || state.busy || state.supplierSaving) return;
    const overlay=$('#cv-manage-overlay');
    overlay.classList.add('open');
    $('#cv-manage-list').textContent='Carregando compradores ativos...';
    $('#cv-manage-cnpj').textContent=state.data.cnpj;
    $('#cv-manage-name').value=getSupplierName();
    $('#cv-manage-search').value='';
    const token=state.viewToken;
    try {
      const buyers=await loadAllActiveBuyers();
      if (token!==state.viewToken || !overlay.classList.contains('open')) return;
      const ids=new Set(state.supplier?.compradorIds||[]);
      // Armazena seleção sem depender do DOM filtrado.
      state.managerSelected=ids;
      renderSupplierBuyerChoices(buyers,ids);
      $('#cv-manage-search').oninput=()=>renderSupplierBuyerChoices(buyers,ids);
      $('#cv-manage-save').disabled=false;
    }catch(e){
      $('#cv-manage-list').textContent='Não foi possível carregar compradores: '+(e.message||e);
      $('#cv-manage-save').disabled=true;
    }
  }
  async function saveSupplierManager(){
    if (!canRecord() || !state.data || state.busy || state.supplierSaving || !state.managerSelected) return;
    const data=state.data;
    const name=trim($('#cv-manage-name').value);
    if(name.length<3 || name.length>200) return alertUser('Informe uma razão social com 3 a 200 caracteres.',true);
    const permitted=new Set(state.allBuyers.items.map(b=>b.id));
    const ids=[...state.managerSelected].filter(id=>permitted.has(id)).sort();
    if(ids.length>60) return alertUser('Vínculos demais. Limite de 60 compradores por fornecedor.',true);
    const supplierRef=db.collection('fornecedores_v2').doc(data.cnpj);
    const eventRef=db.collection('eventos_v2').doc();
    const beforeIds=(state.supplier?.compradorIds||[]).slice().sort();
    const beforeName=getSupplierName();
    if (JSON.stringify(ids)===JSON.stringify(beforeIds) && name===beforeName) {
      closeSupplierManager();alertUser('Os vínculos e a razão social já estavam atualizados.');return;
    }
    state.supplierSaving=true;
    const button=$('#cv-manage-save');button.disabled=true;button.textContent='Gravando...';
    try{
      await db.runTransaction(async tx=>{
        const snap=await tx.get(supplierRef);
        const old=snap.exists?snap.data():null;
        const actualIds=(old?.compradorIds||[]).slice().sort();
        if(JSON.stringify(actualIds)!==JSON.stringify(beforeIds) || trim(old?.razaoSocial||data.fornecedorNome)!==beforeName){
          throw Error('Outro operador modificou este fornecedor. Atualize os dados e tente novamente.');
        }
        const now=FV.serverTimestamp();
        const fields={cnpj:data.cnpj,razaoSocial:name,compradorIds:ids,origemRazaoSocial:name!==beforeName?'manual':(old?.origemRazaoSocial||'infradesk'),
          atualizadoEm:now,atualizadoPor:state.user.uid};
        if(old)tx.update(supplierRef,fields);
        else tx.set(supplierRef,{...fields,nomeInfradesk:data.fornecedorNome,ativo:true,criadoEm:now});
        const oldNames=beforeIds.map(id=>state.buyers.get(id)?.value?.nome || id);
        const newNames=ids.map(id=>state.buyers.get(id)?.value?.nome || id);
        tx.set(eventRef,{
          chave:data.chave,divergenciaId:'',acao:'vinculo_comprador',setor:'',
          texto:`Cadastro do fornecedor atualizado. Razão social: ${beforeName} → ${name}. Compradores anteriores: ${oldNames.join(', ')||'nenhum'}. Novos: ${newNames.join(', ')||'nenhum'}.`,
          cnpj:data.cnpj,razaoSocialAnterior:beforeName,razaoSocialNova:name,
          compradorIdsAnteriores:beforeIds,compradorIdsNovos:ids,
          chamadoInfradeskId:data.chamadoInfradeskId||'',empresa:data.empresa||'',categoriaNota:data.categoriaNota||'',
          usuarioId:state.user.uid,usuarioNome:trim(state.profile?.nome||state.user.displayName||state.user.email),usuarioEmail:state.user.email||'',criadoEm:now
        });
      });
      // Consulta só dos vínculos recém-salvos; sem reler todos os fornecedores.
      state.supplier={...(state.supplier||{}),cnpj:data.cnpj,razaoSocial:name,compradorIds:ids,origemRazaoSocial:name!==beforeName?'manual':(state.supplier?.origemRazaoSocial||'infradesk')};
      updateManageSummary();
      renderBuyers();
      $('#cv-manage-overlay').classList.remove('open');
      alertUser('Razão social e vínculos gravados. Comprador disponível para qualquer setor.');
    }catch(e){
      console.error('[Comercial V2.4.6] Erro ao vincular compradores:',e);
      alertUser(e?.code==='permission-denied'?'Permissão negada. Publique as regras novas do Firestore para permitir manutenção por operadores CRF.':(e.message||'Erro ao salvar fornecedor.'),true);
    }finally{state.supplierSaving=false;button.disabled=false;button.textContent='Salvar vínculos';}
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
      .chamado-item[data-comercial-status='aberta'] .comercial-box-head::after{content:'🔒';margin-left:4px;font-size:12px}
      .cv-backdrop{display:none;position:fixed;inset:0;z-index:2147483644;background:#111827a6;align-items:center;justify-content:center;padding:12px;font:13px system-ui,Arial;color:#18243a}
      #comercial-v2-modal.cv-backdrop.open{display:flex!important;visibility:visible!important;opacity:1!important}.cv-window{background:#fff;width:min(710px,100%);max-height:94vh;overflow:auto;border-radius:15px;box-shadow:0 22px 70px #0006}
      .cv-header{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid #e5e7eb}.cv-header img{width:42px;height:42px;border-radius:12px}.cv-header strong{font-size:18px}.cv-header small{display:block;color:#687386}.cv-header button{margin-left:auto}
      .cv-content{display:grid;gap:12px;padding:18px}.cv-info{border:1px solid #dbeafe;background:#eff6ff;color:#1e3a8a;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.6;overflow-wrap:anywhere}
      .cv-content label{display:grid;gap:5px;font-size:12px;font-weight:700}.cv-content select,.cv-content input,.cv-content textarea{box-sizing:border-box;width:100%;padding:9px 10px;color:#162238;background:white;border:1px solid #d4dce9;border-radius:8px;font:13px system-ui}
      .cv-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cv-card{padding:10px 12px;border:1px solid #e6eaf1;border-radius:9px;background:#f8fafc;line-height:1.55}
      .cv-hint{font-size:11px;color:#65758b;line-height:1.5}.cv-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e6eaf1;flex-wrap:wrap}.cv-button{padding:9px 12px;border:1px solid #d6deea;background:white;color:#1a2941;border-radius:8px;font:700 12px system-ui;cursor:pointer}.cv-button:disabled{opacity:.55;cursor:not-allowed}.cv-button.primary{background:#d91e74;border-color:#d91e74;color:#fff}.cv-login{display:grid;gap:10px;padding:10px 12px;border:1px solid #dbeafe;background:#f8fafc;border-radius:12px}
      .cv-session{padding:10px 12px;border-radius:12px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.cv-session.ok{background:#ecfdf3;color:#067647;border-color:#bbf7d0}.cv-session b{color:inherit}.cv-session small{color:inherit;opacity:.9}
      .cv-login-entry{padding:10px 12px;border:1px solid #dbeafe;background:#f8fafc;border-radius:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.cv-login-entry span{font-size:11px;color:#64748b}
      .cv-login-help{font-size:11px;line-height:1.5;color:#64748b}
      .cv-manage-toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
      .cv-manage-toolbar .cv-button{white-space:nowrap}
      .cv-manage-overlay{display:none;position:fixed;inset:0;z-index:2147483646;background:#0f172abf;align-items:center;justify-content:center;padding:14px;font:13px system-ui;color:#172033}
      .cv-manage-overlay.open{display:flex}.cv-manage-window{background:#fff;border-radius:16px;width:min(560px,100%);max-height:90vh;overflow:auto;box-shadow:0 22px 60px #0006;padding:18px;display:grid;gap:12px}
      .cv-manage-window h3{margin:0;font-size:17px}.cv-manage-window p{margin:0;color:#64748b;font-size:12px}
      .cv-manage-field{display:grid;gap:5px;font-weight:700;font-size:12px}.cv-manage-field input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d4dce9;border-radius:9px;font:13px system-ui}
      .cv-manage-list{max-height:270px;overflow:auto;padding:6px;border:1px solid #dbe3ee;border-radius:10px;display:grid;gap:1px}.cv-manage-choice{display:flex;align-items:center;gap:9px;padding:8px 10px;cursor:pointer;border-radius:7px;font-size:12px}.cv-manage-choice:hover{background:#fff1f7}.cv-manage-choice input{accent-color:#d91e74;width:16px;height:16px}
      .cv-manage-buttons{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
      /* V2.5.0: sessão compacta no cabeçalho; autenticação em janela dedicada. */
      .cv-header-copy{min-width:0;flex:1}.cv-header-copy strong{display:block;line-height:1.25}
      .cv-header-account{display:inline-flex;align-items:center;gap:6px;margin-top:5px;max-width:100%;font:600 11px system-ui;color:#92400e;overflow-wrap:anywhere}
      .cv-header-account:before{content:'';width:7px;height:7px;border-radius:50%;background:#d97706;flex:0 0 7px}
      .cv-header-account.is-on{color:#047857}.cv-header-account.is-on:before{background:#10b981}
      .cv-header-account.is-warning{color:#b45309}.cv-header-account.is-warning:before{background:#f59e0b}
      .cv-footer-account{margin-right:auto}.cv-auth-message{border:1px solid #dbeafe;border-radius:10px;background:#f8fbff;padding:12px 14px;color:#475569;font-size:12px;line-height:1.5}
      .cv-auth-overlay{display:none;position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.78);align-items:center;justify-content:center;padding:14px;font:13px system-ui,Arial;color:#172033}
      .cv-auth-overlay.open{display:flex}.cv-auth-window{width:min(480px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 24px 80px #0007}
      .cv-auth-head{display:flex;align-items:center;gap:11px;padding:20px 20px 16px;border-bottom:1px solid #e2e8f0}
      .cv-auth-head img{width:39px;height:39px;border-radius:11px;flex:0 0 auto}.cv-auth-head strong{display:block;font-size:17px}.cv-auth-head small{color:#64748b;display:block;font-size:12px;margin-top:2px}.cv-auth-head .cv-button{margin-left:auto}
      .cv-auth-body{padding:20px;display:grid;gap:14px}.cv-auth-body .cv-login-fields{display:grid;gap:12px}
      .cv-auth-body label{display:grid;gap:5px;font-size:12px;font-weight:700;color:#334155}
      .cv-auth-body input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#0f172a;font:13px system-ui}
      .cv-auth-body input:focus{outline:2px solid #f9a8d4;outline-offset:1px;border-color:#db2777}
      .cv-auth-intro{margin:0;color:#475569;font-size:12px;line-height:1.6}
      .cv-auth-footer{display:grid;gap:9px;padding:14px 20px 20px;border-top:1px solid #e2e8f0;background:#f8fafc}
      .cv-auth-footer .cv-button{width:100%;padding:11px 12px;font-size:13px}
      .cv-auth-footer .cv-auth-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}
      .cv-auth-footer .cv-google{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:white}
      .cv-auth-footer .cv-google-mark{font-weight:900;font-size:17px;color:#4285f4}
      .cv-auth-footer .cv-recover{border:none;background:transparent;color:#9d174d;padding:6px 8px;font-size:12px}
      .cv-auth-footer .cv-auth-cancel{color:#64748b;background:transparent}
      @media(max-width:480px){.cv-header{padding:12px}.cv-header img{width:36px;height:36px}.cv-header strong{font-size:16px}.cv-auth-footer .cv-auth-actions{grid-template-columns:1fr}.cv-footer-account{margin-right:0}}
      .cv-description{font-size:11px;color:#66768c;font-weight:400}.cv-pill{display:inline-flex;padding:3px 8px;border-radius:30px;background:#fff0f6;color:#a51d62;font-size:11px;font-weight:700}.cv-hidden{display:none!important}
      .comercial-box{clear:both;margin:9px 0 10px;padding:0;border:1px solid rgba(217,30,116,.18);background:#fff;border-radius:12px;color:#172033;font-size:12px;line-height:1.35;overflow:hidden;box-shadow:0 10px 22px rgba(15,23,42,.10)}.comercial-box-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;font-weight:900;color:#fff;background:linear-gradient(135deg,#d91e74,#fb7185)}.comercial-box-title{display:inline-flex;align-items:center;gap:6px;min-width:0}.comercial-box-title img{width:18px;height:18px;border-radius:5px;flex:0 0 auto}.comercial-chip{display:inline-flex;align-items:center;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:900;background:rgba(255,255,255,.96);color:#be185d;border:1px solid rgba(255,255,255,.65);white-space:nowrap}.comercial-box-body{padding:8px 9px 9px;background:#f8fafc;border-left:4px solid #d91e74}.comercial-last-text{margin-top:3px;padding:6px 7px;border-radius:9px;background:#fff;border:1px solid #e2e8f0;color:#334155;overflow-wrap:anywhere;white-space:pre-wrap}.comercial-box small{color:#64748b;display:block;margin-top:5px}.comercial-box.comercial-status-em_crf .comercial-box-head{background:linear-gradient(135deg,#2563eb,#38bdf8)}.comercial-box.comercial-status-respondida .comercial-box-head{background:linear-gradient(135deg,#067647,#12b76a)}.comercial-box.comercial-status-concluida .comercial-box-head{background:linear-gradient(135deg,#067647,#12b76a)}.comercial-box.comercial-status-devolucao .comercial-box-head{background:linear-gradient(135deg,#b42318,#ef4444)}
      .chamado-item[data-comercial-status='aberta']{border-left:4px solid #d91e74!important}.chamado-item[data-comercial-status='em_crf']{border-left:4px solid #2563eb!important}.chamado-item[data-comercial-status='respondida']{border-left:4px solid #12b76a!important}.chamado-item[data-comercial-status='concluida']{border-left:4px solid #12b76a!important}.chamado-item[data-comercial-status='devolucao']{border-left:4px solid #ef4444!important}@media(max-width:620px){.cv-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
    const modal = document.createElement('div');
    modal.id = 'comercial-v2-modal'; modal.className = 'cv-backdrop';
    modal.innerHTML = `<div class="cv-window" role="dialog" aria-modal="true" aria-label="Comercial V2">
      <div class="cv-header"><img src="${ICON}" alt=""><div class="cv-header-copy"><strong>Abrir Comercial</strong><small>NF • Divergência Comercial <span style="color:#ad1465;font-weight:800">• Versão 2.5.8 TESTE</span></small><div id="cv-session-text" class="cv-header-account" aria-live="polite">Verificando login...</div></div><button class="cv-button" id="cv-close" type="button" aria-label="Fechar Comercial">✕</button></div>
      <div class="cv-content">
        <div class="cv-info" id="cv-info"></div>
        <a id="cv-history-link" class="cv-button" style="text-align:center;display:block;text-decoration:none" target="_blank" rel="noopener noreferrer" href="https://unix-page.github.io/comercial/">Ver linha do tempo completa desta NF ↗</a>
        <div class="cv-manage-toolbar"><button type="button" class="cv-button" id="cv-manage-buyers">Vincular compradores ao CNPJ</button><span id="cv-supplier-hint" class="cv-hint">Carregando fornecedor...</span></div>
        <div id="cv-auth-prompt" class="cv-auth-message cv-hidden">Para abrir ou responder divergências, entre na sua conta Comercial pelo botão <b>Entrar no Comercial</b> no rodapé.</div>
        <div id="cv-form" class="cv-hidden" style="display:grid;gap:12px">
          <label>Divergência da nota<select id="cv-div"><option value="">Selecione o que deseja fazer...</option></select></label>
          <div id="cv-current" class="cv-card cv-hidden"></div>
          <div class="cv-grid" id="cv-target"><label>Setor responsável<select id="cv-sector"><option value="">Selecione</option><option value="comercial">Comercial</option><option value="fiscal">Fiscal (Sicofe)</option><option value="cadastro">Cadastro</option></select></label><label id="cv-type-wrap">Tipo de divergência<select id="cv-type"><option value="">Selecione</option></select></label></div>
          <label id="cv-buyer-wrap">Comprador responsável<select id="cv-buyer"><option value="">Selecione</option></select></label>
          <label id="cv-response-wrap" class="cv-hidden">Resposta recebida do setor<select id="cv-response"><option value="">Selecione uma resposta</option></select></label>
          <label id="cv-details-wrap"><span id="cv-details-title">Observação / detalhes (opcional)</span><textarea id="cv-text" rows="3" placeholder="Observação adicional, se necessário..."></textarea><span id="cv-description-preview" class="cv-description"></span></label>
          <p class="cv-hint" id="cv-hint">Registrar no Comercial não altera o chamado original do Infradesk.</p>
        </div>
      </div>
      <div class="cv-buttons"><button type="button" class="cv-button cv-footer-account cv-hidden" id="cv-login-toggle">Entrar no Comercial</button><button type="button" class="cv-button cv-footer-account cv-hidden" id="cv-logout">Sair / trocar conta</button><button type="button" class="cv-button" id="cv-refresh">Atualizar dados desta nota</button><button type="button" class="cv-button" id="cv-cancel">Cancelar</button><button type="button" class="cv-button primary cv-hidden" id="cv-save" disabled>Salvar ocorrência</button></div>
    </div>`;
    document.body.appendChild(modal);
    const loginOverlay=document.createElement('div');
    loginOverlay.id='cv-auth-overlay';loginOverlay.className='cv-auth-overlay';
    loginOverlay.innerHTML=`<div class="cv-auth-window" role="dialog" aria-modal="true" aria-labelledby="cv-auth-title">
      <div class="cv-auth-head"><img src="${ICON}" alt=""><div><strong id="cv-auth-title">Entrar no Comercial</strong><small>Acesso independente do Infradesk</small></div><button type="button" class="cv-button" id="cv-auth-close" aria-label="Fechar janela de login">✕</button></div>
      <div class="cv-auth-body"><p class="cv-auth-intro" id="cv-login-status">Entre com a conta utilizada no Comercial para registrar ou responder divergências.</p><div id="cv-login-fields" class="cv-login-fields"></div><span class="cv-login-help">Use as credenciais do <b>Comercial</b>, não as do Infradesk. Por segurança, digite o e-mail e a senha nesta janela.</span></div>
      <div class="cv-auth-footer"><div class="cv-auth-actions"><button class="cv-button primary" id="cv-email-login" type="button">Entrar com e-mail</button><button class="cv-button cv-google" id="cv-google-login" type="button"><span class="cv-google-mark">G</span> Entrar com Google</button></div><button class="cv-button cv-recover" id="cv-reset-password" type="button">Definir / recuperar minha senha</button><button type="button" class="cv-button cv-auth-cancel" id="cv-auth-cancel">Voltar ao chamado</button></div>
    </div>`;
    document.body.appendChild(loginOverlay);
    $('#cv-auth-close').onclick=clearLoginFields;
    $('#cv-auth-cancel').onclick=clearLoginFields;
    // Não fechar com clique fora. Fechamento apenas pelos botões explícitos.
    const manage=document.createElement('div');
    manage.id='cv-manage-overlay';manage.className='cv-manage-overlay';
    manage.innerHTML=`<div class="cv-manage-window" role="dialog" aria-modal="true" aria-label="Compradores do fornecedor">
      <h3>Compradores vinculados ao CNPJ</h3><p>CNPJ: <b id="cv-manage-cnpj"></b>. Vínculos válidos para divergências Comercial, Fiscal e Cadastro.</p>
      <label class="cv-manage-field">Razão social cadastrada<input id="cv-manage-name" maxlength="200" placeholder="Razão social do fornecedor"></label>
      <label class="cv-manage-field">Pesquisar compradores ativos<input id="cv-manage-search" placeholder="Digite o nome para filtrar, sem perder as seleções"></label>
      <div id="cv-manage-list" class="cv-manage-list"></div>
      <p>Marque para vincular e desmarque para desvincular. Registros históricos anteriores não são reclassificados automaticamente. <a href="https://unix-page.github.io/comercial/admin.html" target="_blank" rel="noopener noreferrer">Cadastrar novo comprador no administrador ↗</a></p>
      <div class="cv-manage-buttons"><button id="cv-manage-cancel" class="cv-button" type="button">Cancelar</button><button id="cv-manage-save" class="cv-button primary" type="button">Salvar vínculos</button></div>
    </div>`;
    document.body.appendChild(manage);
    $('#cv-manage-buyers').onclick=openSupplierManager;
    $('#cv-manage-cancel').onclick=closeSupplierManager;
    $('#cv-manage-save').onclick=saveSupplierManager;
    manage.addEventListener('click',e=>{if(e.target===manage)closeSupplierManager();});
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
      try { await loadProfile(true); state.catalog.expiresAt = 0; state.buyers.clear(); state.allBuyers.expiresAt=0; await loadForm(); alertUser('Cadastros e divergências atualizados.'); }
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
        toggleLoginPanel();
        alertUser('Sessão do Comercial encerrada. Escolha como entrar.');
      } catch (e) { alertUser('Não consegui sair: ' + (e.message || 'erro desconhecido'), true); }
      finally { button.disabled = false; }
    };
  }
  function clearLoginFields() {
    $('#cv-auth-overlay')?.classList.remove('open');
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
    const overlay=$('#cv-auth-overlay');
    if (!overlay) return;
    if (overlay.classList.contains('open')) return;
    mountLoginFields();
    $('#cv-login-status').textContent = 'Acesse sua conta do Comercial para registrar ou responder divergências nesta nota.';
    overlay.classList.add('open');
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
  // V2.5.8: compatibilidade com a grade SIGMA. O modal já recebia a
  // classe open, mas o CSS da página podia manter display:none. Uma regra
  // inline com !important, aplicada APENAS na abertura, tem precedência sobre
  // as folhas de estilo da grade. Na saída restauramos o estilo anterior.
  function setComercialModalVisible(visible) {
    const modal=$('#comercial-v2-modal');
    if (!modal) return false;
    if (visible) {
      // Evita que um painel/pai oculto esconda a janela.
      if (modal.parentElement!==document.body) document.body.appendChild(modal);
      modal.classList.add('open');
      modal.style.setProperty('display','flex','important');
      modal.style.setProperty('visibility','visible','important');
      modal.style.setProperty('opacity','1','important');
      modal.style.setProperty('pointer-events','auto','important');
      modal.style.setProperty('position','fixed','important');
      modal.style.setProperty('z-index','2147483644','important');
    } else {
      modal.classList.remove('open');
      for (const property of ['display','visibility','opacity','pointer-events','position','z-index']) {
        modal.style.removeProperty(property);
      }
    }
    return true;
  }
  function close(force = false) {
    if (state.busy && force !== true) return;
    setComercialModalVisible(false);
    clearLoginFields();
    state.card = null; state.data = null; state.selected = null; state.viewToken++;
    $('#cv-manage-overlay')?.classList.remove('open');
    $('#cv-auth-overlay')?.classList.remove('open');
  }
  // Fonte única de dados visuais do modal, para Kanban e grade SIGMA.
  function fillCardInfo(data) {
    const info = $('#cv-info');
    if (!info || !data) return;
    info.innerHTML = `<div><b>Chave:</b> ${escape(data.chave)}</div>
      <div><b>NF:</b> ${escape(data.numeroNf)} • <b>CNPJ:</b> ${escape(data.cnpj)}</div>
      <div><b>Infradesk:</b> ${escape(data.chamadoInfradeskId||'—')} • ${escape(data.statusInfradesk||'—')}</div>
      <div><b>Empresa:</b> ${escape(data.empresa||'—')}</div>
      <div><b>Categoria da nota:</b> ${escape(data.categoriaNota||'—')}</div>
      <div><b>Fornecedor:</b> ${escape(data.fornecedorTexto||data.fornecedorNome||'—')}</div>`;
  }
  async function openCard(card) {
    const data = extract(card);
    if (!data) { alertUser('Chave de NF-e ausente ou inválida. Confira os 44 dígitos.',true); return; }
    const token = ++state.viewToken;
    state.card = card; state.data = data; state.selected = null; state.autoDetails = ''; state.mode = 'escolher';
    fillCardInfo(data);
    $('#cv-text').value = '';
    $('#cv-history-link').href = 'https://unix-page.github.io/comercial/?nf=' + encodeURIComponent(data.chave);
    setComercialModalVisible(true);
    $('#cv-form').classList.add('cv-hidden');
    $('#cv-save').disabled = true;
    $('#cv-save').classList.add('cv-hidden');
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
    const logged = !!user;
    const allowed = canRecord();
    line.classList.toggle('is-on', allowed);
    line.classList.toggle('is-warning', logged && !allowed);
    const login = $('#cv-login-toggle');
    const logout = $('#cv-logout');
    login?.classList.toggle('cv-hidden', logged);
    logout?.classList.toggle('cv-hidden', !logged);
    if (!logged) {
      line.textContent = 'Não conectado ao Comercial';
      line.title = 'Entre com Google ou e-mail/senha do Comercial';
      return;
    }
    const nome = trim(profile?.nome || user.displayName || user.email || 'Usuário');
    const papel = trim(profile?.papel || 'sem perfil');
    line.textContent = allowed ? `Conectado: ${nome} • ${papel}`
      : `Conectado: ${nome} • ${!profile ? 'sem cadastro de perfil' : profile.ativo === false ? 'conta inativa' : 'perfil sem permissão'}`;
    line.title = `${nome}${user.email ? '\n' + user.email : ''}\nPerfil: ${papel}`;
  }
  async function loadForm() {
    const allowed = canRecord();
    renderSession();
    updateManageSummary();
    if (state.user) clearLoginFields();
    const prompt=$('#cv-auth-prompt');
    prompt.classList.toggle('cv-hidden', allowed);
    if (!allowed) {
      prompt.textContent = !state.user
        ? 'Para abrir ou responder divergências, entre no Comercial pelo botão no rodapé.'
        : !state.profile
          ? 'Esta conta está conectada, mas não possui perfil cadastrado no Comercial. Use Sair / trocar conta no rodapé.'
          : state.profile.ativo === false
            ? 'Sua conta Comercial está inativa. Não é possível registrar ou responder divergências.'
            : 'Seu perfil não possui permissão para registrar ou responder divergências.';
      $('#cv-form').classList.add('cv-hidden');
      $('#cv-save').disabled = true;
      $('#cv-save').classList.add('cv-hidden');
      return;
    }
    $('#cv-form').classList.remove('cv-hidden');
    $('#cv-save').disabled = true;
    $('#cv-save').classList.add('cv-hidden');
    await Promise.all([loadCatalog(),loadNote()]);
    const summary = summarizeDivergences(state.divergences, state.data?.chave);
    rememberCardSummary(state.data?.chave, summary);
    renderCardBox(state.card, summary);
    const dropdown=$('#cv-div');
    dropdown.replaceChildren(new Option('Selecione o que deseja fazer...',''));
    dropdown.add(new Option('+ Abrir nova divergência',NEW_DIVERGENCE_VALUE));
    for (const d of state.divergences) {
      const label = `${d.tipoNome||'Divergência'} • ${statusTitle(d)} • ${d.compradorNome||sectors[d.setor]||'—'}`;
      dropdown.add(new Option(label,d.id));
    }
    dropdown.value=''; // Exige decisão explícita mesmo com divergências abertas.
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
    const choice=$('#cv-div').value;
    const waiting = choice === '';
    const closed = Boolean(d && !d.passagemAbertaId);
    const mode = state.mode = waiting ? 'escolher' : choice === NEW_DIVERGENCE_VALUE ? 'abrir' : closed ? 'visualizar' : d ? 'responder' : 'escolher';
    const opening = mode === 'abrir';
    const responding = mode === 'responder';
    $('#cv-target').classList.toggle('cv-hidden',!opening);
    $('#cv-type-wrap').classList.toggle('cv-hidden',!opening);
    $('#cv-response-wrap').classList.toggle('cv-hidden',!responding);
    $('#cv-buyer-wrap').classList.toggle('cv-hidden',!opening);
    $('#cv-details-wrap').classList.toggle('cv-hidden',!opening && !responding);
    $('#cv-save').classList.toggle('cv-hidden',!opening && !responding);
    $('#cv-save').disabled = (!opening && !responding) || !canRecord();
    $('#cv-save').textContent = opening ? 'Abrir divergência' : 'Registrar resposta';
    $('#cv-text').required = false;
    $('#cv-details-title').textContent = 'Observação / detalhes (opcional)';
    $('#cv-text').placeholder = 'Observação adicional, se necessário...';
    $('#cv-description-preview').textContent = '';
    if (opening) { renderTypes(); renderBuyers(); fillTypeDescription(); }
    if (responding) renderResponses();
    $('#cv-hint').textContent = waiting
      ? 'Escolha uma opção acima: abrir uma nova divergência ou selecionar uma existente para responder. Nenhuma ação está selecionada automaticamente.'
      : closed
        ? 'Esta divergência já foi respondida e está apenas para consulta. Para registrar outro problema, escolha “+ Abrir nova divergência”.'
        : responding
          ? 'Selecione a resposta deste setor. Registrar resposta encerra a passagem e para o relógio.'
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
    $('#cv-buyer-wrap').classList.toggle('cv-hidden',state.mode!=='abrir');
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
      return alertUser(action === 'escolher' ? 'Primeiro selecione uma divergência existente ou a opção de abrir nova.' : 'Esta ocorrência já foi respondida. Para outro problema, abra uma nova divergência.',true);
    }
    const sector=$('#cv-sector').value, typeId=$('#cv-type').value;
    const buyerId=$('#cv-buyer').value, responseId=$('#cv-response').value;
    let details=trim($('#cv-text').value);
    const opening=action==='abrir';
    const type=state.catalog.types.find(x=>x.id===typeId);
    const buyer=state.buyers.get(buyerId)?.value || null;
    const response=state.catalog.responses.find(x=>x.id===responseId);
    if (opening && ($('#cv-div').value !== NEW_DIVERGENCE_VALUE || old)) return alertUser('Selecione “+ Abrir nova divergência”.',true);
    if (!opening && (!old || $('#cv-div').value !== old.id || !old.passagemAbertaId)) return alertUser('Esta divergência não tem relógio aberto. Atualize os dados.',true);
    if (opening && (!type || type.ativo===false || type.setor!==sector)) return alertUser('Escolha um tipo de divergência ativo deste setor.',true);
    if (opening && !sectors[sector]) return alertUser('Escolha o setor responsável.',true);
    if (opening && (!buyer || buyer.ativo===false || !(state.supplier?.compradorIds||[]).includes(buyerId))) {
      return alertUser('Associe este CNPJ a um comprador ativo e selecione-o. Vale para qualquer setor: Comercial, Fiscal e Cadastro.',true);
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

        const buyerName=opening?(buyer?.nome||''):'';
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
            compradorId:buyerId,compradorNome:buyerName,
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
      clearMoveCache(state.data?.chave);
      rememberCardSummary(state.data?.chave,summary);
      renderCardBox(state.card,summary);
      alertUser(opening?'Divergência aberta. O relógio iniciou.':'Resposta registrada. Divergência respondida; relógio encerrado.');
      close(true);
    } catch(e) {
      console.error('[Comercial V2.5.0] Erro ao salvar:',e);
      alertUser(e?.code==='permission-denied'?'Acesso negado. Verifique as regras do Firestore.':(e.message||'Falha ao salvar'),true);
    } finally {
      state.busy=false;
      $('#cv-save').disabled=!canRecord() || !['abrir','responder'].includes(state.mode);
      $('#cv-save').textContent=state.mode==='abrir'?'Abrir divergência':'Registrar resposta';
    }
  }
  function removeFromOtherColumns(card) {
    $$('.comercial-v2-button',card).forEach(button => button.remove());
    removeCardBox(card);
  }
  function addButton(card) {
    if (!isTargetCard(card)) { removeFromOtherColumns(card); return; }
    if ($('.comercial-v2-button',card)) return;
    if (!extract(card)) return; // Só o HTML, sem leitura do Firebase.
    const toolbar=$('.list-toolbar .toolbar-atendente',card)||$('.toolbar-atendente',card)||$('.list-toolbar',card)||card;
    const button=document.createElement('button');
    button.type='button';button.className='comercial-v2-button';button.title='Comercial obrigatório para sair de Em Análise Terceiro';
    const icon=document.createElement('img');icon.src=ICON;icon.alt='Comercial';button.append(icon);
    button.onclick=e=>{e.preventDefault();e.stopPropagation();openCard(card);};
    const anchor=$('.btn-anexo',toolbar);
    if(anchor?.parentElement) anchor.insertAdjacentElement('beforebegin',button);
    else toolbar.append(button);
  }
  function scan() {
    $$('.chamado-item[data-chamado-id]').forEach(card=>{
      if (!isTargetCard(card)) { removeFromOtherColumns(card); return; }
      addButton(card);
      // Só cache local CONHECIDO: não dispara consulta em massa nem vigia cards alheios.
      renderCardFromCache(card);
    });
    sigmaScan();
  }
  let timer=null;
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(scan,400);});
  auth.onAuthStateChanged(async user=>{
    if (!user || state.user?.uid!==user.uid) {
      state.user=user;state.profile=null;state.profileAt=0;
      state.catalog.expiresAt=0;state.buyers.clear();
      moveGate.results.clear(); moveGate.pending.clear(); moveGate.gesture = null; moveGate.startDenied=null;
      sigmaReset();
      $$('.comercial-box').forEach(box=>box.remove());
    }
    // Sem leituras automáticas por card: até perfil só é carregado ao abrir o Comercial.
    renderSession();
    scan();
  });
  // Instalar captura antes que outro userscript intercepte o clique da grade.
  installSigmaProtection();
  function boot() {
    createUI();
    scan();
    observer.observe(document.body,{childList:true,subtree:true});
    installKanbanProtection();
    installSigmaProtection();
    console.info('[Comercial V2.5.8] Oficial carregado. Modal:',!!$('#comercial-v2-modal'),'• SIGMA:', !!$('#sigma-corpo-tabela'),'• Ponte:', window.__COMERCIAL_SIGMA_BRIDGE__?.isReady());
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
