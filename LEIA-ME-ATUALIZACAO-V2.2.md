# Comercial V2.2 — catálogos editáveis e respostas por setor

## Mudanças deste pacote

- O administrador possui duas abas independentes em **admin.html**: Divergências e Respostas por setor.
- Cada lista tem campo de **pesquisa**, filtro por setor, situação ativa/inativa e botões **Editar** e **Inativar/Ativar**.
- No cadastro, nomes precisam ter pelo menos três caracteres e uma letra (um `%` isolado é recusado).
- A edição mantém o **ID do documento** e o setor; isso evita romper referências de divergências já gravadas. Pode editar o nome e a descrição e, em respostas, a consequência.
- `respostas_v2` é nova coleção no Firestore, com campos: `setor`, `nome`, `descricao`, `efeito`, `ativo`, datas/autor.
- Efeitos: `validar` (retorno à CRF), `concluir` (conclusão) e `devolver` (devolução/recusa).
- Botões **Adicionar sugestões** são opt-in. Não executam automaticamente nem apagam a configuração atual. Sua chefe pode decidir quais usar.
- Os tipos já cadastrados continuam no banco; inclusive o `%`. Edite o registro `%` para renomear ou inative-o.
- `usuarios`, `fornecedores_v2`, `compradores_v2`, eventos, notas e históricos **não são apagados nem migrados**.

## Instalação importante

1. Faça backup das regras atuais do Firestore e arquivos atuais do GitHub.
2. Firebase Console > Firestore Database > **Regras**: atualize o conteúdo de `firestore.rules` e clique Publicar. Nova coleção `respostas_v2` deve ser acessível para admins.
3. Na raiz do repositório `comercial`, substitua `admin.html`, `admin.js`, `style.css`, `firebase-core.js`, `firestore.rules` (o último é para referência/publicação; o GitHub NÃO aplica regras automaticamente).
4. Publique. Reabra o site via `https://unix-page.github.io/comercial/admin.html` com Ctrl + Shift + R.
5. Abra **Divergências**, edite ou inative seus tipos, depois abra **Respostas por setor**. Use o botão para cadastrar modelos sugeridos ou digite os seus.
6. Teste alterações com a conta de administrador e confira documentos em Firestore > `respostas_v2`.

## Operação no Infradesk

**Escopo deste pacote: cadastro administrativo de respostas**, sem ativar automaticamente alterações no fluxo de gravação do Infradesk. A ligação das respostas cadastradas aos botões operacionais da CRF e ao relógio das passagens será tratada na etapa de integração, após aprovarmos o catálogo. O `comercial.js` no ZIP completo mantém a última versão 2.1 que você já recebeu (melhorias do Google Login).

## Atenção aos resultados e ao histórico

- Escolher `Finalizado` como resposta no cadastro **não encerra nenhuma divergência existente por si só**.
- A ação de encerramento/retorno ocorre no registro operacional, a ser ligado ao catálogo na etapa seguinte.
- Não altere manualmente IDs dos documentos do Firestore: o editor preserva o identificador.
- A inativação não apaga registros antigos, mas oculta opções em novas escolhas.

## Segurança

`respostas_v2` somente pode ser modificada por admins; leitura por perfis ativos. Publique as regras pela interface Firebase ou Firebase CLI. Nunca use regra global `allow read, write: if true`.
