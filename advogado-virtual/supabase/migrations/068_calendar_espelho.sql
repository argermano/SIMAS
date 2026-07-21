-- ============================================================
-- 068_calendar_espelho.sql — espelho ATIVO da agenda no Google Calendar
-- A assinatura ICS (feed por URL) do Google Agenda falha em produção apesar do
-- feed correto. Alternativa: espelhar ATIVAMENTE os eventos de cada usuário num
-- calendário 'SIMAS' criado no Google Calendar dele, via Calendar API (MESMA
-- service account do Drive, impersonando o e-mail — só e-mails do DOMÍNIO
-- Workspace; fora do domínio segue no feed ICS). Ver src/lib/calendar/{api,espelho}.ts.
--
-- Duas tabelas de BOOKKEEPING internas (nenhuma UI lê):
--  • calendar_espelho: mapeia cada evento LÓGICO do SIMAS ("fonte:rawId") ao id
--    do evento no Google — torna a reconciliação idempotente (upsert/remover sem
--    duplicar) e permite remover o que sumiu.
--  • calendar_sync_fila: usuários a espelhar (dedup natural pela PK user_id).
-- INVARIANTE do módulo: o espelho só REPLICA eventos existentes — prazo nunca é
-- calculado aqui. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_espelho (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- id do calendário 'SIMAS' do usuário no Google (destino dos eventos).
  calendar_google_id TEXT,
  -- id LÓGICO do evento no SIMAS ("fonte:rawId", ex.: 'evento:abc', 'tarefa:xyz').
  evento_ref         TEXT NOT NULL,
  -- id do evento no Google (derivado estável do evento_ref — md5 hex).
  google_event_id    TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Um evento lógico → no máximo um evento no calendário do usuário.
  UNIQUE (user_id, evento_ref)
);

-- Lição da 066: coluna nova em tabela que PODE já existir sempre via ALTER
-- explícito (o CREATE ... IF NOT EXISTS vira no-op na re-execução).
ALTER TABLE calendar_espelho ADD COLUMN IF NOT EXISTS calendar_google_id TEXT;

-- Reconciliação carrega o bookkeeping por usuário; consultas de limpeza por tenant.
CREATE INDEX IF NOT EXISTS idx_calendar_espelho_user   ON calendar_espelho (user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_espelho_tenant ON calendar_espelho (tenant_id);

DROP TRIGGER IF EXISTS calendar_espelho_updated_at ON calendar_espelho; -- idempotência (rerun)
CREATE TRIGGER calendar_espelho_updated_at
  BEFORE UPDATE ON calendar_espelho
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Fila de usuários a espelhar. PK = user_id → dedup natural (enfileirar 2x = no-op).
CREATE TABLE IF NOT EXISTS calendar_sync_fila (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enfileirado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- CLAIM do drenador (cron × botão "Sincronizar agora"): NULL = livre; um valor
  -- mais velho que a janela stale volta a ser elegível (dreno que morreu no meio).
  -- Claim = UPDATE condicional atômico (ver processarFilaCalendar). Duplicar o
  -- espelho de um usuário criaria eventos repetidos no Google.
  processando_em TIMESTAMPTZ
);

-- Lição da 066: coluna do claim via ALTER explícito também.
ALTER TABLE calendar_sync_fila ADD COLUMN IF NOT EXISTS processando_em TIMESTAMPTZ;

-- Drenagem "mais antigo primeiro".
CREATE INDEX IF NOT EXISTS idx_calendar_sync_fila_ordem ON calendar_sync_fila (enfileirado_em);

-- RLS service-only: BOOKKEEPING do motor, escrito só pelo service_role (bypassa
-- RLS). Habilitamos RLS SEM policy → nenhum anon/authenticated lê/escreve (padrão
-- das tabelas internas; ver 066_drive_espelho.sql).
ALTER TABLE calendar_espelho   ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_sync_fila ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE calendar_espelho IS
  'Bookkeeping do espelho ATIVO no Google Calendar: evento lógico do SIMAS (user_id+evento_ref) → id do evento no Google. Torna a reconciliação idempotente. Service-only (RLS sem policy). Ver 068 e src/lib/calendar/espelho.ts.';
COMMENT ON TABLE calendar_sync_fila IS
  'Fila de usuários a espelhar no Google Calendar (dedup pela PK user_id). processarFilaCalendar drena. Service-only. Ver 068.';
COMMENT ON COLUMN calendar_sync_fila.processando_em IS
  'Claim atômico do dreno (cron × botão): NULL = livre; timestamp velho (>15min) = dreno morto, pode reclamar.';
