-- ============================================================
-- 044_publicacoes.sql — Módulo de Publicações/Intimações (Lote 1)
-- Caixa de entrada auditável de TODAS as publicações capturadas por OAB
-- (DJEN e, futuramente, provedores redundantes) + trilha de execução das
-- rodadas de captura. Fluxo de triagem → tarefa no Kanban. Ver
-- docs/PLANO-PUBLICACOES-OPUS.md §2.
-- ============================================================

-- Caixa de entrada auditável de publicações (TODAS as capturadas por OAB)
CREATE TABLE IF NOT EXISTS publicacoes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fonte               TEXT NOT NULL DEFAULT 'djen' CHECK (fonte IN ('djen','manual')), -- extensível (Judit/Escavador depois)
  chave_fonte         TEXT NOT NULL,            -- id da comunicação no DJEN; p/ 'manual', sha256(texto+numero+data)
  numero_processo     TEXT,                     -- 20 dígitos (pode ser null em edital sem nº)
  numero_mascara      TEXT,
  sigla_tribunal      TEXT,
  orgao_julgador      TEXT,
  tipo_comunicacao    TEXT,
  tipo_documento      TEXT,
  nome_classe         TEXT,
  texto               TEXT,                     -- HTML integral (inteiro teor)
  data_disponibilizacao DATE NOT NULL,
  data_publicacao_sugerida DATE,                -- próximo dia ÚTIL (só fds; SEM feriados — é sugestão, nunca prazo)
  destinatarios       JSONB NOT NULL DEFAULT '[]',
  oab_consultada      TEXT NOT NULL,
  uf_oab              TEXT NOT NULL,
  meta                JSONB,                    -- item bruto da API
  status              TEXT NOT NULL DEFAULT 'nova' CHECK (status IN ('nova','triada','tarefa_criada','descartada')),
  descarte_motivo     TEXT,
  triada_por          UUID REFERENCES users(id),
  triada_em           TIMESTAMPTZ,
  task_id             UUID REFERENCES tasks(id) ON DELETE SET NULL,
  processo_id         UUID REFERENCES processos(id) ON DELETE SET NULL,          -- match Fase 5 (se cadastrado)
  movimento_id        UUID REFERENCES processo_movimentos(id) ON DELETE SET NULL, -- aviso ao cliente já gerado
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_publicacao_fonte ON publicacoes (tenant_id, fonte, chave_fonte);
CREATE INDEX IF NOT EXISTS idx_publicacoes_tenant_data ON publicacoes (tenant_id, data_disponibilizacao DESC);
CREATE INDEX IF NOT EXISTS idx_publicacoes_tenant_status ON publicacoes (tenant_id, status);

-- Auditoria de execução (1 linha por tenant+OAB por rodada; SEMPRE grava, mesmo com zero)
CREATE TABLE IF NOT EXISTS capturas_publicacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  oab           TEXT NOT NULL,
  uf            TEXT NOT NULL,
  janela_inicio DATE NOT NULL,
  janela_fim    DATE NOT NULL,
  iniciada_em   TIMESTAMPTZ NOT NULL,
  finalizada_em TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN ('sucesso','falha','parcial')),
  qtd_encontradas INTEGER NOT NULL DEFAULT 0,
  qtd_novas       INTEGER NOT NULL DEFAULT 0,
  qtd_duplicadas  INTEGER NOT NULL DEFAULT 0,
  erro          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capturas_tenant_data ON capturas_publicacoes (tenant_id, created_at DESC);

-- Trigger updated_at (função padrão do repo já existe — ver 043)
DROP TRIGGER IF EXISTS publicacoes_updated_at ON publicacoes;
CREATE TRIGGER publicacoes_updated_at
  BEFORE UPDATE ON publicacoes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS padrão do repo (isolamento por tenant via get_user_tenant_id())
ALTER TABLE publicacoes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE capturas_publicacoes ENABLE ROW LEVEL SECURITY;

-- publicacoes: leitura e triagem (UPDATE) pelo próprio tenant; inserção em massa
-- é feita server-side pelo pipeline (service_role bypassa RLS).
DROP POLICY IF EXISTS tenant_isolation_publicacoes ON publicacoes;
CREATE POLICY tenant_isolation_publicacoes ON publicacoes
  USING (tenant_id = get_user_tenant_id());

-- capturas_publicacoes: só leitura pelo tenant. A escrita é feita server-side
-- pelo pipeline de captura (service_role bypassa RLS); sem policy de INSERT
-- para clients, evitando forja de trilha de auditoria pelo usuário.
DROP POLICY IF EXISTS capturas_publicacoes_tenant_select ON capturas_publicacoes;
CREATE POLICY capturas_publicacoes_tenant_select ON capturas_publicacoes
  FOR SELECT USING (tenant_id = get_user_tenant_id());

COMMENT ON TABLE publicacoes IS 'Caixa de entrada auditável de publicações/intimações capturadas por OAB (Lote 1). Triagem → tarefa no Kanban.';
COMMENT ON COLUMN publicacoes.chave_fonte IS 'Chave de dedup na fonte: id da comunicação no DJEN; para fonte manual, sha256(texto+numero+data).';
COMMENT ON COLUMN publicacoes.data_publicacao_sugerida IS 'Próximo dia útil após a disponibilização (só pula fim de semana, SEM feriados). É sugestão de referência, NUNCA prazo.';
COMMENT ON TABLE capturas_publicacoes IS 'Trilha de execução das rodadas de captura (1 linha por tenant+OAB por rodada, inclusive zero resultados). Escrita só via service-role.';
