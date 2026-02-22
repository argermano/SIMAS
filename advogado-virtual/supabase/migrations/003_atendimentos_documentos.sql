-- ============================================================
-- 003_atendimentos_documentos.sql
-- Atendimentos e documentos anexados
-- ============================================================

CREATE TABLE atendimentos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id          UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id),
  area                TEXT NOT NULL DEFAULT 'previdenciario',
  -- Transcrição / áudio
  audio_url           TEXT,
  transcricao_raw     TEXT,
  transcricao_editada TEXT,
  -- Pedidos do advogado
  pedidos_especificos TEXT,
  -- Metadados extraídos pela IA
  metadados_extraidos JSONB NOT NULL DEFAULT '{}',
  -- Status do fluxo
  status              TEXT NOT NULL DEFAULT 'rascunho', -- rascunho | analisado | finalizado
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE atendimentos IS 'Registro de cada atendimento realizado pelo escritório';

CREATE INDEX idx_atendimentos_tenant   ON atendimentos(tenant_id);
CREATE INDEX idx_atendimentos_cliente  ON atendimentos(cliente_id);
CREATE INDEX idx_atendimentos_user     ON atendimentos(user_id);
CREATE INDEX idx_atendimentos_status   ON atendimentos(tenant_id, status);

CREATE TRIGGER atendimentos_updated_at
  BEFORE UPDATE ON atendimentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────

CREATE TABLE documentos (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id         UUID NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Identificação do arquivo
  tipo                   TEXT NOT NULL DEFAULT 'outro',
                         -- cnis | indeferimento | cessacao | laudo | procuracao | carta_concessao | outro
  file_url               TEXT NOT NULL,
  file_name              TEXT NOT NULL,
  mime_type              TEXT,
  tamanho_bytes          BIGINT,
  -- Extração de conteúdo
  texto_extraido         TEXT,
  dados_extraidos        JSONB NOT NULL DEFAULT '{}',
  -- Confirmação pelo advogado
  confirmado_por_usuario BOOLEAN NOT NULL DEFAULT false,
  confirmado_por         UUID REFERENCES users(id),
  confirmado_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE documentos IS 'Documentos anexados a cada atendimento';

CREATE INDEX idx_documentos_atendimento ON documentos(atendimento_id);
CREATE INDEX idx_documentos_tenant      ON documentos(tenant_id);
