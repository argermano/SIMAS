-- ============================================================
-- 071_limpeza_indices.sql
-- Limpeza de índice redundante apontada na auditoria de performance.
-- Apenas DROP idempotente — nenhuma coluna/tabela nova.
-- ============================================================

-- Índice duplicado em clientes(tenant_id, nome): criado duas vezes com colunas e
-- ordem idênticas —
--   • idx_clientes_nome         → 002_clientes.sql:24            (REMANESCENTE)
--   • idx_clientes_tenant_nome  → 030_indices_performance.sql:18 (redundante, mais novo)
-- Mantemos o de 002 e removemos o mais novo. O ORDER BY nome e o filtro por letra
-- (LEFT(nome,1) via prefixo) seguem cobertos por idx_clientes_nome (tenant_id, nome).
DROP INDEX IF EXISTS idx_clientes_tenant_nome;
