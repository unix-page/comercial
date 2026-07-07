from pathlib import Path
import zipfile

base = Path("/mnt/data/comercial-loader")
base.mkdir(parents=True, exist_ok=True)

loader = r"""// ==UserScript==
// @name         Comercial • Loader oficial page-context
// @namespace    comercial/infradesk
// @version      1.0.0
// @description  Carrega a versão publicada do Comercial no contexto da página para preservar login Google/e-mail e atualização centralizada.
// @author       Comercial
// @match        https://*.infradesk.app/backend/chamados/painel*
// @match        https://*.infradesk.app/backend/chamados*
// @run-at       document-end
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

  const COMERCIAL_LOADER_VERSION = '1.0.0';
  const COMERCIAL_REMOTE_URL = 'https://unix-page.github.io/comercial/comercial.js';
  const COMERCIAL_ICON_URL = 'https://unix-page.github.io/comercial/comercial.png';
  const COMERCIAL_LOADER_UPDATE_URL = 'https://unix-page.github.io/comercial/comercial-loader.user.js';

  if (window.__COMERCIAL_LOADER_PAGE_CONTEXT_ACTIVE__) {
    console.warn('[Comercial Loader] Loader já está ativo nesta página. Ignorando segunda carga.');
    return;
  }

  window.__COMERCIAL_LOADER_PAGE_CONTEXT_ACTIVE__ = true;
  window.__COMERCIAL_LOADER_VERSION__ = COMERCIAL_LOADER_VERSION;
  window.__COMERCIAL_LOADER_UPDATE_URL__ = COMERCIAL_LOADER_UPDATE_URL;

  function cacheBustUrl(url) {
    return `${url}${String(url).includes('?') ? '&' : '?'}comercial_loader_page=${Date.now()}`;
  }

  function extractMetaVersion(scriptText) {
    const match = String(scriptText || '').match(/\/\/\s*@version\s+([^\s]+)/i);
    return match ? match[1].trim() : '';
  }

  function showLoaderError(message) {
    const old = document.getElementById('comercial-loader-error');
    if (old) old.remove();

    const box = document.createElement('div');
    box.id = 'comercial-loader-error';
    box.style.cssText = [
      'position:fixed',
      'inset:auto 18px 18px auto',
      'z-index:2147483647',
      'max-width:460px',
      'background:#7f1d1d',
      'color:#fff',
      'padding:14px 16px',
      'border-radius:14px',
      'box-shadow:0 18px 45px rgba(0,0,0,.25)',
      'font-family:Arial,sans-serif',
      'font-size:13px',
      'line-height:1.4'
    ].join(';');

    box.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
        <img src="${COMERCIAL_ICON_URL}" alt="" style="width:26px;height:26px;border-radius:7px">
        <strong>Comercial não carregou</strong>
      </div>
      ${String(message || 'Falha desconhecida.')}
    `;

    document.body.appendChild(box);
  }

  function alreadyHasComercialUi() {
    return !!(
      document.getElementById('comercial-overlay') ||
      document.getElementById('comercial-tm-style') ||
      window.__COMERCIAL_APP_RUNNING__
    );
  }

  function executeRemoteCode(remoteCode, remoteVersion) {
    if (alreadyHasComercialUi()) {
      console.warn('[Comercial Loader] Comercial já parece estar carregado. Não vou executar novamente.');
      return;
    }

    window.__COMERCIAL_REMOTE_LOADER_ACTIVE__ = true;
    window.__COMERCIAL_REMOTE_VERSION__ = remoteVersion || 'remota';
    window.__COMERCIAL_LOADER_VERSION__ = COMERCIAL_LOADER_VERSION;

    const prelude = [
      'window.__COMERCIAL_REMOTE_LOADER_ACTIVE__ = true;',
      `window.__COMERCIAL_REMOTE_VERSION__ = ${JSON.stringify(remoteVersion || 'remota')};`,
      `window.__COMERCIAL_LOADER_VERSION__ = ${JSON.stringify(COMERCIAL_LOADER_VERSION)};`,
      `window.__COMERCIAL_LOADER_UPDATE_URL__ = ${JSON.stringify(COMERCIAL_LOADER_UPDATE_URL)};`
    ].join('\n');

    console.log(`[Comercial Loader] Executando versão publicada no contexto da página: ${remoteVersion || 'remota'} | loader ${COMERCIAL_LOADER_VERSION}`);
    (0, eval)(`${prelude}\n${remoteCode}\n//# sourceURL=${COMERCIAL_REMOTE_URL}`);
  }

  async function loadByFetchEval() {
    const response = await fetch(cacheBustUrl(COMERCIAL_REMOTE_URL), {
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status || 'sem resposta'} ao baixar o Comercial.`);
    }

    const remoteCode = await response.text();

    if (!remoteCode || !remoteCode.includes('Comercial')) {
      throw new Error('Arquivo remoto vazio ou inválido. Confira se comercial.js foi publicado no GitHub Pages.');
    }

    executeRemoteCode(remoteCode, extractMetaVersion(remoteCode));
  }

  function loadByScriptTagFallback() {
    return new Promise((resolve, reject) => {
      if (alreadyHasComercialUi()) {
        resolve();
        return;
      }

      window.__COMERCIAL_REMOTE_LOADER_ACTIVE__ = true;
      window.__COMERCIAL_REMOTE_VERSION__ = 'remota-script-tag';
      window.__COMERCIAL_LOADER_VERSION__ = COMERCIAL_LOADER_VERSION;

      const script = document.createElement('script');
      script.src = cacheBustUrl(COMERCIAL_REMOTE_URL);
      script.async = false;
      script.onload = () => {
        console.log(`[Comercial Loader] Comercial carregado por script tag fallback. Loader ${COMERCIAL_LOADER_VERSION}.`);
        resolve();
      };
      script.onerror = () => reject(new Error('Fallback por script tag também falhou. Pode ser bloqueio de rede/CSP ou arquivo ausente.'));
      (document.head || document.documentElement).appendChild(script);
    });
  }

  async function loadRemoteComercial() {
    try {
      await loadByFetchEval();
    } catch (fetchError) {
      console.warn('[Comercial Loader] Fetch/eval falhou; tentando fallback por script tag:', fetchError);

      try {
        await loadByScriptTagFallback();
      } catch (fallbackError) {
        console.error('[Comercial Loader] Erro ao carregar Comercial remoto:', fallbackError);
        showLoaderError(`${fetchError?.message || 'Falha no carregamento principal.'}<br>${fallbackError?.message || ''}`);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRemoteComercial, { once: true });
  } else {
    loadRemoteComercial();
  }
})();
"""

(base / "comercial-loader.user.js").write_text(loader, encoding="utf-8")

zip_path = Path("/mnt/data/comercial-loader.user.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(base / "comercial-loader.user.js", arcname="comercial-loader.user.js")

print(zip_path) 
