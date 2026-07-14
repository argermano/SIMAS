# Backlog — SIMAS

Itens pedidos para DEPOIS (não executar sem combinar). Ordem não é prioridade.

## Conversas — reproduzir os áudios que os clientes enviam
- **Pedido do dono (2026-07-14):** poder ouvir/reproduzir dentro do módulo Conversas os áudios que os clientes mandam pelo WhatsApp.
- **Estado atual:** o áudio recebido (`anexo.tipo === 'audio'`) renderiza como card genérico (ícone microfone + "Áudio") em `src/components/conversas/MensagemBolha.tsx` — sem player.
- **O que fazer:** player inline (`<audio controls>`) para `tipo === 'audio'`, servido pelo proxy existente `GET /api/conversas/anexos?url=` (mesmo caminho da imagem inline).
- **Atenção técnica:** a allowlist de Content-Type do proxy de anexos (`src/app/api/conversas/anexos` + `relayFetchBinario`) hoje libera imagem/pdf — o WhatsApp manda áudio como **ogg/opus** (`audio/ogg`); é preciso incluir os tipos de áudio na allowlist para o `<audio>` conseguir tocar. Degradar para o card atual se falhar.
- **Plus opcional (não pedido):** botão "Transcrever" reusando a transcrição Groq/whisper que já existe no repo.

## Tarefas/Atendimento — Timesheets (controle de horas)
- **Pedido do dono (2026-07-14, decisão de escopo):** ficou FORA do 1º lote do Primeiro Atendimento. O Astrea tem "Timesheets" por atendimento (apontamento de horas). Não existe nada no SIMAS.
- **Quando fizer:** apontamentos manuais por atendimento (usuário, duração, descrição, data) + total no hub do caso.
