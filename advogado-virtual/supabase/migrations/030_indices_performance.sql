-- ============================================================
-- 030_indices_performance.sql
-- Índices adicionais alinhados aos padrões de query mais frequentes.
-- Aditivo e idempotente (IF NOT EXISTS). As tabelas já possuem índices
-- por tenant_id e FKs; aqui cobrimos lacunas de filtros compostos.
-- ============================================================

-- /api/tasks/due-today e "minhas tarefas abertas": filtram tenant + assignee + completed_at(null) + due_date
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_completed
  ON tasks (tenant_id, assignee_id, completed_at);

-- Tarefas abertas por prazo (índice parcial — só linhas não concluídas)
CREATE INDEX IF NOT EXISTS idx_tasks_abertas_due
  ON tasks (tenant_id, due_date)
  WHERE completed_at IS NULL;

-- Listagem de clientes: ORDER BY nome + índice alfabético (LEFT(nome,1)) por tenant
CREATE INDEX IF NOT EXISTS idx_clientes_tenant_nome
  ON clientes (tenant_id, nome);
