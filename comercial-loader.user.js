// ==UserScript==
// @name         Comercial • Loader oficial dinâmico
// @namespace    comercial/infradesk
// @version      2.1.0
// @description  Loader fixo: carrega sempre a versão publicada de comercial.js, sem eval. Google/e-mail no contexto da página.
// @author       Comercial
// @match        https://*.infradesk.app/backend/chamados*
// @run-at       document-end
// @noframes
// @sandbox      raw
// @icon         https://unix-page.github.io/comercial/comercial.png
// @homepageURL  https://unix-page.github.io/comercial/
// @updateURL    https://unix-page.github.io/comercial/comercial-loader.user.js
// @downloadURL  https://unix-page.github.io/comercial/comercial-loader.user.js
// @grant        none
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js
// ==/UserScript==
(function () {
  'use strict';

  const LOADER_VERSION = '2.1.0';
  const REMOTE_JS = 'https://unix-page.github.io/comercial/comercial.js';
  const ICON = 'https://unix-page.github.io/comercial/comercial.png';
  const ERROR_ID = 'comercial-loader-error';
  const STYLE_ID = 'comercial-v2-modal';
  const PREFIX = '[Comercial Loader]';

  if (window.__COMERCIAL_LOADER_PAGE_CONTEXT_ACTIVE__) {
    console.info(PREFIX, 'Já está ativo nesta página.');
    return;
  }
  window.__COMERCIAL_LOADER_PAGE_CONTEXT_ACTIVE__ = true;
  window.__COMERCIAL_LOADER_VERSION__ = LOADER_VERSION;
  window.__COMERCIAL_REMOTE_LOADER_ACTIVE__ = true;
  window.__COMERCIAL_APP_EXECUTION_MODE__ = 'script-tag-dinamico';
  // Este loader NUNCA vincula uma versão específica de comercial.js.
  // Atualizar somente comercial.js no GitHub Pages para alterar o aplicativo.

  function isReady() {
    return Boolean(window.__COMERCIAL_APP_RUNNING__ && document.getElementById(STYLE_ID));
  }
  function removeError() {
    document.getElementById(ERROR_ID)?.remove();
  }
  function firebaseReady() {
    return Boolean(window.firebase && firebase.auth && firebase.firestore);
  }
  function reportError(reason) {
    removeError();
    const node = document.createElement('div');
    node.id = ERROR_ID;
    node.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:2147483647;max-width:480px;padding:15px 17px;border-radius:12px;color:#fff;background:#7f1d1d;box-shadow:0 15px 40px #0004;font:13px/1.5 system-ui,Arial,sans-serif';
    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:7px;font-size:15px';
    const ico = document.createElement('img');
    ico.src = ICON;
    ico.alt = '';
    ico.style.cssText = 'width:27px;height:27px;border-radius:6px';
    const title = document.createElement('strong');
    title.textContent = 'Comercial não carregou';
    heading.append(ico, title);
    const details = document.createElement('div');
    details.textContent = reason;
    const help = document.createElement('div');
    help.style.cssText = 'margin-top:8px;font-size:12px;opacity:.9';
    help.textContent = 'Atualize com Ctrl + Shift + R. Se persistir, abra F12 > Console e procure [Comercial Loader]. Para políticas CSP restritivas, use o loader alternativo no modo @require (não os dois juntos).';
    const diag = document.createElement('div');
    diag.style.cssText = 'margin-top:7px;font-size:11px;opacity:.8';
    diag.textContent = 'Firebase: ' + (firebaseReady() ? 'OK' : 'indisponível') + ' • Aplicativo: ' + (window.__COMERCIAL_APP_RUNNING__ ? 'iniciou' : 'não iniciou') + ' • Modal: ' + (document.getElementById(STYLE_ID) ? 'OK' : 'ausente') + ' • Loader: ' + LOADER_VERSION;
    node.append(heading, details, help, diag);
    (document.body || document.documentElement).appendChild(node);
    console.error(PREFIX, reason);
  }
  function announceReady() {
    removeError();
    window.__COMERCIAL_LOADER_READY__ = true;
    window.dispatchEvent(new CustomEvent('comercial:loader-ready', {
      detail: { loaderVersion: LOADER_VERSION, appVersion: window.__COMERCIAL_APP_VERSION__ || 'não informada' }
    }));
    console.info(PREFIX, 'Pronto. Loader ' + LOADER_VERSION + ' • Comercial ' + (window.__COMERCIAL_APP_VERSION__ || 'remoto') + '.');
  }
  function watchReady() {
    if (isReady()) { announceReady(); return; }
    let tries = 0;
    const timer = window.setInterval(() => {
      if (isReady()) {
        window.clearInterval(timer);
        announceReady();
      } else if (++tries >= 50) {
        window.clearInterval(timer);
        reportError('O comercial.js foi requisitado, mas não montou a interface. Verifique erros de JavaScript no Console.');
      }
    }, 250);
  }
  function injectLatestScript() {
    if (isReady()) { announceReady(); return; }
    if (!firebaseReady()) {
      reportError('Bibliotecas Firebase indisponíveis. Confira a configuração do Tampermonkey e as dependências @require.');
      return;
    }
    // Script externo executado pelo navegador no contexto da página.
    // Sem fetch, eval ou innerHTML. Nome e URL continuam iguais entre versões.
    const script = document.createElement('script');
    script.id = 'comercial-remote-script';
    script.src = REMOTE_JS + '?_comercial=' + Date.now();
    script.async = false;
    // Reutilizar nonce da própria página melhora a compatibilidade com CSP baseada em nonce.
    const pageScript = document.querySelector('script[nonce]');
    const nonce = pageScript?.nonce || pageScript?.getAttribute('nonce') || '';
    if (nonce) script.setAttribute('nonce', nonce);
    script.addEventListener('load', () => {
      console.info(PREFIX, 'Arquivo remoto carregado. Verificando interface...');
      watchReady();
    }, { once: true });
    script.addEventListener('error', () => {
      reportError('Falha ao executar comercial.js por script externo. Pode ser bloqueio CSP, extensão de segurança ou falha ao publicar no GitHub Pages.');
    }, { once: true });
    (document.head || document.documentElement).appendChild(script);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectLatestScript, {once:true});
  } else {
    injectLatestScript();
  }
})();
