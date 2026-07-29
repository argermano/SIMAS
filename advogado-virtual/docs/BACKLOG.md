# Backlog — SIMAS

Itens pedidos para DEPOIS (não executar sem combinar). Ordem não é prioridade.

## Tarefas/Atendimento — Timesheets (controle de horas)
- **Pedido do dono (2026-07-14, decisão de escopo):** ficou FORA do 1º lote do Primeiro Atendimento. O Astrea tem "Timesheets" por atendimento (apontamento de horas). Não existe nada no SIMAS.
- **Quando fizer:** apontamentos manuais por atendimento (usuário, duração, descrição, data) + total no hub do caso.
- Conversas: limpeza de objetos órfãos em `conversas-envio/` no Storage (upload abandonado antes do envio não tem TTL) — varrer na folga do cron diário. (2026-07-22, review do anexo 20MB)
- Conversas/envio por número: despacharWhatsAppCliente usa o mesmo transporte base64 do /notify sem teto próprio (documento grande no modal pode estourar 30s) — aplicar o mesmo teto/falha tipada do encaminhar. anexo-documento.ts diz "25 MB" no texto com constante de 45. (2026-07-29, review do encaminhar)
