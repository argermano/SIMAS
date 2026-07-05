# Funil Comercial (Fase 4)

Kanban de leads do primeiro contato ao contrato fechado, alimentado pelo
atendimento automático (ai-attendant/WhatsApp + Cal.com) e operado pela equipe em
`/funil`. Este documento cobre **uso, operação, configuração e rollback**. Os
snippets de integração do VPS ficam em [`INTEGRACAO-AI-ATTENDANT.md`](./INTEGRACAO-AI-ATTENDANT.md).

## Como funciona (visão geral)

```
WhatsApp → ai-attendant (VPS) ──HTTPS + x-simas-token──▶ /api/funil/leads
                    │                                          (cria lead + pré-cadastro do cliente)
                    └─ agenda no Cal.com ─┐
                                          ▼
     Cal.com ──HMAC x-cal-signature-256──▶ /api/funil/webhooks/calcom
                                          (BOOKING_CREATED/CANCELLED, idempotente por uid)
                                          ▼
                              Kanban /funil (equipe arrasta os cards)
```

- **Leads não guardam detalhes do caso** (LGPD): só nome, telefone, área, unidade,
  valor estimado e dados da consulta. O conteúdo jurídico fica no atendimento/cliente.
- Cada lead vincula-se a um **cliente** — se o telefone casar com um cliente
  existente, reusa (badge "cliente existente"); senão cria um **pré-cadastro**
  (`clientes.status_cadastro = 'pre_cadastro'`).

## Etapas

| Etapa | Quem move para lá | Observação |
|---|---|---|
| **Novo Lead** | ai-attendant (automático) | badge "parado" após 3 dias sem movimento |
| **Consulta Agendada** | ai-attendant / webhook Cal.com | grava data, formato e link do Meet |
| **Consulta Realizada** | humano | após a consulta acontecer |
| **Proposta Enviada** | humano | pede **valor estimado** (opcional) |
| **Contrato Fechado** | humano | **promove o cliente** para `ativo` (ver abaixo) |
| **Perdido** | humano | exige **motivo** (obrigatório); coluna recolhida |

**Regra da automação (spec §5):** a IA/sistema só avança na ordem e nunca marca
proposta/fechado/perdido, nunca volta um card, nunca tira um card dessas colunas.
Conflito humano×automação → a automação não faz nada, silenciosamente.

## Operação diária (equipe)

- **Arrastar** cards entre colunas. Mover para *Proposta* abre um campo de valor;
  mover para *Perdido* exige o motivo.
- **Abrir um card** (clicar) → drawer com contato, cliente, consulta, documentos
  (contratos + peças do cliente) e histórico. Botões de **WhatsApp/Chatwoot**,
  **"Gerar contrato de honorários"** (≥ Proposta) e **"Gerar procuração"**
  (Contrato Fechado).
- **Filtros**: unidade (SC/DF), área, busca por nome/telefone, "parados +3 dias".
- **Métricas** (`/funil/metricas`, admin/advogado): conversão, valores, tempo médio
  por etapa, motivos de perda, quebra por área/unidade — períodos de 7/30/90 dias.

## Promoção do cliente (Contrato Fechado)

Ao mover um card para **Contrato Fechado**, o cliente é promovido de
`pre_cadastro` → `ativo` **se o cadastro estiver completo** (nome + CPF + endereço).
Se faltar algo, a promoção não ocorre e o drawer mostra **"Completar cadastro"**
(→ `/clientes/{id}`). Toda promoção gera `logAudit('cliente.promover')`.

## Cron diário

`GET /api/cron/funil-consultas` (agendado no `vercel.json`, `0 11 * * *`, protegido
por `Bearer CRON_SECRET`): marca `aguardando_confirmacao = true` nos leads cuja
`consulta_data` já passou e que ainda estão em *Consulta Agendada*. A equipe então
confirma (→ Consulta Realizada) ou marca "não compareceu" (→ Novo Lead).

## Configuração

### Variáveis de ambiente (Vercel → Production)

| Env | Papel |
|---|---|
| `SIMAS_INTEGRATION_TOKEN` | token do header `x-simas-token`; **o mesmo valor** vai ao VPS como `SIMAS_TOKEN` |
| `CALCOM_WEBHOOK_SECRET` | secret dos webhooks do Cal.com (mesmo nas 2 contas) |
| `FUNIL_TENANT_ID` | UUID do tenant do escritório (piloto) |
| `FUNIL_UNIDADE_DEFAULT` | unidade padrão dos leads sem praça (`SC`) |
| `CHATWOOT_PUBLIC_URL` | base dos links de conversa (`https://atendimento.apoiojuridicodf.adv.br`) |
| `CHATWOOT_ACCOUNT_ID` | id da conta Chatwoot (`1`) |
| `CRON_SECRET` | já existente — reusado pelo cron do funil |

### Webhooks do Cal.com (nas DUAS contas)

Settings → Developer → Webhooks (ou API v2 `POST https://api.cal.com/v2/webhooks`
com a key de cada conta):

- **Subscriber URL**: `https://simas.app/api/funil/webhooks/calcom`
- **Eventos**: `BOOKING_CREATED`, `BOOKING_CANCELLED`
- **Secret**: o valor de `CALCOM_WEBHOOK_SECRET`
- Contas: Brasília/DF (event type `6211718`) e Santa Catarina/SC (`6211879`).

A assinatura é HMAC-SHA256 do **corpo bruto**, header `x-cal-signature-256`
(verificada com `timingSafeEqual`, fail-closed).

## Segurança

- Toda rota de integração é **fail-closed**: sem `x-simas-token` válido → 401; sem
  assinatura HMAC válida → 401; cron sem `Bearer CRON_SECRET` → 401.
- `funil_leads`/`funil_lead_eventos` têm **RLS por tenant**; a UI (`/funil`,
  `/funil/metricas`, `/api/funil/leads/:id/*`) usa a sessão do usuário.
- As rotas de integração usam `service_role` + `FUNIL_TENANT_ID` (sem sessão), por
  isso ficam isentas do redirect de login do middleware
  (`/api/funil/*`, `/api/cron/*`, `/api/webhooks/*`).

## Teste ponta a ponta (curl)

```bash
TOKEN=<SIMAS_INTEGRATION_TOKEN>
SECRET=<CALCOM_WEBHOOK_SECRET>

# 1) sem token → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://simas.app/api/funil/leads \
  -H 'Content-Type: application/json' -d '{"telefone":"+5548999990001"}'

# 2) cria lead + pré-cadastro
curl -s -X POST https://simas.app/api/funil/leads \
  -H "x-simas-token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"telefone":"(48) 99999-0001","nomeInformado":"Fulano","area":"previdenciario","unidade":"SC"}'

# 3) agendamento → consulta_agendada
curl -s -X POST https://simas.app/api/funil/leads/by-phone/5548999990001/agendamento \
  -H "x-simas-token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"calBookingUid":"uid-1","quando":"2026-07-10T14:00:00-03:00","formato":"online","meetUrl":"https://meet.google.com/x"}'

# 4) webhook Cal.com com HMAC válido
BODY='{"triggerEvent":"BOOKING_CREATED","payload":{"uid":"uid-2","startTime":"2026-07-12T13:00:00Z","attendees":[{"name":"Maria","email":"m@x.com","phoneNumber":"+5548988887777"}]}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://simas.app/api/funil/webhooks/calcom \
  -H "x-cal-signature-256: $SIG" -H 'Content-Type: application/json' -d "$BODY"
```

Na UI, complete o fluxo: confirmar consulta → proposta com valor → contrato
fechado (promoção do cliente) → documentos no drawer → métricas.

## Rollback

O módulo é **isolado** (rotas `/funil` e `/api/funil` novas; migration aditiva).
Para desativar sem remover dados:

1. **Parar a entrada de leads**: remover/rotacionar `SIMAS_INTEGRATION_TOKEN` na
   Vercel e no VPS (`SIMAS_TOKEN`) e desabilitar os webhooks no Cal.com. As rotas
   passam a responder 401 e nada é criado.
2. **Esconder a tela**: remover o item "Funil" da Sidebar
   (`src/components/layout/Sidebar.tsx`) e, se quiser, o cron do `vercel.json`.
3. **Reverter código**: os lotes da Fase 4 são commits coesos na `main` — dá para
   `git revert` do range sem tocar em outros módulos.

Os dados (`funil_leads`, `funil_lead_eventos`, `clientes.status_cadastro/origem`)
permanecem; a migration 040 é aditiva e não precisa ser desfeita. Para remover só
os dados de teste, use os critérios de `origem`/nome `[TESTE]`.

## Fora de escopo (v2)

Anonimização de perdidos após 12 meses · badge "contrato assinado" via webhook
D4Sign · follow-up automático · instância `whatsapp-df` · tokens de integração por
tenant (multi-tenant) · integrações Astrea/ZapSign/Asaas.
