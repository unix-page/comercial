// Comercial V2.4.0 — cálculos puros: sem Firebase, sem listeners.
export const ms = value => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  const parsed = value instanceof Date ? value.getTime() : (typeof value === 'number' ? value : new Date(value).getTime());
  return Number.isFinite(parsed) ? parsed : 0;
};
export const elapsed = (start, end) => Math.max(0, ms(end) - ms(start));
export function unionMs(intervals) {
  const valid = intervals.map(p => [ms(p.inicioEm), ms(p.fimEm)]).filter(([a,b]) => a > 0 && b >= a).sort((a,b) => a[0]-b[0]);
  if (!valid.length) return 0;
  let [from,to] = valid[0], total = 0;
  for (let i=1;i<valid.length;i++) {
    const [a,b] = valid[i];
    if (a > to) { total += to-from; from=a; to=b; }
    else to=Math.max(to,b);
  }
  return total + to-from;
}
export function noteTimes(divergencias, passagens, now=Date.now()) {
  const starts = [...divergencias.map(d => ms(d.criadoEm)),...passagens.map(p => ms(p.inicioEm))].filter(Boolean);
  const first = starts.length ? Math.min(...starts) : 0;
  const pending = divergencias.some(d => (d.status === 'aberta' && !!d.passagemAbertaId) || (d.status==='em_crf' && !d.ultimaRespostaId && !d.ultimaRespostaNome)) || passagens.some(p => !p.fimEm);
  const ends = [...divergencias.map(d => ms(d.encerradoEm||d.resolvidoEm||d.ultimaOcorrenciaEm||d.atualizadoEm)),...passagens.map(p => ms(p.fimEm))].filter(Boolean);
  const last = pending ? now : (ends.length ? Math.max(...ends) : 0);
  const completed = passagens.filter(p=>p.inicioEm && p.fimEm);
  const sumPassagesMs = completed.reduce((sum,p)=>sum+elapsed(p.inicioEm,p.fimEm),0);
  // Tempo efetivamente pendente: união de passagens, incluindo as ainda abertas até agora.
  // Não inclui intervalos entre ocorrências em que nenhuma divergência estava pendente.
  const pendingMs = unionMs(passagens.map(p=>({inicioEm:p.inicioEm,fimEm:p.fimEm||new Date(now)})));
  const bySector = {};
  const byAttribution = {};
  for (const p of completed) {
    const duration = elapsed(p.inicioEm,p.fimEm);
    const key = p.setor || 'nao_informado';
    const attributed = p.atribuicaoTempo === 'crf_erro' ? 'crf_erro' : key;
    const s = bySector[key] || (bySector[key]={ms:0,passagens:0});
    s.ms += duration;s.passagens++;
    const a = byAttribution[attributed] || (byAttribution[attributed]={ms:0,passagens:0});
    a.ms += duration;a.passagens++;
  }
  return {
    first, last, pending, calendarMs: first && last >= first ? last-first : 0,
    sumPassagesMs, pendingMs, unionPassagesMs: unionMs(completed),
    bySector, byAttribution, openPassages: passagens.filter(p=>!p.fimEm).length,
    completedPassages: completed.length
  };
}
export function effectiveStatus(d) {
  return d && (d.status==='respondida'||(d.status==='em_crf'&&!d.passagemAbertaId&&(d.ultimaRespostaId||d.ultimaRespostaNome)))?'respondida':d?.status||'';
}
export function countGroups(rows, getName, getNote = row => row.chave) {
  const map = new Map();
  for (const row of rows) {
    const name = String(getName(row) || 'Não informado').trim();
    const it = map.get(name) || { name, divergencias: 0, notes:new Set() };
    it.divergencias++;if(getNote(row)) it.notes.add(getNote(row));map.set(name,it);
  }
  return [...map.values()].map(v=>({name:v.name,divergencias:v.divergencias,notas:v.notes.size})).sort((a,b)=>b.divergencias-a.divergencias || a.name.localeCompare(b.name,'pt-BR'));
}
export function buyerTimeGroups(divergencias, passagens) {
  const map = new Map(), ids=new Set(divergencias.map(d=>d.id));
  for (const p of passagens) {
    if (!ids.has(p.divergenciaId) || p.setor!=='comercial') continue;
    const key = p.compradorId || p.compradorNome || '(sem comprador)';
    const v = map.get(key) || {nome:p.compradorNome||'(sem comprador)',notas:new Set(),passagens:0,ms:0,erroCrfMs:0};
    v.passagens++;if (p.chave) v.notas.add(p.chave);
    if(p.fimEm) {
      const duration=elapsed(p.inicioEm,p.fimEm);
      if (p.atribuicaoTempo === 'crf_erro') v.erroCrfMs += duration;
      else v.ms += duration;
    }
    map.set(key,v);
  }
  return [...map.values()].map(v=>({...v,notas:v.notas.size})).sort((a,b)=>b.ms-a.ms);
}
