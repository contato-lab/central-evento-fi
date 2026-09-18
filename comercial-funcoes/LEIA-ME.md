# Reserva automática de espaço, a parte que roda no servidor

## O que isto faz

Quando um contrato vira **assinado** no banco, esta função reserva no mapa os espaços
daquela marca, na edição do contrato. Funciona mesmo sem ninguém com o painel aberto.

É a mesma regra do painel, escrita de novo aqui porque o painel só roda quando alguém
está com ele na tela. As duas podem agir na mesma reserva sem se atrapalhar: quem chegar
depois vê que já está reservado e não muda nada.

## Onde ela mora

- **Cloud Run**, projeto `painel-comercial-fi`, serviço `reservar-espaco-ao-assinar`,
  região `southamerica-east1` (São Paulo), a mesma do banco.
- **Gatilho**: Eventarc, evento `google.cloud.firestore.document.v1.written`, banco
  `(default)`, caminho `contratos/{id}`. Dispara a cada gravação em qualquer contrato.
- **Ponto de entrada**: `reservarEspacoAoAssinar`. Node.js 22. No máximo 3 instâncias.
- Publicada pelo console do Google Cloud em 18/09/2026. Os arquivos desta pasta são a
  cópia exata do que está publicado.

## Como ela decide

A função não lê o conteúdo do evento: pega o id do contrato e lê o contrato direto no
banco. Assim ela funciona igual com qualquer formato de evento.

1. Contrato apagado, não assinado ou sem edição: não faz nada.
2. Se algum espaço já foi reservado por este contrato antes: não faz nada. Isso impede de
   passar por cima de quem devolveu o espaço para Disponível de propósito.
3. Procura o espaço amarrado na ficha da marca e os espaços da edição do contrato em que
   a marca de 2026 é essa marca (nome igual, sem acento e sem pontuação).
4. Pula espaço que já é de outra marca, pula espaço já vendido, e reserva o resto.

## Permissões que ela usa

Todas na conta padrão do projeto, `78864288270-compute@developer.gserviceaccount.com`:

- **Usuário do Cloud Datastore**, para ler e gravar no banco
- **Destinatário do evento do Eventarc**, para receber o aviso do banco
- **Builder do Cloud Run**, para montar o código na hora de publicar

## Para ver se ela está funcionando

`console.cloud.google.com/run/detail/southamerica-east1/reservar-espaco-ao-assinar/observability/logs?project=painel-comercial-fi`

Cada contrato gravado gera uma linha dizendo o que ela fez, por exemplo
`contrato abc123: reservados para Yamaha: Box 12, Box 13` ou
`contrato abc123: contrato ja reservou antes`.

## Para mudar o código

No Cloud Run, abrir o serviço, aba **Origem**, editar `index.js`, clicar em
**Salvar e reimplantar**. Depois copiar o mesmo código para esta pasta, para as duas
coisas continuarem iguais.
