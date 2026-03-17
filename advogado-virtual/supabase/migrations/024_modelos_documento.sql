-- Migration 024: Modelos de documento genéricos (padrões do escritório)
-- Permite múltiplos modelos por tipo: peça, contrato, procuração, declaração

CREATE TABLE IF NOT EXISTS modelos_documento (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo              TEXT        NOT NULL CHECK (tipo IN ('peca', 'contrato', 'procuracao', 'declaracao', 'substabelecimento')),
  titulo            TEXT        NOT NULL,
  descricao         TEXT,
  conteudo_markdown TEXT,
  file_url          TEXT,
  created_by        UUID        REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger para updated_at automático
CREATE TRIGGER update_modelos_documento_updated_at
  BEFORE UPDATE ON modelos_documento
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE modelos_documento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_modelos_documento"
  ON modelos_documento
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE auth_user_id = auth.uid()));

-- Índices
CREATE INDEX idx_modelos_documento_tenant ON modelos_documento (tenant_id);
CREATE INDEX idx_modelos_documento_tipo ON modelos_documento (tenant_id, tipo);
