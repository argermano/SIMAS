-- 064 — contratos_honorarios.deleted_at
--
-- O dossiê do cliente (e agora a árvore de documentos) filtra contratos por
-- deleted_at IS NULL, mas a coluna NUNCA existiu nesta tabela — o PostgREST
-- devolvia erro e as queries falhavam em silêncio (zero contratos listados).
-- Adiciona a coluna (nullable): linhas existentes passam no filtro, o DELETE
-- hard atual segue funcionando e soft-delete futuro fica possível (padrão de
-- clientes/atendimentos, migration 034).

ALTER TABLE contratos_honorarios
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN contratos_honorarios.deleted_at IS
  'Soft-delete (ainda não usado pela API — DELETE é hard). Filtros do dossiê exigem a coluna.';
