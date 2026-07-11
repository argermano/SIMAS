-- ============================================================
-- 051_tasks_dedup_financeiro.sql — dedup ATÔMICO das tarefas
-- automáticas do Financeiro (gancho contrato assinado e êxito).
-- O check-then-insert de criarTarefaAutomatica tem corrida (ex.:
-- webhook D4Sign + clique em marcar-assinado quase juntos criam
-- 2 tarefas "Gerar parcelas..."). O índice único parcial fecha a
-- corrida no banco; o código trata 23505 como "já existia".
--
-- ESCOPO restrito aos prefixos do Financeiro de propósito: outros
-- fluxos (ex.: revisao_peca:<id>) reutilizam origin_reference de
-- forma legítima ao reenviar para revisão — não podem ser únicos.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_origin_reference_financeiro
  ON tasks (tenant_id, origin_reference)
  WHERE origin_reference LIKE 'contrato_financeiro:%'
     OR origin_reference LIKE 'exito:%';
