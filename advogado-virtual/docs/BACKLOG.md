# Backlog — SIMAS

Itens pedidos para DEPOIS (não executar sem combinar). Ordem não é prioridade.

## Tarefas/Atendimento — Timesheets (controle de horas)
- **Pedido do dono (2026-07-14, decisão de escopo):** ficou FORA do 1º lote do Primeiro Atendimento. O Astrea tem "Timesheets" por atendimento (apontamento de horas). Não existe nada no SIMAS.
- **Quando fizer:** apontamentos manuais por atendimento (usuário, duração, descrição, data) + total no hub do caso.
- Conversas: limpeza de objetos órfãos em `conversas-envio/` no Storage (upload abandonado antes do envio não tem TTL) — varrer na folga do cron diário. (2026-07-22, review do anexo 20MB)
- Conversas/envio por número: despacharWhatsAppCliente usa o mesmo transporte base64 do /notify sem teto próprio (documento grande no modal pode estourar 30s) — aplicar o mesmo teto/falha tipada do encaminhar. anexo-documento.ts diz "25 MB" no texto com constante de 45. (2026-07-29, review do encaminhar)
- Omnichannel/higiene de segredo: o Caddyfile (repo privado argermano/omnichannel) hardcoda o X-Notify-Token nos matchers /notify e /editar — o ai-attendant já valida o mesmo token, então a checagem no Caddy é redundância. Tirar o segredo do git: matcher por env/template no deploy-pull, ou remover a checagem do Caddy e deixar só no serviço. Se sair do privado algum dia, ROTACIONAR o token antes. (2026-08-05, review da edição de mensagem)
