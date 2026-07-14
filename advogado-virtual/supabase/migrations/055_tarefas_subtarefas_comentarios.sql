-- ============================================================
-- 055_tarefas_subtarefas_comentarios.sql — Fundação p/ Tarefas (Kanban)
--  (1) Subtarefas: coluna tasks.parent_task_id (tarefa-filha COMPLETA).
--  (2) Menções (@) em comentários: tabela task_comment_mentions.
--
-- ATENÇÃO: a tabela task_comments JÁ EXISTE (migração 046, colunas
-- conteudo/autor_id) e já está ligada ao front (AbaComentarios). Aqui NÃO a
-- recriamos nem renomeamos — só acrescentamos as menções que apontam p/ ela.
-- Tudo idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================

-- ─── Subtarefa = tarefa-filha COMPLETA ligada à mãe ──────────────────────────
-- A filha herda o tenant (mesma tabela tasks). Deletar a mãe remove as filhas.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks (parent_task_id);

COMMENT ON COLUMN tasks.parent_task_id IS
  'Tarefa-mãe (subtarefa = tarefa-filha completa: tem responsável/prazo/kanban). NULL = tarefa raiz do board. ON DELETE CASCADE.';

-- ─── Menções (@) de um comentário de tarefa ──────────────────────────────────
-- Aponta para task_comments (migr. 046). PK (comment_id,user_id) evita duplicata.
CREATE TABLE IF NOT EXISTS task_comment_mentions (
  comment_id UUID NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_comment_mentions_user ON task_comment_mentions (user_id);

-- ─── RLS tenant-scoped (padrão 020/046) — visível se o comentário é do tenant ─
ALTER TABLE task_comment_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_task_comment_mentions ON task_comment_mentions;
CREATE POLICY tenant_isolation_task_comment_mentions ON task_comment_mentions
  USING (comment_id IN (
    SELECT id FROM task_comments WHERE tenant_id = get_user_tenant_id()
  ))
  -- WITH CHECK (defesa em profundidade na ESCRITA): além do comentário ser do
  -- tenant, o usuário mencionado tem de ser do MESMO escritório — sem isto a RLS
  -- deixaria mencionar alguém de outro tenant (a checagem só vivia na aplicação).
  WITH CHECK (
    comment_id IN (SELECT id FROM task_comments WHERE tenant_id = get_user_tenant_id())
    AND user_id IN (SELECT id FROM users WHERE tenant_id = get_user_tenant_id())
  );

COMMENT ON TABLE task_comment_mentions IS
  'Menções (@) de um comentário de tarefa (task_comments, migr. 046). RLS via tenant do comentário.';
