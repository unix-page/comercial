// ==UserScript==
// @name         Xabuia • Loader oficial InfraDesk
// @namespace    xabuia/infradesk-loader
// @version      3.0.8
// @description  Carrega o Xabuia do InfraDesk diretamente pelo Tampermonkey, sem fetch, eval ou injeção por script tag.
// @author       Xabuia
// @match        https://*.infradesk.app/backend/chamados*
// @run-at       document-end
// @noframes
// @icon         https://chamadossicofe-design.github.io/xabuia/xabuia.png
// @homepageURL  https://chamadossicofe-design.github.io/xabuia/
// @updateURL    https://chamadossicofe-design.github.io/xabuia/xabuia-loader-oficial.user.js
// @downloadURL  https://chamadossicofe-design.github.io/xabuia/xabuia-loader-oficial.user.js
// @grant        none
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js
// @require      https://chamadossicofe-design.github.io/xabuia/xabuiaasp.js?v=3.2.18-loader-3.0.8
// ==/UserScript==

(function () {
  'use strict';

  const XABUIA_LOADER_VERSION = '3.0.8';
  const XABUIA_MAIN_EXPECTED_VERSION = '3.2.18';
  const XABUIA_ICON_URL = 'https://chamadossicofe-design.github.io/xabuia/xabuia.png';

  window.__XABUIA_LOADER_PAGE_CONTEXT_ACTIVE__ = true;
  window.__XABUIA_LOADER_VERSION__ = XABUIA_LOADER_VERSION;
  window.__XABUIA_LOADER_UPDATE_URL__ = 'https://chamadossicofe-design.github.io/xabuia/xabuia-loader-oficial.user.js';

  function xabuiaReallyLoaded() {
    return Boolean(
      window.__XABUIA_APP_RUNNING__
      && document.getElementById('xabuia-tm-style')
      && document.getElementById('xabuia-overlay')
    );
  }

  function removeLoaderError() {
    document.getElementById('xabuia-loader-error')?.remove();
  }

  function showLoaderError() {
    removeLoaderError();

    const firebaseReady = typeof window.firebase !== 'undefined';
    const appFlag = Boolean(window.__XABUIA_APP_RUNNING__);
    const styleReady = Boolean(document.getElementById('xabuia-tm-style'));
    const overlayReady = Boolean(document.getElementById('xabuia-overlay'));

    const box = document.createElement('div');
    box.id = 'xabuia-loader-error';
    box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:480px;background:#7f1d1d;color:#fff;padding:14px 16px;border-radius:14px;box-shadow:0 18px 45px rgba(0,0,0,.28);font-family:Arial,sans-serif;font-size:13px;line-height:1.45';
    box.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:7px">
        <img src="${XABUIA_ICON_URL}" alt="" style="width:28px;height:28px;border-radius:7px">
        <strong>Xabuia não terminou de carregar</strong>
      </div>
      <div>Atualize a página com <strong>Ctrl + Shift + R</strong>. Se continuar, abra o Console e procure por <strong>[Xabuia]</strong>.</div>
      <div style="margin-top:7px;font-size:11px;opacity:.9">
        Diagnóstico: Firebase ${firebaseReady ? 'OK' : 'FALHOU'} · Aplicativo ${appFlag ? 'iniciou' : 'não iniciou'} · Estilo ${styleReady ? 'OK' : 'ausente'} · Janela ${overlayReady ? 'OK' : 'ausente'}
      </div>
      <div style="margin-top:4px;font-size:11px;opacity:.8">Loader ${XABUIA_LOADER_VERSION} · Xabuia esperado ${XABUIA_MAIN_EXPECTED_VERSION}</div>
    `;

    (document.body || document.documentElement).appendChild(box);
  }

  function announceReady() {
    removeLoaderError();
    window.__XABUIA_LOADER_READY__ = true;
    window.dispatchEvent(new CustomEvent('xabuia:loader-ready', {
      detail: {
        loaderVersion: XABUIA_LOADER_VERSION,
        xabuiaVersion: window.__XABUIA_REMOTE_VERSION || XABUIA_MAIN_EXPECTED_VERSION
      }
    }));
    console.log(`[Xabuia Loader] Pronto. Loader ${XABUIA_LOADER_VERSION}; Xabuia ${window.__XABUIA_REMOTE_VERSION || XABUIA_MAIN_EXPECTED_VERSION}.`);
  }

  function verifyRealLoad() {
    if (xabuiaReallyLoaded()) {
      announceReady();
      return;
    }

    let attempts = 0;
    const maximumAttempts = 20;
    const timer = window.setInterval(() => {
      attempts += 1;

      if (xabuiaReallyLoaded()) {
        window.clearInterval(timer);
        announceReady();
        return;
      }

      if (attempts >= maximumAttempts) {
        window.clearInterval(timer);
        window.__XABUIA_LOADER_READY__ = false;
        console.error(`[Xabuia Loader] O Xabuia não montou a interface após ${maximumAttempts * 250} ms.`);
        showLoaderError();
      }
    }, 250);
  }

  verifyRealLoad();
})();
