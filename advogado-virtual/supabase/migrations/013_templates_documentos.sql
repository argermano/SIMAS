-- Migration 013: Templates de documentos por tenant
-- Armazena templates de procuração, declaração e contrato para reuso sem IA

CREATE TABLE templates_documentos (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo              TEXT        NOT NULL CHECK (tipo IN ('contrato', 'procuracao', 'declaracao_hipossuficiencia')),
  conteudo_markdown TEXT        NOT NULL,
  criado_por        UUID        REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tipo)
);

-- Trigger para updated_at automático
CREATE TRIGGER update_templates_updated_at
  BEFORE UPDATE ON templates_documentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE templates_documentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_templates"
  ON templates_documentos
  FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- Índice de busca por tipo
CREATE INDEX idx_templates_tenant_tipo ON templates_documentos (tenant_id, tipo);
