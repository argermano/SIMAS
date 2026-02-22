-- ============================================================
-- 005_rls_policies.sql
-- Row Level Security — isolamento por tenant
-- ============================================================

-- Ativa RLS em todas as tabelas
ALTER TABLE tenants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE atendimentos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE analises      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pecas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pecas_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE exportacoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_log ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- Função helper: extrai tenant_id do usuário autenticado
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id
  FROM users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─────────────────────────────────────────────────────────────
-- Políticas: cada usuário só vê dados do seu tenant
-- ─────────────────────────────────────────────────────────────

-- Tenants: admin só vê o próprio tenant
CREATE POLICY "tenant: ver próprio" ON tenants
  FOR SELECT USING (id = get_user_tenant_id());

-- Users: ver usuários do mesmo tenant
CREATE POLICY "users: ver do tenant" ON users
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "users: gerenciar próprio" ON users
  FOR ALL USING (auth_user_id = auth.uid());

-- Clientes
CREATE POLICY "clientes: tenant isolation" ON clientes
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Atendimentos
CREATE POLICY "atendimentos: tenant isolation" ON atendimentos
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Documentos
CREATE POLICY "documentos: tenant isolation" ON documentos
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Análises
CREATE POLICY "analises: tenant isolation" ON analises
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Peças
CREATE POLICY "pecas: tenant isolation" ON pecas
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Versões de peças
CREATE POLICY "pecas_versoes: via peca" ON pecas_versoes
  FOR ALL USING (
    peca_id IN (
      SELECT id FROM pecas WHERE tenant_id = get_user_tenant_id()
    )
  );

-- Exportações
CREATE POLICY "exportacoes: tenant isolation" ON exportacoes
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Log de uso
CREATE POLICY "api_usage_log: tenant isolation" ON api_usage_log
  FOR ALL USING (tenant_id = get_user_tenant_id());
