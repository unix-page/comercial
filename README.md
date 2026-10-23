# Comercial V2 — lançamento piloto (Firestore limpo)

Projeto publicado em https://unix-page.github.io/comercial/ . Todos os arquivos ficam **na raiz**.

## O que esta versão já permite

- Preserva a coleção antiga `usuarios` e o Firebase Authentication; não recria perfis automaticamente.
- Administração via `admin.html`: 14 compradores oficiais, editar/inativar compradores, fornecedores por CNPJ, vínculo manual de compradores, cadastro de setores/tipos, importar JSON `[ {"cnpj": "...", "razaoSocial": "...", "compradores": [...] } ]`, prévia e edição dos papéis dos usuários existentes.
- CNPJ normalizado (14 dígitos) e verificação de dígitos verificadores. Razão social importada tem prioridade sobre nome do Infradesk.
- Portal via `index.html`: autenticação Google/e-mail, visualização ao vivo (até 300 divergências), detalhes do histórico e resumo PRELIMINAR do conjunto carregado.
- Loader Tampermonkey `comercial-loader.user.js` carrega `comercial.js` no Infradesk; registro de divergência por chave de 44 dígitos, eventos por responsável e passagens pelos setores com início/fim carimbados pelo servidor.
- Uma nota (`notas_v2/{chave}`), vários chamados Infradesk, várias divergências, vários eventos e múltiplas passagens pelo mesmo setor.

## Ordem obrigatória de implantação

1. **Antes de publicar**, faça backup da coleção `usuarios` e das regras atuais do Firestore. Você já excluiu as coleções antigas de testes.
2. No Firebase Console → Authentication → Sign-in method, habilite **Google** e **Email/Password**. Em Authorized domains, inclua `unix-page.github.io` e, para login no script, o host Infradesk realmente utilizado (cada subdomínio empregado precisa ser autorizado se o Firebase exigir). Domínios devem ser autorizados explicitamente, não usar curinga. Confirme seu usuário em `usuarios/{UID}` com `papel: "admin"` e `ativo: true` (ou campo `ativo` ausente). **Não escreva UID fixo nem e-mail privilegiado no JavaScript.**
3. Publique as regras `firestore.rules` **ANTES** de usar os novos aplicativos. Pelo Firebase CLI, dentro da pasta: `firebase login`, `firebase deploy --project comercial-divergencias --only firestore:rules,firestore:indexes`. Alternativamente, cole `firestore.rules` no console e publique; o arquivo de índices está vazio porque as consultas desta V2 usam índices de campo único.
4. Envie os arquivos da raiz deste ZIP à raiz do repositório GitHub Pages. Em Settings > Pages confirme que publica a raiz e a branch pretendida. Verifique https://unix-page.github.io/comercial/ e https://unix-page.github.io/comercial/admin.html .
5. Entre no `admin.html` com a conta admin preservada; clique em **Criar compradores oficiais faltantes** e **Cadastrar tipos padrão faltantes**. Faça a importação do JSON com **Prévia**, revise duplicidades, e só então **Importar**. Compradores do JSON que não existem podem ser criados automaticamente, assinalados com `origem: "importacao_json"` para posterior revisão.
6. Confira os fornecedores e os vínculos de compradores importados. Instale/atualize o **`comercial-loader.user.js`** no Tampermonkey; não instale `comercial.js` separadamente. Desabilite o userscript antigo antes para evitar duas extensões mexendo na página.
7. Faça um teste com uma única nota: abrir divergência, registrar retorno, encaminhar novamente, concluir, reabrir e conferir o histórico e as passagens no site.

## Estrutura das novas coleções

- `usuarios` — coleções/papéis existentes **preservados**.
- `compradores_v2/{id}` — `nome`, `apelidos`, `ativo`, `origem`.
- `fornecedores_v2/{cnpj}` — `cnpj`, `razaoSocial`, `nomeInfradesk`, `compradorIds[]`.
- `tipos_divergencia_v2/{id}` — `setor`, `nome`, `ativo`.
- `notas_v2/{chave}` — campos da NF e `chamadosInfradeskIds[]`.
- `divergencias_v2/{id}` — uma classificação de problema, responsável e status por ID.
- `eventos_v2/{id}` — auditoria de abertura/encaminhamento/retorno/conclusão/reabertura, imutável.
- `passagens_v2/{id}` — início e fim, setor e comprador; reencaminhamento cria outra passagem.

## Critérios dos tempos

As passagens usam `FieldValue.serverTimestamp()` do Firestore no início e fim. O tempo acumulado de um setor é a soma de todos os intervalos de suas passagens concluídas; visitas repetidas **não** aumentam a contagem de notas distintas. Passagens abertas não contam como concluídas e devem aparecer separadas. O histórico usa timestamps gravados pelo servidor, não um valor de duração produzido pelo navegador.

O resumo do `index.html` **não é relatório definitivo**: lê no máximo 300 divergências e, sob demanda, 1.500 passagens. Para auditoria e fechamento de período com volumes maiores precisaremos acrescentar paginação completa, exportação, período/data e indicadores de primeira resposta/tempo útil. O site sinaliza explicitamente esses limites.

## Segurança e limitações da V2

- `usuarios` só pode ser alterada por admin, embora o usuário autenticado consiga ler o próprio perfil.
- Perfil `admin` gerencia cadastros e usuários. Perfis `crf`/`usuario` registram ocorrências. Compradores/fiscal/cadastro/consulta podem acompanhar no site, mas não gravam no Infradesk.
- Fornecedor novo não cadastrado pode ser criado pelo operador CRF **somente** a partir dos dados do Infradesk; já cadastrado não pode ter razão social sobrescrita pela CRF.
- Regras bloqueiam exclusões dos registros operacionais e alterações em eventos existentes; contas bloqueadas (`ativo:false`) não acessam Firestore pelo cliente.
- Esta versão não possui back-end próprio/Cloud Functions: regras verificam perfis e estrutura básica, mas um cliente com acesso legítimo de CRF ainda pode tentar gravar dados diretamente. Para maior integridade/auditoria em produção, mover operações críticas para servidor confiável, adicionar validações de regras mais granulares e testes com Emulator Suite.
- Importador grava em blocos de até 300. Se uma importação for interrompida, ela pode ser repetida, mas operações em lotes separados não são uma única transação; revise o resultado.
- `comercial-loader.user.js` executa conteúdo remoto do GitHub Pages no contexto do Infradesk, por design do fluxo original. **Proteja o repositório e o acesso de publicação**, pois uma alteração maliciosa do JS publicado teria acesso ao contexto da página.
- Não envie CSV/JSON de fornecedores sigilosos para o repositório. Faça o upload local no navegador do administrador.
- Remova/desative `app.js`, `styles.css` e `blin.mp3`: são arquivos legados não utilizados nesta versão. `been.mp3` é preservado para eventual alerta sonoro futuro, mas ainda não toca automaticamente.

## Login Google + senha

Ambos estão disponíveis no portal. Se sua conta era Google, entre pelo Google e clique em **Definir senha**; a ação tenta vincular e-mail/senha **ao mesmo UID** usando `linkWithCredential`. Se ocorrer `credential-already-in-use` ou `email-already-in-use`, não crie perfil duplicado: resolva o conflito de contas com segurança. O Firebase documenta uma limitação conhecida de `linkWithCredential` em certos projetos; pode ser preciso ajustar o método de vinculação antes de liberar para todos.

## Lista oficial de compradores

ADAO AGNELO; CAMILA LOVIZARO; CAROL MAZIERO; DENI MARCOS DE CARVALHO; GISLAINE MACIEL; PAULO CESAR SANTANA; RAFAEL GOMES; REGINALDO S MARTINS; ROSANGELA; TATIANA CARDOSO; THIAGO HIDEO; VALDENIR; WAGNER BERLOFFA; ZILDA SALICANO.

"Deni" e "DENI MARCOS" são aliases de "DENI MARCOS DE CARVALHO". Outros abreviados parecidos não são automaticamente equiparados sem confirmação do administrador.

## Observação de teste

Pacote validado sintaticamente e inspecionado estaticamente. **Não** foi possível testar dentro do Infradesk autenticado ou com regras reais do seu Firebase; verifique primeiro em ambiente controlado. Faça backup antes de atualizar dados e valide permissões do seu usuário admin.
