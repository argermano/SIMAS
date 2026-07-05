# Plano Fase 4 — Funil Comercial (Kanban de leads) — ADAPTADO ao SIMAS real

> **Origem:** especificação externa v2 (`especificacao-kanban-simas-v2.md` + `prompt-claude-code-kanban-v2.md` + `handoff-atendimento.md`), escrita por IA **sem o contexto do SIMAS**. Este plano é a **revisão do Fable contra o código real** (2026-07-05): preserva o produto e o contrato de integração da spec, e corrige as premissas técnicas erradas. **Em conflito entre a spec original e este plano, vale este plano.** Execução: Opus.
> Documentos originais anexados na sessão; o **contrato de API com o ai-attendant (spec §6) permanece válido byte a byte** — o lado do VPS será construído contra ele.

---

## §0 — Divergências da spec × SIMAS real (o que foi adaptado e por quê)

| # | A spec assume | O SIMAS real | Adaptação |
|---|---|---|---|
| 1 | **Prisma** (schema.prisma, enums, cuid) | Supabase direto: migrations SQL em `supabase/migrations/*.sql`, `@supabase/supabase-js`, RLS `get_user_tenant_id()` | Migration SQL **040** (snake_case, `CHECK` no lugar de enum, uuid) — sem Prisma |
| 2 | Single-tenant "modelada p/ multi-tenant futuro" | SIMAS **já é multi-tenant** com RLS em tudo | `tenant_id` + RLS **desde o dia 1** nas tabelas novas; rotas de integração resolvem o tenant via env `FUNIL_TENANT_ID` (piloto = 1 escritório; multi-tenant futuro = tabela de tokens por tenant, pendência) |
| 3 | Auth a decidir (role vs `FUNIL_ALLOWED_EMAILS`) | Supabase Auth + `users.role ∈ {admin, advogado, colaborador}` + `getAuthContext`/`requireRole` | **Roles existentes, sem allowlist**: quadro `/funil` para qualquer usuário do tenant; `/funil/metricas` só `admin`/`advogado` |
| 4 | "Explorar o modelo de cliente e propor extensão" | `clientes` (nome, cpf🔒, telefone, email, endereco…, `deleted_at` soft-delete; **sem** status/origem) | Colunas aditivas: `status_cadastro` (`'ativo'` default \| `'pre_cadastro'`) e `origem` — nada existente muda |
| 5 | "Descobrir rotas de geração; propor mudança se preciso" | **Já confirmado no código:** `/contratos/novo?cliente_id={id}` e `/{area}/modelos/procuracao?clienteId={id}` aceitam pré-seleção HOJE | Integração é **só navegação** — zero mudança nos módulos de peças/contratos |
| 6 | Job diário genérico + `CRON_SECRET` novo | `CRON_SECRET` **já existe** (Vercel) e `vercel.json` tem 1 cron (plano Hobby permite 2) | Reusar `CRON_SECRET`; adicionar o 2º cron. **Não criar env nova** |
| 7 | Webhook HMAC "a implementar" | Padrão pronto no repo: webhook D4Sign (fail-closed, `timingSafeEqual`, service_role) | Cal.com segue o mesmo padrão; HMAC sobre o **corpo bruto** (`req.text()` antes do parse) |
| 8 | dnd-kit "ou lib do projeto" | dnd-kit **já instalado e usado** (`KanbanBoard.tsx` de tarefas) | Reusar padrões (sensors, KeyboardSensor, modais); tabelas do funil são novas (`funil_*`), sem tocar no kanban de tarefas |
| 9 | Branch `feature/funil-comercial` + PR, sem deploy | O fluxo real do repo é **lotes na main** (deploy Vercel automático; CI na main; sem prática de PR) | **Adaptado para lotes + pontos de parada** (módulo isolado em rotas novas; migrations aditivas). ⚠️ *Se o dono preferir branch+PR, dizer ao Opus antes de começar* |
| 10 | Opção A/B para o ai-attendant | O repo `omnichannel` (VPS) **não está neste workspace** | **Opção B obrigatória**: entregar `docs/INTEGRACAO-AI-ATTENDANT.md` com snippets prontos p/ colar (âncoras do handoff §3.2), payloads, curls e passo de deploy |
| 11 | Timeline/auditoria via `LeadEvento` | Existe também `logAudit` | `funil_lead_eventos` é a trilha do funil; `logAudit` adicional só na **promoção do cliente** (`cliente.promover`) |
| 12 | `area` limitada a 6 valores | SIMAS tem 11 áreas (`AREAS`/`LABELS_AREA`) | `area` = TEXT livre; UI mostra `LABELS_AREA[area] ?? area`; aceitar `'outro'` |

**Também confirmado no código real:** telefone de `clientes` é TEXT com máscara BR (sem normalização) → matching por **dígitos** (helper novo); dossiê do cliente é `/clientes/{id}` ("Abrir cadastro"/"Completar cadastro" apontam para lá); documentos do cliente = `contratos_honorarios.cliente_id` + peças via atendimentos do cliente (mesma consulta do dossiê).

---

## Regras de execução

1. Um lote = commit coeso na main; `tsc` + `npm test` + `npm run build` antes de push. Migrations idempotentes via `scripts/run-migrations.mjs` (aplicar em produção no lote da migration).
2. Módulo deve parecer nativo: componentes/ui existentes, `Header`, `Card`, toasts, dark mode com tokens, pt-BR, `Intl.NumberFormat('pt-BR')` p/ BRL, timezone America/Sao_Paulo.
3. Segurança fail-closed em TODAS as superfícies de integração (token ausente → 401; assinatura inválida → 401), padrão do webhook D4Sign e do cron.
4. Nada de detalhe de caso no funil (LGPD): card guarda só `area` em uma palavra; matéria vive nas peças/Astrea.
5. Em ambiguidade real de produto, parar e perguntar. As decisões abaixo não se reabrem.

---

## Modelo de dados — migration `040_funil_comercial.sql`

```sql
-- Clientes: pré-cadastro (aditivo)
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS status_cadastro TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status_cadastro IN ('ativo','pre_cadastro','inativo')),
  ADD COLUMN IF NOT EXISTS origem TEXT;

CREATE TABLE IF NOT EXISTS funil_leads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id    UUID NOT NULL REFERENCES clientes(id),
  nome_informado TEXT,
  telefone      TEXT NOT NULL,          -- E.164
  email         TEXT,
  area          TEXT,
  unidade       TEXT NOT NULL DEFAULT 'SC',   -- 'DF' | 'SC'
  origem        TEXT NOT NULL DEFAULT 'whatsapp',
  etapa         TEXT NOT NULL DEFAULT 'novo_lead'
    CHECK (etapa IN ('novo_lead','consulta_agendada','consulta_realizada',
                     'proposta_enviada','contrato_fechado','perdido')),
  valor_estimado NUMERIC,
  motivo_perda  TEXT CHECK (motivo_perda IN ('sem_retorno','achou_caro','fechou_com_outro',
                     'sem_viabilidade_juridica','fora_da_area_de_atuacao','desistiu','outro')),
  motivo_perda_obs TEXT,
  chatwoot_conversation_id INTEGER,
  cal_booking_uid TEXT,
  consulta_data TIMESTAMPTZ,
  consulta_formato TEXT,                -- 'presencial' | 'online'
  meet_url      TEXT,
  aguardando_confirmacao BOOLEAN NOT NULL DEFAULT false,
  sugerir_perda BOOLEAN NOT NULL DEFAULT false,
  consulta_cancelada BOOLEAN NOT NULL DEFAULT false,  -- badge "consulta cancelada" (spec §5)
  ultimo_contato_em TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funil_leads_tenant_etapa ON funil_leads (tenant_id, etapa);
CREATE INDEX IF NOT EXISTS idx_funil_leads_telefone     ON funil_leads (tenant_id, telefone);
CREATE INDEX IF NOT EXISTS idx_funil_leads_cliente      ON funil_leads (cliente_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_funil_leads_booking
  ON funil_leads (cal_booking_uid) WHERE cal_booking_uid IS NOT NULL;  -- idempotência

CREATE TABLE IF NOT EXISTS funil_lead_eventos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES funil_leads(id) ON DELETE CASCADE,
  de_etapa   TEXT,
  para_etapa TEXT NOT NULL,
  ator       TEXT NOT NULL CHECK (ator IN ('ia','humano','sistema')),
  ator_nome  TEXT,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funil_eventos_lead ON funil_lead_eventos (lead_id);

-- RLS padrão do repo
ALTER TABLE funil_leads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE funil_lead_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_funil_leads ON funil_leads
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation_funil_eventos ON funil_lead_eventos
  USING (lead_id IN (SELECT id FROM funil_leads WHERE tenant_id = get_user_tenant_id()));
```

## Regras de negócio (da spec, mantidas — resumo normativo)

- **Pré-cadastro (spec §2):** entrada de lead → normalizar telefone → buscar cliente por dígitos do telefone (e e-mail) com `deleted_at IS NULL` → vincular (badge "Cliente existente") ou criar `clientes` com `status_cadastro='pre_cadastro'`, `origem='atendimento-whatsapp'`, só nome/telefone/unidade. **Dedup:** lead ATIVO por telefone é único (etapas não-terminais → atualiza `ultimo_contato_em`); lead terminal → novo lead no MESMO cliente.
- **Movimentação (spec §5):** IA/SISTEMA nunca move para trás, nunca tira de proposta/fechado/perdido, nunca marca perdido; conflito → silêncio. HUMANO move qualquer coisa (modal de valor em proposta; motivo OBRIGATÓRIO em perdido). `contrato_fechado` → promoção do cliente (`status_cadastro='ativo'`; exige nome+CPF+endereço — senão UI leva a "Completar cadastro" em `/clientes/{id}`) + `logAudit('cliente.promover')` + atalhos de geração.
- **Consulta:** `BOOKING_CANCELLED` → seta `consulta_cancelada=true` (volta a novo_lead só por humano). Cron diário: `consulta_data` passou e etapa `consulta_agendada` → `aguardando_confirmacao=true`; humano confirma (→ consulta_realizada) ou "não compareceu" (→ novo_lead), sempre com evento.

## API (contrato da spec §6 — PRESERVADO; detalhes de implementação)

| Rota | Auth | Notas de implementação |
|---|---|---|
| `POST /api/funil/leads` | `x-simas-token` = `SIMAS_INTEGRATION_TOKEN` (timingSafeEqual, fail-closed) | service_role + `FUNIL_TENANT_ID`; upsert §2; `unidade` default `FUNIL_UNIDADE_DEFAULT` |
| `PATCH /api/funil/leads/by-phone/:telefone` | idem | atualiza nome/area/email/ultimo_contato_em do lead ativo; 404 silencioso (200 ok:false) se não houver |
| `POST /api/funil/leads/by-phone/:telefone/agendamento` | idem | move p/ consulta_agendada (respeitando restrições); grava uid/data/formato/meet |
| `POST /api/funil/webhooks/calcom` | HMAC `x-cal-signature-256` sobre **corpo bruto**, secret `CALCOM_WEBHOOK_SECRET` (fail-closed) | idempotente por `cal_booking_uid` (unique index); matching uid → fallback telefone/email; CREATED sem lead → cria lead+pré-cadastro já em consulta_agendada |
| `PATCH /api/funil/leads/:id/etapa` | sessão (getAuthContext) | valida regras §5; grava evento `humano` com nome do usuário |
| `GET /api/funil/metrics` | sessão + `requireRole(['admin','advogado'])` | contagens/valores por etapa, conversão, tempo médio (via eventos), motivos de perda, por área/unidade |
| `GET /api/cron/funil-consultas` | `Bearer CRON_SECRET` (padrão lembretes-prazo) | job diário §5; adicionar ao `vercel.json` (2º cron — Hobby permite 2) |

## Telas (spec §7, com padrões do repo)

- **`/funil`** — 6 colunas (Perdido recolhida), dnd-kit (padrões do KanbanBoard de tarefas: PointerSensor distance 8 + KeyboardSensor), header de coluna com contagem + soma BRL, cards com badges (⚠ +3d parado em novo_lead · 🕐 aguardando confirmação · ❌ consulta cancelada · 🤖 sugerir perda · 👤 cliente existente), link Chatwoot (`CHATWOOT_PUBLIC_URL/app/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/{id}`; fallback `wa.me/{telefone}`), filtros persistentes (unidade/área/parados/busca). Item **"Funil"** na Sidebar.
- **Drawer do lead** — contato/área/consulta/valor; bloco **Cliente** (status do cadastro + "Abrir cadastro"/"Completar cadastro" → `/clientes/{id}`); bloco **Documentos** (contratos do cliente + peças via atendimentos; links); ações por etapa: **"Gerar contrato de honorários"** → `/contratos/novo?cliente_id={id}` (≥ proposta_enviada) e **"Gerar procuração"** → `/{area||'civel'}/modelos/procuracao?clienteId={id}` (contrato_fechado); timeline de eventos.
- **`/funil/metricas`** — resumo do período (7d/30d/90d), funil de conversão, quebras por unidade/área, ranking de motivos de perda, tempo médio por etapa (reusar padrões visuais do PainelConsumoIA).

## Envs novas (documentar; `CRON_SECRET` já existe — NÃO recriar)

```
SIMAS_INTEGRATION_TOKEN=   # token forte; mesmo valor vai ao VPS como SIMAS_TOKEN
CALCOM_WEBHOOK_SECRET=     # secret dos webhooks nas DUAS contas Cal.com
FUNIL_TENANT_ID=           # uuid do tenant do escritório (piloto)
FUNIL_UNIDADE_DEFAULT=SC
CHATWOOT_PUBLIC_URL=https://atendimento.apoiojuridicodf.adv.br
CHATWOOT_ACCOUNT_ID=1
```

## Lotes (ordem de execução)

| Lote | Conteúdo | Testes | Parada |
|---|---|---|---|
| **1** | Migration 040 (aplicar em prod) + `lib/funil/telefone.ts` (normalização E.164 + matching por dígitos) + `lib/funil/leads.ts` (upsert com pré-cadastro/dedup/vínculo) + regras de movimentação puras (`podeMover(ator, de, para)`) | unitários: telefone, dedup, cliente existente, proibições da IA, conflito | — |
| **2** | Rotas de integração + webhook Cal.com + cron (`vercel.json`) | token válido/inválido; HMAC válido/inválido; idempotência por uid | 🛑 dono: criar envs na Vercel, configurar webhook nas 2 contas Cal.com, `FUNIL_TENANT_ID` |
| **3** | Tela `/funil` (kanban completo + modais + filtros) + Sidebar | — | — |
| **4** | Drawer (Cliente/Documentos/timeline/gerações) + promoção no contrato_fechado | promoção (completo/incompleto) | 🛑 dono: validação visual + fluxo curl ponta a ponta |
| **5** | `/funil/metricas` + `docs/funil-comercial.md` (uso/operação/rollback + config Cal.com) + `docs/INTEGRACAO-AI-ATTENDANT.md` (snippets prontos ancorados no handoff §3.2: helper `notifySimas` fire-and-forget 3s/1 retry + ganchos (a) e (b) + envs `SIMAS_URL`/`SIMAS_TOKEN` + deploy `redeploy.sh` com `node --check`) | — | 🛑 dono: aplicar snippets no VPS |

**Definition of Done** = o da spec (fluxo curl ponta a ponta demonstrável: lead → pré-cadastro → agendamento → webhook idempotente → confirmação → proposta c/ valor → contrato fechado c/ promoção → documentos no drawer → métricas), sem regressão nos módulos existentes.

## Fora de escopo / pendências (mantidas da spec §8)

Anonimização de perdidos após 12 meses · badge "contrato assinado" automático (o sinal existe — `contract_signatures`/webhook D4Sign — mas é v2) · follow-up automático · instância `whatsapp-df` (rever default de unidade) · tokens de integração por tenant (multi-tenant) · Astrea/ZapSign/Asaas.

---

*Preparado pelo Fable em 2026-07-05, após verificação dos pontos de integração no código real. Para executar: apontar o Opus para este arquivo (+ os 3 documentos originais como contexto) e pedir a execução dos lotes 1 → 5, respeitando as paradas.*
