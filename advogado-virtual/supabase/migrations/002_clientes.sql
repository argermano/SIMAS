-- ============================================================
-- 002_clientes.sql
-- Clientes / dossiês dos escritórios
-- ============================================================

CREATE TABLE clientes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  cpf        TEXT,           -- armazenado criptografado na aplicação
  telefone   TEXT,
  email      TEXT,
  endereco   TEXT,
  notas      TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE clientes IS 'Clientes / dossiês dos escritórios';
COMMENT ON COLUMN clientes.cpf IS 'CPF armazenado criptografado — descriptografar apenas na aplicação';

CREATE INDEX idx_clientes_tenant ON clientes(tenant_id);
CREATE INDEX idx_clientes_nome   ON clientes(tenant_id, nome);

CREATE TRIGGER clientes_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
