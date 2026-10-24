# Comercial V2.1 — melhoria do loader e login Google

Este pacote tem **somente os arquivos alterados**, para não sobrescrever seus cadastros/administração.

## 1. Primeiro publique no GitHub Pages

Na raiz de `unix-page/comercial`:
- Substitua **comercial.js** pelo arquivo deste pacote. Ele mantém a lógica da versão V2 e melhora os diagnósticos de login Google.
- Substitua **comercial-loader.user.js** pelo arquivo deste pacote. Essa é a versão **DINÂMICA (padrão)**.
- Opcionalmente publique também **comercial-loader-compat.user.js** para funcionários cujos computadores bloqueiem a versão dinâmica.
- Arquivos `.txt` têm o mesmo conteúdo dos respectivos loaders e servem para facilitar a instalação manual.

Nenhum arquivo de banco é apagado. Não há alteração de regras de segurança nesta atualização.

## 2. Instale apenas UM loader no Tampermonkey

### Recomendado para atualização centralizada: `comercial-loader.user.js`
- Firebase é carregado com `@require`.
- A versão publicada do `comercial.js` é buscada por uma tag `<script>` com query antichache. Não há `fetch()` ou `eval()`.
- Para versões futuras: atualize apenas `comercial.js` no GitHub Pages. O loader permanece fixo.
- LIMITAÇÃO: navegadores/páginas com CSP estrita podem bloquear a tag externa. Não há como garantir que funcione em todos os navegadores apenas com `@grant none`.

### Alternativa para navegadores com política estrita: `comercial-loader-compat.user.js`
- Repete a estratégia do Xabuia: bibliotecas Firebase e `comercial.js` por `@require`, sem `fetch`, `eval` ou tag dinâmica.
- LIMITAÇÃO: o Tampermonkey pode manter o conteúdo de `@require` em cache. Publicações novas de `comercial.js` podem não aparecer no primeiro acesso. Em Tampermonkey > Configurações (modo avançado), considere atualizar os recursos externos com frequência. Pode requerer atualização externa ou reinstalação dependendo das políticas.

**NUNCA deixe os dois loaders ativos ao mesmo tempo.**

## 3. Google Login — verificar em cada usuário

1. Firebase Authentication > Sign-in method: provedor Google **habilitado**.
2. Firebase Authentication > Settings > Authorized domains: adicionar o **hostname real** em que o funcionário usa o Infradesk (ex.: `empresa.infradesk.app`, sem `https://` ou caminho). `@match` do Tampermonkey NÃO autoriza domínios no Firebase.
3. No navegador do funcionário, habilitar pop-ups para o domínio do Infradesk (o SDK usa `signInWithPopup`). Se necessário, rever bloqueio de cookies/armazenamento e extensões corporativas.
4. No Chrome/Tampermonkey, garantir que a extensão está habilitada, tem acesso ao Infradesk e o recurso **Allow User Scripts / Permitir scripts de usuário** (se a versão exigir) está ativo.
5. A coleção preservada `usuarios` deve conter `usuarios/{UID Firebase}`. Para registrar eventos o perfil precisa estar ativo e ter papel `admin`, `usuario` ou `crf`.
6. O login feito em `https://unix-page.github.io` não cria automaticamente sessão no Infradesk, pois as origens web são distintas.

## 4. Diagnóstico

Abra F12 > Console e procure por:
- `[Comercial Loader] Pronto...`: aplicativo montado.
- `auth/unauthorized-domain`: domínio exato do Infradesk não foi autorizado no Firebase.
- `auth/popup-blocked`: popup bloqueado pelo navegador.
- `auth/operation-not-allowed`: login Google desabilitado.
- `Perfil ausente em usuarios`: Google autenticou, mas falta perfil com UID correto.
- `Refused to load script` / `Content Security Policy`: usar loader compatível via `@require`.

## 5. Publicação/testes

Publique `comercial.js` e os loaders no GitHub Pages antes de instalar o novo loader nos navegadores. Faça Ctrl+Shift+R no Infradesk e teste Google e e-mail. Primeiro teste com um usuário da CRF e outro com perfil diferente. Nunca interprete `signInWithPopup` concluído como autorização para gravar: é preciso validar o perfil no Firestore.

Este pacote foi testado com `node --check`, mas **não** foi executado dentro de um Infradesk autenticado ou Firebase real.
