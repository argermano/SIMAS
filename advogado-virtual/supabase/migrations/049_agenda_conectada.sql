-- ============================================================
-- 049_agenda_conectada.sql — Agenda Conectada (Lote 1)
-- Peça 1: feed ICS pessoal (agenda_ics_tokens + ics_sequence p/ convites).
-- Peça 3: presença da advogada por unidade (marcação manual por data).
-- Nível 1 de sincronização: feed ICS + convites por e-mail — SEM OAuth/Graph.
-- ============================================================

-- ─── Tokens do feed ICS pessoal (1 token por usuário) ────────────────────────
-- O token é a credencial única do feed público /api/agenda/ics/<token>.
-- Rotacionar = trocar `token` + carimbar `rotated_at` (invalida o link antigo).
CREATE TABLE IF NOT EXISTS agenda_ics_tokens (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agenda_ics_tokens_tenant
  ON agenda_ics_tokens (tenant_id);

-- ─── SEQUENCE de convite ICS (RFC 5545) por evento ───────────────────────────
-- Incrementado a cada PATCH que reenvia convite (METHOD:REQUEST atualizado).
ALTER TABLE agenda_eventos
  ADD COLUMN IF NOT EXISTS ics_sequence INTEGER NOT NULL DEFAULT 0;

-- ─── Presenças da advogada por unidade (marcação manual por data) ────────────
CREATE TABLE IF NOT EXISTS presencas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       DATE NOT NULL,
  unidade    TEXT NOT NULL
               CHECK (unidade IN ('brasilia', 'florianopolis', 'blumenau')),
  observacao TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, data)
);

CREATE INDEX IF NOT EXISTS idx_presencas_tenant_data
  ON presencas (tenant_id, data);
CREATE INDEX IF NOT EXISTS idx_presencas_tenant_unidade_data
  ON presencas (tenant_id, unidade, data);

DROP TRIGGER IF EXISTS presencas_updated_at ON presencas;
CREATE TRIGGER presencas_updated_at
  BEFORE UPDATE ON presencas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Row Level Security (isolamento por tenant via get_user_tenant_id()) ─────
ALTER TABLE agenda_ics_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE presencas         ENABLE ROW LEVEL SECURITY;

-- O token é uma CREDENCIAL: RLS por USUÁRIO (não só por tenant), senão qualquer
-- membro do tenant leria (ou pré-inseriria) o token alheio via PostgREST e
-- assinaria o feed pessoal de outra pessoa (que inclui os particulares dela).
DROP POLICY IF EXISTS tenant_isolation_agenda_ics_tokens ON agenda_ics_tokens;
DROP POLICY IF EXISTS agenda_ics_tokens_proprio ON agenda_ics_tokens;
CREATE POLICY agenda_ics_tokens_proprio ON agenda_ics_tokens
  FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
  );

-- Presenças alimentam um canal EXTERNO (bot → cliente): leitura para todo o
-- tenant, mutação só admin/advogado — o MESMO gate de /api/agenda/presencas,
-- reforçado no banco para não ser contornável via PostgREST.
DROP POLICY IF EXISTS tenant_isolation_presencas ON presencas;
DROP POLICY IF EXISTS presencas_select_tenant ON presencas;
CREATE POLICY presencas_select_tenant ON presencas
  FOR SELECT USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS presencas_mutacao_gestao ON presencas;
CREATE POLICY presencas_mutacao_gestao ON presencas
  FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE auth_user_id = auth.uid()) IN ('admin', 'advogado')
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE auth_user_id = auth.uid()) IN ('admin', 'advogado')
  );

COMMENT ON TABLE agenda_ics_tokens IS 'Token do feed ICS pessoal (1 por usuário). O token É a credencial: lookup exato, 404 genérico, nunca logar.';
COMMENT ON COLUMN agenda_eventos.ics_sequence IS 'SEQUENCE (RFC 5545) do convite por e-mail; incrementa a cada atualização enviada.';
COMMENT ON TABLE presencas IS 'Presença da advogada por unidade, marcação manual por data (sem motor de recorrência).';
COMMENT ON COLUMN presencas.unidade IS 'Slug da unidade: brasilia | florianopolis | blumenau (rótulos em src/lib/agenda/presenca.ts).';
