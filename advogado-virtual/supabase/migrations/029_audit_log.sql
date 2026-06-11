-- ============================================================
-- 029_audit_log.sql
-- Trilha de auditoria para operações sensíveis (convites, mudança de
-- role/status, remoções de usuário, etc.) — rastreabilidade para
-- compliance, forense e disputas (SaaS jurídico).
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,  -- quem executou
  action        TEXT NOT NULL,            -- ex.: 'user.invite', 'user.role_change', 'user.delete'
  resource_type TEXT NOT NULL,            -- ex.: 'user', 'contrato', 'peca'
  resource_id   TEXT,                     -- id do recurso afetado
  metadata      JSONB NOT NULL DEFAULT '{}',  -- valores antigos/novos, contexto
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant  ON audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log (tenant_id, action);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Leitura: usuários veem apenas a auditoria do próprio tenant.
DROP POLICY IF EXISTS audit_log_tenant_select ON audit_log;
CREATE POLICY audit_log_tenant_select ON audit_log
  FOR SELECT USING (tenant_id = get_user_tenant_id());

-- Escrita é feita server-side (service_role bypassa RLS); sem policy de INSERT
-- para clients, evitando forja de registros de auditoria pelo usuário.
