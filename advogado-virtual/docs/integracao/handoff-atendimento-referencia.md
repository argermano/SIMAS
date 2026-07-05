# Referência — stack de atendimento (extrato do handoff, sem segredos)

> Extrato curado do `handoff-atendimento.md` (2026-07-05) com o que o SIMAS precisa
> para a integração do Funil Comercial (Fase 4). Segredos só por NOME de env.

## Visão geral
WhatsApp → **Evolution API** (gateway, instância ativa `whatsapp-sc`) → **ai-attendant**
(Node puro, arquivo único `server.js` + `prompt.txt`, container no VPS
`/opt/omnichannel/ai-attendant/`, repo git privado `argermano/omnichannel`) →
**scheduler** (Node) → **Cal.com Cloud**. **Chatwoot** é o painel humano. Sem n8n;
Typebot é legado (não integrar). O SIMAS (Vercel) é chamado pelo ai-attendant via
HTTPS público.

## Chatwoot
- Link de conversa: `https://atendimento.apoiojuridicodf.adv.br/app/accounts/1/conversations/{n}` (Account ID 1).
- O funil NÃO chama a API do Chatwoot na v1 (caveat: o Caddy remove o header `api_access_token` na URL pública).

## Cal.com (Cloud, DUAS contas)
| Praça | Event type |
|---|---|
| Brasília/DF | `6211718` |
| Santa Catarina/SC | `6211879` |
- Webhooks `BOOKING_CREATED`/`BOOKING_CANCELLED` configurados **nas duas contas** (UI: Settings → Developer → Webhooks; ou API v2 `POST https://api.cal.com/v2/webhooks` com a key de cada conta).
- Assinatura: HMAC-SHA256 do **corpo bruto** com o secret do webhook, header **`x-cal-signature-256`** — verificar com `crypto.timingSafeEqual`; subscriber URL precisa ser HTTPS público (usar a URL de produção do SIMAS).

## ai-attendant — os DOIS ganchos do SIMAS (server.js)
Envs novas no VPS (`/opt/omnichannel/ai.env`): `SIMAS_URL` (URL pública do SIMAS) e `SIMAS_TOKEN` (= `SIMAS_INTEGRATION_TOKEN`).
Helper a adicionar: `notifySimas(path, body)` — `fetch` com timeout ~3s, 1 retry, **fire-and-forget** (falha só loga; jamais interrompe o atendimento).

**(a) Lead novo** — no handler do `POST /webhook`, logo após `getSession(jid)`:
```js
if (session.messages.length === 0) {
  // LEAD NOVO → notifySimas('/api/funil/leads', { telefone, nomeInformado?, chatwootConversationId? })
}
```
Complemento: em `runTool()`, quando qualquer tool trouxer `assunto`/`area`/nome/e-mail →
`notifySimas('/api/funil/leads/by-phone/'+telefone, { nomeInformado?, area?, email?, ultimoContatoEm })` (PATCH).

**(b) Agendamento confirmado** — em `runTool()`, ramo `agendar_consulta`, **após `j.ok`** do scheduler:
```js
const j = await callScheduler("/book", "POST", { city, chosenLabel, name, email, phone, tipo, formato, assunto, resumo });
// APÓS j.ok:
// notifySimas(`/api/funil/leads/by-phone/${telefone}/agendamento`,
//   { calBookingUid: j.uid, quando: j.when, formato, tipo, area: assunto, meetUrl: j.meetUrl, nome, email })
```
O retorno do scheduler traz `ok`, `uid` (booking do Cal.com), `when`, `meetUrl`.

## Deploy no VPS
Editar os arquivos em `/opt/omnichannel/ai-attendant/`, validar com
`docker exec omnichannel-ai-attendant-1 node --check /app/server.js` e aplicar com
`bash /opt/omnichannel/redeploy.sh "mensagem"`. **`prompt.txt` não se altera sem aprovação da usuária.**

## Restrições
- Só `whatsapp-sc` ativa → `unidade` default "SC" (env `FUNIL_UNIDADE_DEFAULT`); a DF virá depois.
- Roteamento de praça no scheduler: "Santa Catarina" → SC; resto → Brasília.
