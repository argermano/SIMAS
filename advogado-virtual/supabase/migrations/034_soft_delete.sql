-- 034_soft_delete.sql
-- Soft-delete para clientes e atendimentos.
--
-- Motivação (A2): o DELETE de cliente/caso era hard-delete em cascata, sem
-- checagem de papel e sem trilha de auditoria — irreversível e não rastreável.
-- Passamos a marcar deleted_at; as rotas de listagem/detalhe filtram
-- deleted_at IS NULL, e o registro permanece no banco (reversível, auditável).
-- Hard-delete definitivo fica como operação administrativa futura (service_role).

ALTER TABLE clientes     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Índices parciais: aceleram as listagens, que quase sempre filtram os ativos.
CREATE INDEX IF NOT EXISTS idx_clientes_ativos
  ON clientes (tenant_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_atendimentos_ativos
  ON atendimentos (tenant_id, cliente_id) WHERE deleted_at IS NULL;
