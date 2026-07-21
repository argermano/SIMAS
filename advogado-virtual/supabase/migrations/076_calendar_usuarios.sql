-- ============================================================
-- 076_calendar_usuarios.sql — registro do calendário 'SIMAS' de cada usuário
-- no Google, DESACOPLADO do users/me/calendarList.
--
-- PROBLEMA (auditoria 2026-07-21): com GOOGLE_CALENDAR_SCOPE=calendar.app.created
-- TODAS as chamadas do dreno davam HTTP 403 — garantirCalendarioSimas LOCALIZAVA
-- o calendário via users/me/calendarList, método FORA do escopo app.created (esse
-- escopo só enxerga os calendários que o PRÓPRIO app criou). Segunda causa latente:
-- o calendário 'SIMAS' já existente foi criado sob o escopo amplo e pode não ser
-- "do app", ficando invisível/inalcançável sob o escopo estreito.
--
-- CORREÇÃO: guardamos o id do calendário de cada usuário nesta tabela. O motor
-- (src/lib/calendar/api.ts) passa a fazer um PROBE barato (calendars.get, permitido
-- sob app.created para calendários do app) e RECRIA quando o calendário está
-- invisível/apagado — sem NUNCA tocar users/me/calendarList. Compatível com AMBOS
-- os escopos (o código não depende de qual está ativo).
--
-- BOOKKEEPING interno do motor (nenhuma UI lê): service-only (RLS sem policy, como
-- calendar_espelho/calendar_sync_fila da 068). Lição da 066/068: coluna nova em
-- tabela que PODE já existir sempre via ALTER explícito. Idempotente.
-- NÃO aplicar à mão (o orquestrador aplica antes do deploy).
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_usuarios (
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Um calendário 'SIMAS' por usuário → user_id é a PK (dedup natural).
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- id do calendário 'SIMAS' do usuário no Google (destino do espelho).
  calendar_google_id TEXT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lição da 066/068: colunas via ALTER explícito também (re-execução = no-op).
ALTER TABLE calendar_usuarios ADD COLUMN IF NOT EXISTS calendar_google_id TEXT;
ALTER TABLE calendar_usuarios ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Consultas de limpeza por tenant (o lookup do motor é pela PK user_id).
CREATE INDEX IF NOT EXISTS idx_calendar_usuarios_tenant ON calendar_usuarios (tenant_id);

DROP TRIGGER IF EXISTS calendar_usuarios_updated_at ON calendar_usuarios; -- idempotência (rerun)
CREATE TRIGGER calendar_usuarios_updated_at
  BEFORE UPDATE ON calendar_usuarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS service-only: BOOKKEEPING do motor, escrito só pelo service_role (bypassa
-- RLS). Habilitamos RLS SEM policy → nenhum anon/authenticated lê/escreve (padrão
-- das tabelas internas; ver 068_calendar_espelho.sql / 072).
ALTER TABLE calendar_usuarios ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE calendar_usuarios IS
  'Registro do calendário SIMAS de cada usuário no Google (user_id → calendar_google_id). Substitui a localização via users/me/calendarList (fora do escopo app.created). Service-only (RLS sem policy). Ver 076 e src/lib/calendar/api.ts.';

-- SEED: adota o id do calendário JÁ existente por usuário a partir do bookkeeping
-- de eventos (calendar_espelho), ignorando registros sem id. DISTINCT ON (user_id)
-- pega o mais recente. ON CONFLICT DO NOTHING → re-execução não sobrescreve.
INSERT INTO calendar_usuarios (tenant_id, user_id, calendar_google_id)
SELECT DISTINCT ON (user_id) tenant_id, user_id, calendar_google_id
  FROM calendar_espelho
 WHERE calendar_google_id IS NOT NULL
 ORDER BY user_id, updated_at DESC
ON CONFLICT (user_id) DO NOTHING;
