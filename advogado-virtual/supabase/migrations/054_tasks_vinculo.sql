-- ============================================================
-- 054_tasks_vinculo.sql — vínculo único da tarefa (Kanban)
-- Uma tarefa pode referenciar UM (e apenas um) entre: cliente, caso
-- (atendimento) ou processo (Fase 5). Modelo B (colunas FK), escolhido porque
-- tasks.process_id JÁ é escrito/lido por automações (financeiro
-- gancho-contrato/êxito, taskService, agenda) e pelo card (atendimentos.area) —
-- reaproveitá-lo como o vínculo "atendimento" mantém tudo isso intacto.
--
--   process_id  → atendimentos(id)  = CASO/ATENDIMENTO  (já existia, 020)
--   cliente_id  → clientes(id)      = CLIENTE           (novo)
--   processo_id → processos(id)     = PROCESSO (Fase 5) (novo)
--
-- CHECK garante o "single reference" (no máx. 1 não-nulo). Linhas antigas só
-- têm process_id (ou nada) → a constraint já nasce válida. ON DELETE SET NULL
-- em todas: apagar a entidade zera a coluna (o vínculo "some", sem órfão duro).
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS cliente_id  UUID REFERENCES clientes(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processo_id UUID REFERENCES processos(id) ON DELETE SET NULL;

-- No máximo UM vínculo por tarefa (process_id / cliente_id / processo_id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_vinculo_unico'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT chk_tasks_vinculo_unico CHECK (
      (CASE WHEN process_id  IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN cliente_id  IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN processo_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
    );
  END IF;
END $$;

-- Índices parciais úteis (equivalem ao "tenant + tipo + id" do modelo polimórfico).
CREATE INDEX IF NOT EXISTS idx_tasks_cliente
  ON tasks (tenant_id, cliente_id)  WHERE cliente_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_processo
  ON tasks (tenant_id, processo_id) WHERE processo_id IS NOT NULL;

COMMENT ON COLUMN tasks.cliente_id  IS 'Vínculo único da tarefa quando aponta para um CLIENTE (ver 054). Exclusivo com process_id/processo_id via chk_tasks_vinculo_unico.';
COMMENT ON COLUMN tasks.processo_id IS 'Vínculo único da tarefa quando aponta para um PROCESSO/Fase 5 (ver 054). Exclusivo com process_id/cliente_id.';
COMMENT ON COLUMN tasks.process_id  IS 'Vínculo único da tarefa quando aponta para um CASO/ATENDIMENTO (atendimentos.id). Também usado por automações do financeiro/agenda. Exclusivo com cliente_id/processo_id (054).';
