-- ============================================================
-- 046_agenda_calendario.sql — Módulo Agenda / Calendário
-- Tela /agenda (paridade Astrea). Eventos próprios de agenda
-- (evento/prazo/audiência) com CRUD, envolvidos M2M, e comentários
-- de tarefa (aba Comentários do modal). Ver docs/PLANO-AGENDA-OPUS.md §1.
--
-- INVARIANTE DO DONO: prazo NUNCA é calculado automaticamente — toda
-- data de prazo é manual (humano cria agenda_evento tipo 'prazo' com
-- data explícita). Nada aqui deriva prazo de publicação/processo.
-- ============================================================

-- ─── Eventos de agenda (evento / prazo / audiência) ──────────────────────────
CREATE TABLE IF NOT EXISTS agenda_eventos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL
                     CHECK (tipo IN ('evento', 'prazo', 'audiencia')),
  titulo           TEXT NOT NULL,
  descricao        TEXT,
  inicio           TIMESTAMPTZ NOT NULL,
  fim              TIMESTAMPTZ,
  dia_todo         BOOLEAN NOT NULL DEFAULT FALSE,
  local            TEXT,
  -- FKs opcionais: process_id aponta para atendimentos(id) — MESMO alvo de
  -- tasks.process_id (ver 020_tarefas_kanban.sql).
  process_id       UUID REFERENCES atendimentos(id) ON DELETE SET NULL,
  cliente_id       UUID REFERENCES clientes(id) ON DELETE SET NULL,
  responsavel_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  visibilidade     TEXT NOT NULL DEFAULT 'escritorio'
                     CHECK (visibilidade IN ('escritorio', 'particular')),
  status           TEXT NOT NULL DEFAULT 'a_concluir'
                     CHECK (status IN ('a_concluir', 'concluida', 'cancelada')),
  concluido_em     TIMESTAMPTZ,
  cor              TEXT DEFAULT '#3b82f6',
  origin           TEXT NOT NULL DEFAULT 'manual'
                     CHECK (origin IN ('manual', 'bot')),
  origin_reference TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agenda_eventos_tenant_inicio
  ON agenda_eventos (tenant_id, inicio);

-- ─── Envolvidos do evento (many-to-many) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS agenda_evento_envolvidos (
  evento_id UUID NOT NULL REFERENCES agenda_eventos(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (evento_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agenda_evento_envolvidos_user
  ON agenda_evento_envolvidos (user_id);

-- ─── Comentários de tarefa (aba Comentários do modal) ────────────────────────
CREATE TABLE IF NOT EXISTS task_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  autor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  conteudo   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task
  ON task_comments (task_id, created_at);

-- ─── Trigger updated_at (função padrão do repo) ──────────────────────────────
DROP TRIGGER IF EXISTS agenda_eventos_updated_at ON agenda_eventos;
CREATE TRIGGER agenda_eventos_updated_at
  BEFORE UPDATE ON agenda_eventos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Row Level Security (isolamento por tenant via get_user_tenant_id()) ─────
ALTER TABLE agenda_eventos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_evento_envolvidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_agenda_eventos ON agenda_eventos;
CREATE POLICY tenant_isolation_agenda_eventos ON agenda_eventos
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_agenda_evento_envolvidos ON agenda_evento_envolvidos;
CREATE POLICY tenant_isolation_agenda_evento_envolvidos ON agenda_evento_envolvidos
  USING (evento_id IN (
    SELECT id FROM agenda_eventos WHERE tenant_id = get_user_tenant_id()
  ));

DROP POLICY IF EXISTS tenant_isolation_task_comments ON task_comments;
CREATE POLICY tenant_isolation_task_comments ON task_comments
  USING (tenant_id = get_user_tenant_id());

COMMENT ON TABLE agenda_eventos IS 'Eventos próprios da Agenda (evento/prazo/audiência). Prazo sempre manual — nunca derivado.';
COMMENT ON TABLE agenda_evento_envolvidos IS 'Envolvidos (M2M) de um agenda_evento.';
COMMENT ON TABLE task_comments IS 'Comentários de tarefa (aba Comentários do modal de tarefa).';
COMMENT ON COLUMN agenda_eventos.process_id IS 'FK opcional para atendimentos(id) — mesmo alvo de tasks.process_id (020).';
COMMENT ON COLUMN agenda_eventos.visibilidade IS 'escritorio=todos do tenant; particular=só o criador (reforçado na API).';
