-- ============================================================
-- 004_analises_pecas.sql
-- Análises jurídicas e peças processuais geradas
-- ============================================================

CREATE TABLE analises (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id       UUID NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Conteúdo da análise
  resumo_fatos         TEXT,
  tese_principal       TEXT,
  plano_a              JSONB,  -- { titulo, descricao, fundamento, probabilidade, pre_requisitos }
  plano_b              JSONB,
  riscos               JSONB,  -- [{ tipo, descricao, severidade }]
  checklist_documentos JSONB,  -- [{ documento, status, observacao }]
  perguntas_faltantes  JSONB,  -- [{ pergunta, motivo }]
  acoes_sugeridas      JSONB,  -- [{ tipo_peca, label, descricao }]
  -- Rastreabilidade / IA
  fontes_utilizadas    JSONB NOT NULL DEFAULT '{}',
  prompt_utilizado     TEXT,
  modelo_ia            TEXT,
  tokens_utilizados    JSONB,  -- { input, output, custo_estimado }
  -- Status
  status               TEXT NOT NULL DEFAULT 'gerada', -- gerada | revisada | aprovada
  revisada_por         UUID REFERENCES users(id),
  revisada_at          TIMESTAMPTZ,
  created_by           UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE analises IS 'Consultorias jurídicas geradas por IA para cada atendimento';

CREATE INDEX idx_analises_atendimento ON analises(atendimento_id);
CREATE INDEX idx_analises_tenant      ON analises(tenant_id);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE pecas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analise_id           UUID REFERENCES analises(id),
  atendimento_id       UUID NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Tipo da peça
  tipo                 TEXT NOT NULL,
                       -- peticao_inicial | contestacao | replica | apelacao | agravo | embargos | tutela | cumprimento
  area                 TEXT NOT NULL DEFAULT 'previdenciario',
  -- Conteúdo
  conteudo_markdown    TEXT,
  conteudo_html        TEXT,
  -- Validação
  validacao_coerencia  JSONB,  -- { aprovado, problemas: [] }
  validacao_fontes     JSONB,  -- { citacoes_verificadas, citacoes_nao_verificadas }
  -- Versionamento
  versao               INT NOT NULL DEFAULT 1,
  status               TEXT NOT NULL DEFAULT 'rascunho', -- rascunho | revisada | aprovada | exportada
  -- Rastreabilidade
  prompt_utilizado     TEXT,
  modelo_ia            TEXT,
  tokens_utilizados    JSONB,
  created_by           UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pecas IS 'Peças processuais geradas por IA';

CREATE INDEX idx_pecas_atendimento ON pecas(atendimento_id);
CREATE INDEX idx_pecas_analise     ON pecas(analise_id);
CREATE INDEX idx_pecas_tenant      ON pecas(tenant_id);

CREATE TRIGGER pecas_updated_at
  BEFORE UPDATE ON pecas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────

CREATE TABLE pecas_versoes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id           UUID NOT NULL REFERENCES pecas(id) ON DELETE CASCADE,
  versao            INT NOT NULL,
  conteudo_markdown TEXT,
  alterado_por      UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pecas_versoes_peca ON pecas_versoes(peca_id);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE exportacoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id          UUID NOT NULL REFERENCES pecas(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  formato          TEXT NOT NULL DEFAULT 'docx',  -- docx | pdf | txt
  file_url         TEXT NOT NULL,
  versao_snapshot  INT,
  exported_by      UUID NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exportacoes_peca   ON exportacoes(peca_id);
CREATE INDEX idx_exportacoes_tenant ON exportacoes(tenant_id);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE api_usage_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  user_id          UUID NOT NULL REFERENCES users(id),
  endpoint         TEXT NOT NULL,  -- analise | geracao_peca | transcricao
  modelo           TEXT,
  tokens_input     INT,
  tokens_output    INT,
  custo_estimado   DECIMAL(10,6),
  latencia_ms      INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_usage_tenant ON api_usage_log(tenant_id, created_at);
CREATE INDEX idx_api_usage_user   ON api_usage_log(user_id, created_at);
