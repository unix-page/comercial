// ==UserScript==
// @name         Comercial • Loader compatível (alternativo Xabuia)
// @namespace    comercial/infradesk-compat
// @version      2.1.0
// @description  Usa @require para executar o Comercial em contexto de página, sem fetch/eval/script tag. Pode usar versão de comercial.js em cache.
// @author       Comercial
// @match        https://*.infradesk.app/backend/chamados*
// @run-at       document-end
// @noframes
// @sandbox      raw
// @icon         https://unix-page.github.io/comercial/comercial.png
// @homepageURL  https://unix-page.github.io/comercial/
// @updateURL    https://unix-page.github.io/comercial/comercial-loader-compat.user.js
// @downloadURL  https://unix-page.github.io/comercial/comercial-loader-compat.user.js
// @grant        none
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js
// @require      https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js
// @require      https://unix-page.github.io/comercial/comercial.js
// ==/UserScript==
(function () {
  'use strict';
  const LOADER_VERSION='2.1.0';
  const PREFIX='[Comercial Loader compatível]';
  if(window.__COMERCIAL_LOADER_COMPAT_ACTIVE__)return;
  window.__COMERCIAL_LOADER_COMPAT_ACTIVE__=true;
  window.__COMERCIAL_LOADER_VERSION__=LOADER_VERSION;
  function good(){return Boolean(window.__COMERCIAL_APP_RUNNING__&&document.getElementById('comercial-v2-modal'));}
  function ready(){
    document.getElementById('comercial-loader-error')?.remove();
    window.__COMERCIAL_LOADER_READY__=true;
    window.dispatchEvent(new CustomEvent('comercial:loader-ready',{detail:{loaderVersion:LOADER_VERSION,appVersion:window.__COMERCIAL_APP_VERSION__||'versão do @require'}}));
    console.info(PREFIX,'Pronto! Versão comercial:',window.__COMERCIAL_APP_VERSION__||'não informada');
  }
  function fail(){
    const b=document.createElement('div');b.id='comercial-loader-error';
    b.style.cssText='position:fixed;bottom:18px;right:18px;z-index:2147483647;max-width:470px;padding:14px;color:white;background:#7f1d1d;border-radius:12px;font:13px/1.5 system-ui';
    b.textContent='Comercial não montou a interface. Diagnóstico: Firebase '+(typeof firebase!=='undefined'?'OK':'ausente')+', app '+(window.__COMERCIAL_APP_RUNNING__?'iniciou':'não iniciou')+'. Veja F12 > Console > [Comercial]. Atualize a dependência @require no Tampermonkey se estiver usando uma versão antiga.';
    (document.body||document.documentElement).appendChild(b);
    console.error(PREFIX,'Falha ao montar a interface');
  }
  if(good()){ready();return;}
  let tries=0;const timer=setInterval(()=>{if(good()){clearInterval(timer);ready();}else if(++tries>=48){clearInterval(timer);fail();}},250);
})();
