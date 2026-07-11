-- ============================================================
-- 050_financeiro_parcelas.sql — Módulo Financeiro (Lote 1)
-- Parcelas de honorários (avulsas ou em série), baixa manual
-- (invariante: NUNCA automática — a IA apenas sugere), avisos
-- WhatsApp D-3/D-0 com claim atômico e opt-out por cliente.
-- Campo cobranca_externa_id reservado para boleto Inter (Lote 2).
-- Pix do escritório fica em tenants.config.financeiro (JSON, sem DDL).
-- ============================================================

CREATE TABLE IF NOT EXISTS parcelas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id           UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  contrato_id          UUID REFERENCES contratos_honorarios(id) ON DELETE SET NULL,
  processo_id          UUID REFERENCES processos(id) ON DELETE SET NULL,
  descricao            TEXT NOT NULL,                 -- ex.: "Honorários — parcela 2/10"
  valor_centavos       INTEGER NOT NULL CHECK (valor_centavos > 0),
  vencimento           DATE NOT NULL,
  status               TEXT NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta','paga','cancelada')),
  -- Dados da baixa (sempre por clique humano; comprovante opcional)
  pago_em              TIMESTAMPTZ,
  pago_valor_centavos  INTEGER,
  meio                 TEXT CHECK (meio IN ('pix','boleto','transferencia','dinheiro','outro')),
  comprovante_url      TEXT,
  comprovante_dados    JSONB,                         -- DadosComprovante extraídos por IA
  baixa_por            UUID REFERENCES users(id),
  baixa_obs            TEXT,
  -- Reserva p/ integração de cobrança externa (boleto Inter — Lote 2)
  cobranca_externa_id  TEXT,
  -- Claims dos avisos WhatsApp (padrão Fase 5: update ... where is null RETURNING)
  aviso_d3_em          TIMESTAMPTZ,                   -- aviso 3 dias antes do vencimento
  aviso_d0_em          TIMESTAMPTZ,                   -- aviso no dia do vencimento
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcelas_tenant_status_venc ON parcelas (tenant_id, status, vencimento);
CREATE INDEX IF NOT EXISTS idx_parcelas_tenant_cliente     ON parcelas (tenant_id, cliente_id);

-- Opt-out de aviso de cobrança por cliente (default ligado)
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS aviso_cobranca BOOLEAN NOT NULL DEFAULT true;

-- Trigger updated_at (função padrão do repo já existe)
DROP TRIGGER IF EXISTS parcelas_updated_at ON parcelas;
CREATE TRIGGER parcelas_updated_at
  BEFORE UPDATE ON parcelas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS padrão do repo (isolamento por tenant via get_user_tenant_id())
ALTER TABLE parcelas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_parcelas ON parcelas;
CREATE POLICY tenant_isolation_parcelas ON parcelas
  USING (tenant_id = get_user_tenant_id());

COMMENT ON TABLE parcelas IS 'Parcelas de honorários (Financeiro L1). Baixa SEMPRE manual; IA só sugere. Valores em centavos.';
COMMENT ON COLUMN parcelas.cobranca_externa_id IS 'Reserva para id de cobrança em provedor externo (boleto Inter — Lote 2).';
COMMENT ON COLUMN parcelas.aviso_d3_em IS 'Claim atômico do aviso D-3 (3 dias antes). Preenchido ANTES do envio.';
COMMENT ON COLUMN parcelas.aviso_d0_em IS 'Claim atômico do aviso D-0 (dia do vencimento). Preenchido ANTES do envio.';
COMMENT ON COLUMN clientes.aviso_cobranca IS 'Opt-out de avisos de cobrança WhatsApp (default true = recebe avisos).';
