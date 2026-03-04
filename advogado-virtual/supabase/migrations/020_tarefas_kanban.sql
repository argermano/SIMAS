-- Migration 020: Módulo de Tarefas + Kanban

-- ─── Listas de tarefas ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_lists (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_lists_tenant ON task_lists (tenant_id);

-- ─── Tags ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_tags (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  color     TEXT NOT NULL DEFAULT '#6b7280'
);

CREATE INDEX IF NOT EXISTS idx_task_tags_tenant ON task_tags (tenant_id);

-- ─── Quadros Kanban ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kanban_boards (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kanban_boards_tenant ON kanban_boards (tenant_id);

-- ─── Colunas do Kanban ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kanban_columns (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color    TEXT
);

CREATE INDEX IF NOT EXISTS idx_kanban_columns_board ON kanban_columns (board_id);

-- ─── Tarefas ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  description        TEXT NOT NULL,
  due_date           TIMESTAMPTZ,
  task_list_id       UUID REFERENCES task_lists(id) ON DELETE SET NULL,
  process_id         UUID REFERENCES atendimentos(id) ON DELETE SET NULL,
  assignee_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  priority           TEXT NOT NULL DEFAULT 'media'
                       CHECK (priority IN ('baixa', 'media', 'alta', 'urgente')),
  kanban_board_id    UUID REFERENCES kanban_boards(id) ON DELETE SET NULL,
  kanban_column_id   UUID REFERENCES kanban_columns(id) ON DELETE SET NULL,
  created_by         UUID REFERENCES users(id),
  origin             TEXT NOT NULL DEFAULT 'manual'
                       CHECK (origin IN ('manual', 'automatic')),
  origin_reference   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant         ON tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee        ON tasks (assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_kanban_column   ON tasks (kanban_column_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date        ON tasks (tenant_id, due_date);

-- ─── Responsáveis adicionais (many-to-many) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees (task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees (user_id);

-- ─── Vínculo tarefa ↔ tag ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_tag_links (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  UUID NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

-- ─── Trigger updated_at ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_tasks_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE task_lists     ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_tags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_boards  ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_tag_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_task_lists"
  ON task_lists USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tenant_isolation_task_tags"
  ON task_tags USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tenant_isolation_kanban_boards"
  ON kanban_boards USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tenant_isolation_kanban_columns"
  ON kanban_columns
  USING (board_id IN (
    SELECT id FROM kanban_boards WHERE tenant_id = get_user_tenant_id()
  ));

CREATE POLICY "tenant_isolation_tasks"
  ON tasks USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tenant_isolation_task_assignees"
  ON task_assignees
  USING (task_id IN (
    SELECT id FROM tasks WHERE tenant_id = get_user_tenant_id()
  ));

CREATE POLICY "tenant_isolation_task_tag_links"
  ON task_tag_links
  USING (task_id IN (
    SELECT id FROM tasks WHERE tenant_id = get_user_tenant_id()
  ));

-- ─── Seed: quadro e colunas padrão (via função executada por tenant) ──────────
-- O seed real será feito na primeira vez que o usuário acessar o módulo,
-- através da API que detecta ausência de boards e cria o padrão.
