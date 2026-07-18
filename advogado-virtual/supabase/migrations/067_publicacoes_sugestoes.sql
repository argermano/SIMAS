-- ============================================================
-- 067_publicacoes_sugestoes.sql — cache das sugestões de IA por publicação
-- No tratamento das publicações a IA aponta TRECHOS importantes do inteiro teor
-- e sugere TAREFAS (título + prioridade). A geração é sob demanda (botão) e cara,
-- então guardamos UMA geração por publicação para reuso (evita re-chamar o modelo).
-- Ver src/lib/publicacoes/sugestoes-prompt.ts (schema + validação server-side) e
-- a rota POST /api/publicacoes/[id]/sugerir.
--
-- INVARIANTE DURA DO DONO (não negociável): PRAZO JURÍDICO NUNCA É CALCULADO
-- AUTOMATICAMENTE. A IA pode APONTAR o trecho que menciona prazo (sugestoes_ia.
-- tarefas[].trechoDoPrazo é uma CITAÇÃO literal do texto) e sugerir uma tarefa
-- SOBRE ele, mas NUNCA uma DATA. Nenhuma data de prazo entra neste cache — a data
-- é sempre digitada pelo humano na confirmação do tratamento.
-- Idempotente.
-- ============================================================

ALTER TABLE publicacoes
  -- Cache: { trechos: [{texto, motivo}], tarefas: [{titulo, prioridade,
  -- temPrazoNoTexto, trechoDoPrazo?}], resumo }. UMA geração por publicação;
  -- regeração é explícita (1 re-chamada forçada). NUNCA guarda data de prazo.
  ADD COLUMN IF NOT EXISTS sugestoes_ia          JSONB,
  -- Quando o cache foi gerado (base do rótulo "Sugerido …"); NULL = ainda não gerado.
  ADD COLUMN IF NOT EXISTS sugestoes_geradas_em  TIMESTAMPTZ;

COMMENT ON COLUMN publicacoes.sugestoes_ia IS
  'Cache das sugestões de IA (1 geração por publicação): trechos importantes + tarefas sugeridas + resumo. NUNCA contém data de prazo — a data é sempre definida pelo humano.';
COMMENT ON COLUMN publicacoes.sugestoes_geradas_em IS
  'Timestamp da geração das sugestões de IA (NULL = não gerado). Geração sob demanda, nunca em lote/cron.';
