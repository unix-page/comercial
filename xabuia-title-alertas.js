/*
 * Xabuia • Alertas simples no título do navegador
 * Versão: 1.0.0
 *
 * O que faz:
 * - Soma os contadores da tela: #countAberto + #countReaberto.
 * - Atualiza o título do navegador: "(N) Xabuia 1.0".
 * - Quando o número aumenta, pisca o título por alguns segundos.
 *
 * Importante:
 * - Não abre listener novo no Firestore.
 * - Não aumenta leituras.
 * - Usa apenas os contadores que o app.js já renderiza na tela.
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const COUNT_ABERTO_ID = 'countAberto';
  const COUNT_REABERTO_ID = 'countReaberto';
  const CHECK_EVERY_MS = 1500;
  const BLINK_EVERY_MS = 800;
  const BLINK_DURATION_MS = 12000;

  const originalTitle = cleanTitle(document.title || 'Xabuia');

  let lastTotal = null;
  let blinkTimer = null;
  let blinkStopTimer = null;
  let blinkOn = false;

  function cleanTitle(title) {
    return String(title || 'Xabuia')
      .replace(/^\(\d+\)\s+/, '')
      .replace(/^🔔\s+\d+\s+novo(?:s)?\s+•\s+/, '')
      .trim() || 'Xabuia';
  }

  function numberFromElement(id) {
    const el = document.getElementById(id);
    const text = String(el?.textContent || '').replace(/\D+/g, '');
    const value = Number.parseInt(text || '0', 10);
    return Number.isFinite(value) ? value : 0;
  }

  function currentOpenReopenedTotal() {
    return numberFromElement(COUNT_ABERTO_ID) + numberFromElement(COUNT_REABERTO_ID);
  }

  function normalTitle(total = currentOpenReopenedTotal()) {
    return total > 0 ? `(${total}) ${originalTitle}` : originalTitle;
  }

  function stopBlink() {
    if (blinkTimer) window.clearInterval(blinkTimer);
    if (blinkStopTimer) window.clearTimeout(blinkStopTimer);
    blinkTimer = null;
    blinkStopTimer = null;
    blinkOn = false;
    document.title = normalTitle();
  }

  function startBlink(total) {
    stopBlink();

    blinkTimer = window.setInterval(() => {
      blinkOn = !blinkOn;
      document.title = blinkOn ? `🔔 ${total} novos • ${originalTitle}` : normalTitle(total);
    }, BLINK_EVERY_MS);

    blinkStopTimer = window.setTimeout(stopBlink, BLINK_DURATION_MS);
  }

  function refreshTitle() {
    const total = currentOpenReopenedTotal();

    if (lastTotal !== null && total > lastTotal) {
      startBlink(total);
    } else if (!blinkTimer) {
      document.title = normalTitle(total);
    }

    lastTotal = total;
  }

  function observeCounter(id) {
    const el = document.getElementById(id);
    if (!el) return null;

    const observer = new MutationObserver(refreshTitle);
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    return observer;
  }

  function boot() {
    const observers = [observeCounter(COUNT_ABERTO_ID), observeCounter(COUNT_REABERTO_ID)].filter(Boolean);

    // Primeiro refresh não pisca. Só define o título inicial.
    lastTotal = currentOpenReopenedTotal();
    document.title = normalTitle(lastTotal);

    const interval = window.setInterval(refreshTitle, CHECK_EVERY_MS);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) stopBlink();
      refreshTitle();
    });

    window.addEventListener('beforeunload', () => {
      window.clearInterval(interval);
      observers.forEach((observer) => observer.disconnect());
      stopBlink();
    });

    window.XABUIA_TITLE_ALERTS = {
      version: VERSION,
      refresh: refreshTitle,
      stop: stopBlink,
      total: currentOpenReopenedTotal
    };

    console.log(`[Xabuia] Alertas no título v${VERSION} carregado. Conta apenas abertos + reabertos, sem listener extra no Firestore.`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
