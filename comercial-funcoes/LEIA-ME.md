# Reserva automática de espaço, a parte que roda no servidor

## O que isto faz

Quando um contrato vira **assinado** no banco, esta função reserva no mapa os espaços
daquela marca, na edição do contrato. Funciona mesmo sem ninguém com o painel aberto.

É a mesma regra do painel, escrita de novo aqui porque o painel só roda quando alguém
está com ele na tela. As duas podem agir na mesma reserva sem se atrapalhar: quem chegar
depois vê que já está reservado e não muda nada.

Serve para dois casos: contrato assinado por outra pessoa em outro computador, e, quando a
assinatura por API entrar, contrato que volta assinado de madrugada.

## O que já está pronto

- `functions/index.js`, a função
- `functions/package.json`, o que ela precisa para rodar
- `firebase.json` e `.firebaserc`, que dizem em qual projeto publicar
- `.github/workflows/publicar-funcoes.yml`, que publica sozinho quando esta pasta muda

## O passo que falta, e só você pode fazer

A publicação precisa de uma credencial do projeto no Google Cloud, e ela tem que ser
criada por você, que é o dono da conta.

1. Abra `console.cloud.google.com/iam-admin/serviceaccounts?project=painel-comercial-fi`
2. Clique em **Criar conta de serviço**. Nome: `publicar-funcoes`. Criar e continuar.
3. Dê a ela estes papéis, um de cada vez:
   - Administrador do Cloud Functions
   - Usuário da conta de serviço
   - Leitor do Artifact Registry
   - Administrador do Firebase (ou Editor, se preferir simples)
4. Terminado, clique na conta criada, aba **Chaves**, **Adicionar chave**, **Criar nova
   chave**, tipo **JSON**. Ele baixa um arquivo.
5. Abra `github.com/contato-lab/central-evento-fi/settings/secrets/actions`
6. **New repository secret**. Nome exatamente `FIREBASE_SERVICE_ACCOUNT`. No valor, cole o
   conteúdo inteiro do arquivo JSON que baixou.
7. Abra a aba **Actions** do repositório, escolha **Publicar funções do painel comercial**
   e clique em **Run workflow**.

Na primeira vez o Google pode pedir para ativar as APIs de Cloud Functions, Cloud Build,
Artifact Registry e Eventarc. Se aparecer erro falando de API desativada, o próprio erro
traz o link para ativar.

**Cuidado com o arquivo JSON:** ele é a chave da casa. Depois de colar no GitHub, apague
o arquivo do computador. Não mande por e-mail nem por WhatsApp.

## Para saber se funcionou

Marque qualquer contrato como Assinado e veja o espaço da marca ficar Reservado sem você
abrir o painel de espaços. O registro de cada execução fica em
`console.cloud.google.com/functions?project=painel-comercial-fi`, na aba Logs.
