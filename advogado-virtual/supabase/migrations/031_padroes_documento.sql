-- ============================================================
-- 031_padroes_documento.sql
-- Estilo de formatação de documentos POR ESCRITÓRIO (tenant).
-- Fonte única de verdade do estilo: alimenta o export DOCX/PDF, o CSS do
-- editor e o preview. Sem registro, o app usa o DEFAULT_ABNT.
-- ============================================================

CREATE TABLE IF NOT EXISTS padroes_documento (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  fonte                   TEXT    NOT NULL DEFAULT 'Times New Roman',
  tamanho_pt              NUMERIC NOT NULL DEFAULT 12,
  tamanho_ementa_pt       NUMERIC NOT NULL DEFAULT 10,
  entrelinha              NUMERIC NOT NULL DEFAULT 1.5,
  recuo_primeira_linha_cm NUMERIC NOT NULL DEFAULT 1.25,
  recuo_blockquote_cm     NUMERIC NOT NULL DEFAULT 4,
  margem_topo_cm          NUMERIC NOT NULL DEFAULT 3,
  margem_baixo_cm         NUMERIC NOT NULL DEFAULT 2,
  margem_esquerda_cm      NUMERIC NOT NULL DEFAULT 3,
  margem_direita_cm       NUMERIC NOT NULL DEFAULT 2,
  cabecalho               TEXT,   -- texto opcional do cabeçalho (ex.: nome do escritório)
  rodape                  TEXT,   -- texto opcional do rodapé
  numerar_paginas         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_padroes_documento_tenant ON padroes_documento (tenant_id);

-- updated_at automático (reutiliza a função existente do projeto)
DROP TRIGGER IF EXISTS trg_padroes_documento_updated_at ON padroes_documento;
CREATE TRIGGER trg_padroes_documento_updated_at
  BEFORE UPDATE ON padroes_documento
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE padroes_documento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS padroes_documento_tenant ON padroes_documento;
CREATE POLICY padroes_documento_tenant ON padroes_documento
  FOR ALL USING (tenant_id = get_user_tenant_id());
