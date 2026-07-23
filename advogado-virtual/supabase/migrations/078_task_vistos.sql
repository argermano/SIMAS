-- ============================================================
-- 078_task_vistos.sql — "Visto" de comentários por usuário (sino de alertas)
--
-- Marca d'água por (tarefa, usuário): quando EU abri o detalhe da tarefa pela
-- última vez. O sino de comentários (GET /api/tasks/comentarios-novos) usa isto
-- p/ mostrar só os comentários criados por OUTRO usuário DEPOIS do meu visto.
-- Sem linha = nunca abri → todos os comentários de outros contam como novos.
--
-- Padrão das tabelas de task: PK composta, FKs em CASCADE, RLS tenant-scoped via
-- get_user_tenant_id() (mesma forma de task_comments/046 e task_comment_mentions/055).
-- Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS). NÃO aplicar no banco aqui.
-- ============================================================

CREATE TABLE IF NOT EXISTS task_vistos (
  tenant_id UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id   UUID        NOT NULL REFERENCES tasks(id)   ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  visto_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);

-- Consulta do sino parte do usuário ("minhas tarefas vistas").
CREATE INDEX IF NOT EXISTS idx_task_vistos_user ON task_vistos (user_id);

-- ─── RLS tenant-scoped (padrão 020/046) ──────────────────────────────────────
ALTER TABLE task_vistos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_task_vistos ON task_vistos;
CREATE POLICY tenant_isolation_task_vistos ON task_vistos
  USING (tenant_id = get_user_tenant_id())
  -- WITH CHECK: na escrita, o visto só pode ser gravado no próprio tenant
  -- (o upsert da API já fixa tenant_id/user_id do usuário autenticado).
  WITH CHECK (tenant_id = get_user_tenant_id());

COMMENT ON TABLE task_vistos IS
  'Marca d''agua por (tarefa,usuario): ultima vez que o usuario abriu o detalhe da tarefa. Alimenta o sino de comentarios novos. RLS via tenant.';
