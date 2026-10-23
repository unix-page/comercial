# Chamados SICOFÊ — MVP V10

MVP em HTML, CSS e JavaScript puro usando Firebase Authentication, Cloud Firestore e Cloud Storage.

## O que mudou na V10

- A tela principal não mostra mais o bloco de **Organizações**.
- Organizações ficam apenas em **Administração > Organizações**.
- Botão de organização agora aparece como **Criar**.
- Filtro padrão agora é **Ativos: Aberto, Reaberto e Em tratamento**.
- Usuário comum, no filtro padrão, vê no máximo os **20 chamados ativos mais recentes** da própria organização.
- Para localizar chamados antigos, use **Buscar por chave** ou troque o filtro para **Todos** ou **Finalizado**.
- Operador continua vendo **Em tratamento** apenas quando o chamado está vinculado ao próprio operador.
- Removida a escolha manual de **Tipo de observação**.
- A área de anexo voltou em formato de caixa bonita:
  - colar imagem com **Ctrl+V**;
  - clicar para escolher arquivo;
  - arrastar arquivo para a área.
- Agora também dá para colar/anexar imagem em uma **nova ocorrência** dentro do detalhe do chamado.
- Admin ganhou relatório de operadores por intervalo de datas:
  - chamados colocados em tratamento;
  - chamados finalizados;
  - chamados reabertos;
  - total por operador.

## Antes de rodar

No Firebase Console do projeto `chamadossicofe-36fbe`, confirme:

1. Authentication ativado:
   - E-mail/senha;
   - Google.
2. Cloud Firestore criado.
3. Cloud Storage criado somente quando for testar anexos.

## Regras

Para login, organizações, usuários e chamados, publique:

```text
firestore.rules
```

em:

```text
Firestore Database > Regras
```

Para anexos, você precisa criar o **Cloud Storage** e publicar:

```text
storage.rules
```

em:

```text
Storage > Regras
```

Sem Storage, o chamado e a ocorrência continuam salvando, mas o arquivo/imagem não será enviado.

## Rodar localmente

```bash
cd chamadossicofe
python -m http.server 5500
```

Abra:

```text
http://localhost:5500
```

No Firebase Console > Authentication > Settings > Authorized domains, confirme que `localhost` está autorizado.

## Primeiro acesso admin

1. Entre com Google usando exatamente `chamadossicofe@gmail.com`.
2. O sistema cria automaticamente o perfil como admin em `usuarios/{uid}`.
3. Clique em **Admin**.
4. Cadastre as organizações na aba de Administração.
5. Usuários comuns conseguirão escolher uma organização no primeiro acesso.

## Estrutura no Firestore

```text
organizacoes/{orgId}
usuarios/{uid}
chamados/{chamadoId}
chamados/{chamadoId}/historico/{historicoId}
```

## Perfis

- `usuario`: vê chamados da própria organização.
- `operador`: vê fila aberta/reaberta/finalizada e, em tratamento, apenas os próprios.
- `admin`: vê tudo, cria organizações, bane/reativa usuários, altera perfil e acessa relatório.

## Observação sobre relatório

O relatório da V10 usa os campos atuais do chamado:

```text
tratamentoIniciadoEm
finalizadoEm
reabertoEm
```

Ele conta o operador gravado nesses campos. No futuro, se quisermos auditoria completa de cada mudança de status, podemos criar uma coleção própria de eventos analíticos.
