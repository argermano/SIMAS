-- ============================================================
-- 077_financeiro_baixa_automatica.sql — BAIXA AUTOMÁTICA de comprovante
-- Decisão do dono (2026-07-22, atualiza o invariante "baixa nunca automática"):
-- um comprovante recebido no WhatsApp pode ter BAIXA AUTOMÁTICA quando — e SÓ
-- quando — TODAS as condições da TRAVA valem (ver src/lib/financeiro/recebimento.ts):
--   (a) recebedor classificado como ESCRITÓRIO com CONFIANÇA (decisão 'sim');
--   (b) cliente identificado E o valor bate EXATAMENTE com UMA única parcela
--       'aberta' desse cliente ('prevista' NÃO conta — nunca recebe baixa);
--   (c) a IA leu valor e data (campos presentes, sem null).
-- Fora disso segue o fluxo humano (IA sugere, humano confirma).
--
-- A baixa automática executa a MESMA transição da confirmação humana (parcela
-- 'paga', pago_em = data do comprovante, comprovante vinculado, audit log), só
-- que baixa_por = NULL (baixa do sistema) e baixa_automatica = true.
--
-- DESFAZER: rota nova reverte a parcela para 'aberta' + reconstrói o staging
-- (vira "sugestão pendente" p/ conferência humana) e zera baixa_automatica.
-- Por que NÃO há coluna desfeita_em: o DESFAZER devolve a linha a um estado
-- 'aberta' limpo (que pode, depois, receber uma baixa MANUAL normal); um
-- desfeita_em preso na linha ficaria enganoso após essa nova baixa. O registro
-- do desfazer vive no audit_log (action='financeiro.baixa_automatica_desfeita',
-- com user_id + timestamp), fonte de verdade da trilha.
-- ============================================================

ALTER TABLE parcelas
  ADD COLUMN IF NOT EXISTS baixa_automatica BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN parcelas.baixa_automatica IS
  'true = a baixa desta parcela foi AUTOMÁTICA (comprovante do WhatsApp sob a TRAVA da migration 077: recebedor escritório com confiança + cliente identificado + valor casando exatamente 1 parcela aberta + valor/data lidos). baixa_por fica NULL nessas. DESFAZER reverte para aberta e zera este campo.';

-- Índice parcial p/ o painel/aviso "Baixas automáticas" (parcelas pagas pelo
-- sistema, ainda marcadas) do topo do /financeiro, ordenado por pago_em.
CREATE INDEX IF NOT EXISTS idx_parcelas_baixa_automatica
  ON parcelas (tenant_id, pago_em DESC)
  WHERE baixa_automatica = true AND status = 'paga';
