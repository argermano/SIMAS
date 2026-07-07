-- ============================================================
-- 043_processos.sql — Fase 5: acompanhamento processual
-- Processos vinculados a clientes (N por cliente, mesmo sem caso no SIMAS),
-- movimentações armazenadas (íntegra DataJud + resumo IA), e config de aviso
-- por cliente. Ver docs/PLANO-FASE-5-OPUS.md.
-- ============================================================

-- Processos vinculados a clientes
CREATE TABLE IF NOT EXISTS processos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  numero_cnj      TEXT NOT NULL,              -- só dígitos, validado (DV CNJ)
  tribunal_alias  TEXT NOT NULL,              -- ex.: tjpr (aliasDataJud)
  classe          TEXT,
  orgao_julgador  TEXT,
  assuntos        JSONB NOT NULL DEFAULT '[]',
  grau            TEXT,
  data_ajuizamento TIMESTAMPTZ,
  situacao        TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','encerrado')),
  dados_capa      JSONB,                      -- snapshot bruto da capa DataJud
  ultima_sincronizacao   TIMESTAMPTZ,
  datajud_atualizado_em  TIMESTAMPTZ,         -- dataHoraUltimaAtualizacao do DataJud
  apelido         TEXT,                       -- rótulo amigável opcional
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_processo_tenant_numero ON processos (tenant_id, numero_cnj);
CREATE INDEX IF NOT EXISTS idx_processos_cliente ON processos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_processos_tenant_situacao ON processos (tenant_id, situacao);

-- 1 linha por movimentação (íntegra + resumo IA + estado de notificação)
CREATE TABLE IF NOT EXISTS processo_movimentos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id  UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  codigo       INTEGER,                       -- código TPU/CNJ
  nome         TEXT NOT NULL,
  data_hora    TIMESTAMPTZ,
  complementos JSONB NOT NULL DEFAULT '[]',
  raw          JSONB NOT NULL,                -- íntegra do registro DataJud
  raw_hash     TEXT NOT NULL,                 -- hash do raw p/ dedup no sync
  resumo_ia    TEXT,                          -- linguagem natural (gerado 1x)
  categoria    TEXT,                          -- categoria curada (ver categorias.ts) ou null
  notif_status TEXT NOT NULL DEFAULT 'nao_aplicavel'
    CHECK (notif_status IN ('nao_aplicavel','pendente','aprovada','enviada','descartada','erro')),
  notif_texto  TEXT,                          -- mensagem final enviada/a enviar (editável na fila)
  notif_enviada_em   TIMESTAMPTZ,
  notif_aprovada_por UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_movimento_processo_hash ON processo_movimentos (processo_id, raw_hash);
CREATE INDEX IF NOT EXISTS idx_movimentos_processo ON processo_movimentos (processo_id, data_hora);
CREATE INDEX IF NOT EXISTS idx_movimentos_notif ON processo_movimentos (notif_status) WHERE notif_status IN ('pendente','aprovada');

-- Config por CLIENTE: modo de aviso de movimentação
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS aviso_movimentacao TEXT NOT NULL DEFAULT 'desligado'
    CHECK (aviso_movimentacao IN ('desligado','fila','automatico'));

-- Trigger updated_at (função padrão do repo já existe)
DROP TRIGGER IF EXISTS processos_updated_at ON processos;
CREATE TRIGGER processos_updated_at
  BEFORE UPDATE ON processos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS padrão do repo (isolamento por tenant via get_user_tenant_id())
ALTER TABLE processos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE processo_movimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_processos ON processos;
CREATE POLICY tenant_isolation_processos ON processos
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_processo_movimentos ON processo_movimentos;
CREATE POLICY tenant_isolation_processo_movimentos ON processo_movimentos
  USING (processo_id IN (SELECT id FROM processos WHERE tenant_id = get_user_tenant_id()));

COMMENT ON TABLE processos IS 'Processos judiciais vinculados a clientes (Fase 5). Movimentações em processo_movimentos.';
COMMENT ON COLUMN processo_movimentos.raw IS 'Íntegra do registro de movimento do DataJud.';
COMMENT ON COLUMN processo_movimentos.resumo_ia IS 'Resumo em linguagem natural gerado 1x no sync (não regenerar por consulta).';
