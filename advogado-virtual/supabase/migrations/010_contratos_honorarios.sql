-- Migration 010: Contrato de Honorários Inteligente
-- Tabelas: contratos_honorarios + contratos_versoes

CREATE TABLE IF NOT EXISTS contratos_honorarios (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id          UUID REFERENCES clientes(id) ON DELETE SET NULL,
  atendimento_id      UUID REFERENCES atendimentos(id) ON DELETE SET NULL,
  area                TEXT,
  titulo              TEXT NOT NULL DEFAULT 'Contrato de Prestação de Serviços Advocatícios',
  conteudo_markdown   TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho', 'em_revisao', 'aprovado', 'exportado')),
  versao              INTEGER NOT NULL DEFAULT 1,
  valor_fixo          DECIMAL(12,2),
  percentual_exito    DECIMAL(5,2),
  forma_pagamento     TEXT,
  modelo_advogado_url TEXT,
  criado_por          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contratos_versoes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id       UUID NOT NULL REFERENCES contratos_honorarios(id) ON DELETE CASCADE,
  conteudo_markdown TEXT NOT NULL,
  versao            INTEGER NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_contratos_tenant   ON contratos_honorarios (tenant_id);
CREATE INDEX IF NOT EXISTS idx_contratos_cliente  ON contratos_honorarios (cliente_id);
CREATE INDEX IF NOT EXISTS idx_contratos_status   ON contratos_honorarios (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contratos_versoes  ON contratos_versoes (contrato_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_contratos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_contratos_updated_at
  BEFORE UPDATE ON contratos_honorarios
  FOR EACH ROW EXECUTE FUNCTION update_contratos_updated_at();

-- Row Level Security
ALTER TABLE contratos_honorarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos_versoes    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_contratos"
  ON contratos_honorarios
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tenant_isolation_contratos_versoes"
  ON contratos_versoes
  USING (
    contrato_id IN (
      SELECT id FROM contratos_honorarios WHERE tenant_id = get_user_tenant_id()
    )
  );
