-- ============================================================
-- 047_sentinela_publicacoes.sql — Sentinela DataJud × DJEN
-- Alertas internos de triagem: movimento do DataJud que IMPLICA publicação
-- no diário (ex.: "Publicado o acórdão") sem publicação correspondente
-- capturada do DJEN (tabela publicacoes) após a carência. É aviso interno
-- para o advogado conferir o PJe — NUNCA notifica cliente e NUNCA calcula
-- prazo. 1 alerta por movimento (unique movimento_id). Ver spec da sentinela.
-- ============================================================

CREATE TABLE IF NOT EXISTS sentinela_publicacoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  processo_id     UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  movimento_id    UUID NOT NULL UNIQUE REFERENCES processo_movimentos(id) ON DELETE CASCADE,
  numero_processo TEXT NOT NULL,              -- só dígitos (processos.numero_cnj)
  movimento_nome  TEXT NOT NULL,
  movimento_data  TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta','resolvida_auto','verificada','ignorada')),
  resolvida_em    TIMESTAMPTZ,
  resolvida_por   UUID REFERENCES users(id) ON DELETE SET NULL, -- null em resolvida_auto
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sentinela_tenant_status  ON sentinela_publicacoes (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sentinela_tenant_created ON sentinela_publicacoes (tenant_id, created_at DESC);

-- Trigger updated_at (função padrão do repo já existe — ver 043)
DROP TRIGGER IF EXISTS sentinela_publicacoes_updated_at ON sentinela_publicacoes;
CREATE TRIGGER sentinela_publicacoes_updated_at
  BEFORE UPDATE ON sentinela_publicacoes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS padrão do repo (isolamento por tenant via get_user_tenant_id()).
-- Escrita em massa (abertura/auto-resolução) é feita server-side pelo cron
-- (service_role bypassa RLS); a ação humana (verificada/ignorada) passa pela
-- rota autenticada, também server-side.
ALTER TABLE sentinela_publicacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_sentinela_publicacoes ON sentinela_publicacoes;
CREATE POLICY tenant_isolation_sentinela_publicacoes ON sentinela_publicacoes
  USING (tenant_id = get_user_tenant_id());

COMMENT ON TABLE sentinela_publicacoes IS 'Sentinela DataJud × DJEN: movimento que implica publicação no diário sem publicação correspondente capturada. Aviso interno de triagem — nunca notifica cliente, nunca calcula prazo.';
COMMENT ON COLUMN sentinela_publicacoes.movimento_id IS 'Movimento (processo_movimentos) que originou o alerta. UNIQUE = 1 alerta por movimento (dedup entre rodadas).';
COMMENT ON COLUMN sentinela_publicacoes.status IS 'aberta → resolvida_auto (publicação apareceu) | verificada (advogado conferiu no PJe) | ignorada.';
