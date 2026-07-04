-- ============================================================
-- 039_teses_escritorio.sql — Base de teses curadas por ESCRITÓRIO (Fase 3).
-- Sai dos arquivos do repo (que passam a ser só template) para o banco, por
-- tenant: permite fluxo de aprovação in-app e base personalizada por escritório
-- (produtização). Teses 'aprovada' fundamentam a geração de peças da área,
-- CITÁVEIS sem [VERIFICAR]. Nada entra sem aprovação humana.
-- ============================================================

CREATE TABLE IF NOT EXISTS teses_escritorio (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  area           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'sugerida'
                   CHECK (status IN ('sugerida', 'aprovada', 'rejeitada')),

  tese           TEXT NOT NULL,               -- enunciado genérico e reutilizável
  dispositivos   JSONB NOT NULL DEFAULT '[]', -- ["Lei 8.213/91, art. 57", ...]
  sumulas        JSONB NOT NULL DEFAULT '[]', -- ["Súmula 198 do TFR", ...]
  ementas        JSONB NOT NULL DEFAULT '[]', -- [{tribunal,processo,relator,julgamento,ementa,fonteUrl?,confirmadaSemFonte?}]
  quando_usar    TEXT,
  notas          TEXT,

  verificacao    JSONB,                       -- resultado do verificador de citações (por citação)
  origem_arquivo TEXT,                        -- nome do arquivo de onde foi minerada
  trecho_origem  TEXT,                        -- trecho da peça que fundamenta a tese

  criada_por     UUID REFERENCES users(id) ON DELETE SET NULL,
  sugerida_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  aprovada_por   UUID REFERENCES users(id) ON DELETE SET NULL,
  aprovada_em    TIMESTAMPTZ,
  rejeitada_por  UUID REFERENCES users(id) ON DELETE SET NULL,
  rejeitada_em   TIMESTAMPTZ,
  motivo_rejeicao TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teses_tenant_area_status
  ON teses_escritorio (tenant_id, area, status);

ALTER TABLE teses_escritorio ENABLE ROW LEVEL SECURITY;

-- Isolamento por tenant (USING também vale como WITH CHECK no INSERT).
DROP POLICY IF EXISTS tenant_isolation_teses ON teses_escritorio;
CREATE POLICY tenant_isolation_teses
  ON teses_escritorio USING (tenant_id = get_user_tenant_id());

COMMENT ON TABLE teses_escritorio IS 'Teses de fundamentação por escritório (Fase 3). status=aprovada é injetado na geração de peças da área.';
