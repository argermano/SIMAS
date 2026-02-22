-- ============================================================
-- 001_tenants_users.sql
-- Escritórios (tenants) e usuários do sistema
-- ============================================================

CREATE TABLE tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  cnpj       TEXT,
  plano      TEXT NOT NULL DEFAULT 'trial',   -- trial | basico | profissional
  status     TEXT NOT NULL DEFAULT 'ativo',   -- ativo | suspenso | cancelado
  config     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenants IS 'Escritórios de advocacia — cada um é um tenant isolado';

-- ─────────────────────────────────────────────────────────────

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  auth_user_id UUID UNIQUE,              -- referência ao auth.users do Supabase
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'advogado', -- admin | advogado | revisor | estagiario
  status      TEXT NOT NULL DEFAULT 'ativo',
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS 'Usuários vinculados a um escritório';

CREATE INDEX idx_users_tenant    ON users(tenant_id);
CREATE INDEX idx_users_email     ON users(email);
CREATE INDEX idx_users_auth_user ON users(auth_user_id);

-- ─────────────────────────────────────────────────────────────
-- Trigger para atualizar updated_at automaticamente
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- Dado inicial: tenant padrão para MVP (1 escritório fixo)
-- ─────────────────────────────────────────────────────────────

INSERT INTO tenants (nome, plano, status)
VALUES ('Meu Escritório', 'trial', 'ativo');
