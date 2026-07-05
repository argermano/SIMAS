# Integração ai-attendant → SIMAS (Funil Comercial)

Snippets **prontos para aplicar no VPS** (`argermano/omnichannel`,
`/opt/omnichannel/ai-attendant/server.js`). O SIMAS **não** faz parte deste repo —
esta é a **Opção B**: a usuária aplica os trechos abaixo no ai-attendant. Referência:
[`integracao/handoff-atendimento-referencia.md`](./integracao/handoff-atendimento-referencia.md).

> ⚠️ **`prompt.txt` não se altera** sem aprovação da usuária. Estes trechos mexem só
> no `server.js` (lógica), não no prompt do agente.

## 0. Contrato da API (o que o SIMAS espera)

Todas as chamadas levam o header `x-simas-token: ${SIMAS_TOKEN}` e são
**fire-and-forget** (uma falha nunca deve interromper o atendimento). Telefone em
qualquer formato — o SIMAS normaliza para E.164.

| Momento | Método + rota | Corpo |
|---|---|---|
| Lead novo | `POST /api/funil/leads` | `{ telefone, nomeInformado?, chatwootConversationId?, unidade?, ultimaMensagem?, ultimaMensagemAutor? }` |
| Dados do lead / nova mensagem | `PATCH /api/funil/leads/by-phone/{telefone}` | `{ nomeInformado?, area?, email?, ultimoContatoEm?, ultimaMensagem?, ultimaMensagemAutor? }` |
| Agendou | `POST /api/funil/leads/by-phone/{telefone}/agendamento` | `{ calBookingUid, quando, formato, meetUrl?, area?, nome?, email? }` |

`area` deve ser um slug do SIMAS (ex.: `previdenciario`, `civel`, `trabalhista`).
`quando` é ISO-8601 (aceita também `consultaDataISO`). `formato`: `online`/`presencial`.
`ultimaMensagem` é a última interação do WhatsApp mostrada no card (truncada em 300
no SIMAS); `ultimaMensagemAutor` ∈ `cliente` | `atendente` | `ia` (default `cliente`).
Enviar `chatwootConversationId` faz o card **abrir a conversa exata no Chatwoot**.

## 1. Envs novas no VPS (`/opt/omnichannel/ai.env`)

```bash
SIMAS_URL=https://simas.app
SIMAS_TOKEN=<mesmo valor de SIMAS_INTEGRATION_TOKEN na Vercel>
```

## 2. Helper `notifySimas` (adicionar ao topo do `server.js`)

Fire-and-forget: timeout ~3s, 1 retry, nunca lança. Se `SIMAS_URL`/`SIMAS_TOKEN`
não estiverem setados, vira no-op (permite ligar/desligar a integração pelo env).

```js
// --- SIMAS (Funil Comercial) -------------------------------------------------
const SIMAS_URL = process.env.SIMAS_URL || "";
const SIMAS_TOKEN = process.env.SIMAS_TOKEN || "";

async function notifySimas(path, body, method = "POST") {
  if (!SIMAS_URL || !SIMAS_TOKEN) return; // integração desligada
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    try {
      const r = await fetch(SIMAS_URL + path, {
        method,
        headers: { "Content-Type": "application/json", "x-simas-token": SIMAS_TOKEN },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (r.ok) return;                 // sucesso
      if (r.status >= 400 && r.status < 500) {
        console.warn("[simas] %s %s -> %s (não reenvia)", method, path, r.status);
        return;                         // erro do cliente: não adianta retry
      }
    } catch (e) {
      clearTimeout(t);
      console.warn("[simas] %s %s falhou (tentativa %d): %s", method, path, tentativa, e.message);
    }
    // 5xx/timeout → 1 retry
  }
}
```

## 3. Gancho (a) — lead novo + enriquecimento

No handler do `POST /webhook`, **logo após `getSession(jid)`**:

```js
if (session.messages.length === 0) {
  // LEAD NOVO — não await (fire-and-forget)
  notifySimas("/api/funil/leads", {
    telefone: jid,                       // o SIMAS normaliza
    nomeInformado: pushName || undefined,
    chatwootConversationId: session.chatwootConversationId || undefined,
    unidade: "SC",                       // praça ativa (ver Restrições no handoff)
  });
}
```

Em `runTool()`, quando alguma tool trouxer nome/assunto/área/e-mail, enriquecer o
lead (PATCH por telefone):

```js
if (nome || assunto || area || email) {
  notifySimas("/api/funil/leads/by-phone/" + encodeURIComponent(jid), {
    nomeInformado: nome || undefined,
    area: mapAreaSimas(assunto) || undefined, // mapear assunto → slug do SIMAS
    email: email || undefined,
    ultimoContatoEm: new Date().toISOString(),
  }, "PATCH");
}
```

> `mapAreaSimas(assunto)` traduz o rótulo do atendimento para o slug do SIMAS
> (`previdenciario`/`civel`/`trabalhista`/...). Se não mapear, omita `area` — o
> SIMAS aceita o lead sem área.

## 4. Gancho (b) — agendamento confirmado

Em `runTool()`, ramo `agendar_consulta`, **após `j.ok`** do scheduler:

```js
const j = await callScheduler("/book", "POST",
  { city, chosenLabel, name, email, phone, tipo, formato, assunto, resumo });

if (j.ok) {
  notifySimas("/api/funil/leads/by-phone/" + encodeURIComponent(phone) + "/agendamento", {
    calBookingUid: j.uid,
    quando: j.when,          // ISO do horário
    formato,                 // "online" | "presencial"
    meetUrl: j.meetUrl || undefined,
    area: mapAreaSimas(assunto) || undefined,
    nome: name || undefined,
    email: email || undefined,
  });
}
```

O SIMAS grava o booking e move o card para **Consulta Agendada** (idempotente por
`calBookingUid` — reenviar o mesmo agendamento não duplica). Observação: o
`BOOKING_CREATED` do Cal.com chega **também** por webhook direto ao SIMAS; os dois
caminhos convergem no mesmo `uid` sem criar leads duplicados.

## 4b. Gancho (c) — última mensagem no card + link do Chatwoot

O card do funil mostra a **última interação do WhatsApp** (sistema fechado,
cliente↔escritório). Envie o texto a cada mensagem (fire-and-forget). Autor:
`cliente` para mensagens recebidas; `atendente`/`ia` para as enviadas.

```js
// mensagem RECEBIDA do cliente (no handler do POST /webhook, ao processar o texto):
notifySimas("/api/funil/leads/by-phone/" + encodeURIComponent(jid), {
  ultimaMensagem: texto,
  ultimaMensagemAutor: "cliente",
  ultimoContatoEm: new Date().toISOString(),
}, "PATCH");

// resposta ENVIADA pelo assistente (logo após mandar a resposta ao cliente):
notifySimas("/api/funil/leads/by-phone/" + encodeURIComponent(jid), {
  ultimaMensagem: resposta,
  ultimaMensagemAutor: "ia",          // ou "atendente" se for um humano no Chatwoot
}, "PATCH");
```

**Chatwoot:** o card abre o Chatwoot ao clicar em "Chatwoot". Se o lead tiver
`chatwoot_conversation_id`, abre **a conversa exata**; por isso, envie
`chatwootConversationId` no gancho (a) (lead novo) assim que a conversa existir no
Chatwoot. Sem o id, o card abre o painel do Chatwoot (fallback).

## 5. Deploy no VPS

```bash
# validar sintaxe ANTES de aplicar
docker exec omnichannel-ai-attendant-1 node --check /app/server.js

# aplicar (script do handoff)
bash /opt/omnichannel/redeploy.sh "feat: notifica SIMAS (funil) nos ganchos a e b"
```

Se `node --check` acusar erro, **não** rode o redeploy — corrija primeiro. A
integração é fail-safe: com `SIMAS_URL`/`SIMAS_TOKEN` ausentes, `notifySimas` é
no-op e o atendimento segue normal.

## 6. Checklist de ativação

- [ ] `SIMAS_URL` e `SIMAS_TOKEN` em `/opt/omnichannel/ai.env` (token = o da Vercel).
- [ ] Helper `notifySimas` + ganchos (a), (b) e (c) aplicados no `server.js`.
- [ ] Gancho (a) envia `chatwootConversationId` (card abre a conversa no Chatwoot).
- [ ] `node --check` ok → `redeploy.sh`.
- [ ] Webhooks Cal.com (2 contas) apontando para `https://simas.app/api/funil/webhooks/calcom` com `CALCOM_WEBHOOK_SECRET`.
- [ ] Teste real: uma conversa nova no WhatsApp aparece em **Novo Lead**; um
      agendamento move para **Consulta Agendada** com data e link do Meet.
