-- ============================================================
-- 056_primeiro_atendimento.sql — Fundação do PRIMEIRO ATENDIMENTO
--
-- Decisão do dono: atendimento e caso são o MESMO registro em ESTÁGIOS.
-- Aqui só EVOLUÍMOS a entidade `atendimentos` (nada de tabela nova de "caso"):
--   • titulo/etiquetas  → organização leve do card;
--   • estagio           → 'atendimento' (nascimento leve, pré-peça) | 'caso';
--   • encerrado_em       → marca do encerramento (status vira 'finalizado').
-- + `atendimento_registros`: diário APPEND-ONLY da conversa inicial (v1 sem
--   editar/excluir — simplicidade pedida). Padrão do repo: task_comments (046).
--
-- BACKFILL: estagio DEFAULT 'caso' já classifica corretamente TODAS as linhas
-- existentes (inclusive os 174 casos importados do Astrea). Só o nascimento
-- leve grava estagio='atendimento'. Tudo idempotente (IF NOT EXISTS) + COMMENTs.
-- ============================================================

-- ─── Colunas novas em atendimentos ───────────────────────────────────────────
ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS titulo       TEXT,
  ADD COLUMN IF NOT EXISTS etiquetas    TEXT[],
  ADD COLUMN IF NOT EXISTS estagio      TEXT NOT NULL DEFAULT 'caso'
    CHECK (estagio IN ('atendimento', 'caso')),
  ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMPTZ;

COMMENT ON COLUMN atendimentos.titulo       IS 'Título curto do atendimento/caso (opcional). Máx. 200 no app.';
COMMENT ON COLUMN atendimentos.etiquetas    IS 'Etiquetas livres do card (máx. 8 itens de até 30 chars no app).';
COMMENT ON COLUMN atendimentos.estagio      IS 'Estágio do MESMO registro: atendimento (nascimento leve, pré-peça) | caso. Transição atendimento→caso é one-way no v1. Default caso faz o backfill do legado (inclui Astrea).';
COMMENT ON COLUMN atendimentos.encerrado_em IS 'Quando o atendimento/caso foi encerrado (status=finalizado). NULL = aberto. Reabrir zera esta coluna.';

-- ─── Diário do atendimento (APPEND-ONLY no v1) ───────────────────────────────
CREATE TABLE IF NOT EXISTS atendimento_registros (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  atendimento_id UUID NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  texto          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atendimento_registros_atendimento
  ON atendimento_registros (atendimento_id, created_at);

-- ─── RLS tenant-scoped (padrão 046: USING também cobre o INSERT via WITH CHECK
--     implícito = mesma expressão) ──────────────────────────────────────────
ALTER TABLE atendimento_registros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_atendimento_registros ON atendimento_registros;
CREATE POLICY tenant_isolation_atendimento_registros ON atendimento_registros
  USING (tenant_id = get_user_tenant_id());

COMMENT ON TABLE atendimento_registros IS
  'Diário APPEND-ONLY do atendimento (conversa inicial e anotações). v1 sem editar/excluir. RLS por tenant (get_user_tenant_id).';
