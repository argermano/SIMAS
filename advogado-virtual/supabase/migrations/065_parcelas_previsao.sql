-- ============================================================
-- 065_parcelas_previsao.sql — Previsão de recebimento do contrato
-- (pedido do dono): ao gerar/assinar um contrato com valor fixo, o
-- financeiro passa a mostrar UMA parcela "prevista" — uma estimativa
-- de recebimento — até que a série real de parcelas seja lançada.
--
-- 'prevista' NÃO é cobrança de verdade:
--   • NUNCA recebe aviso (o cron filtra status='aberta');
--   • NUNCA recebe baixa/comprovante (as rotas exigem status='aberta');
--   • é SUBSTITUÍDA (removida) assim que existir parcela real do
--     contrato (aberta/paga) — não é baixa, é troca da estimativa.
-- ============================================================

-- Amplia o CHECK de status para incluir 'prevista'. O CHECK inline da
-- migration 050 recebeu o nome automático parcelas_status_check.
ALTER TABLE parcelas DROP CONSTRAINT IF EXISTS parcelas_status_check;
ALTER TABLE parcelas ADD CONSTRAINT parcelas_status_check
  CHECK (status IN ('aberta','paga','cancelada','prevista'));

COMMENT ON CONSTRAINT parcelas_status_check ON parcelas IS
  'Status da parcela. ''prevista'' = previsão de recebimento do contrato: '
  'nunca recebe aviso nem baixa; é substituída pelas parcelas reais quando a série é lançada.';

-- Índice UNIQUE (parcial) para localizar/dedup a previsão de um contrato e para
-- a métrica "Previsto" do resumo. É UNIQUE de propósito: garante NO NÍVEL DO
-- BANCO no máximo 1 previsão por (tenant, contrato) — sob corrida (ex.: duplo
-- clique de PATCH de valor), dois syncs concorrentes que leem "sem previsão" e
-- inserem juntos não duplicam (o 2º insert falha; o helper é best-effort e só
-- loga). Seguro criar como UNIQUE: NÃO há backfill, logo zero linhas 'prevista'
-- pré-existentes que pudessem violar a restrição na aplicação da migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parcelas_contrato_prevista
  ON parcelas (tenant_id, contrato_id)
  WHERE status = 'prevista';

-- DECISÃO (sem backfill): NÃO transformamos contratos legados em previsões
-- retroativas. A previsão nasce a partir de agora, quando um contrato é
-- criado/editado/assinado (helper sincronizarPrevisaoContrato). Backfillar a
-- base (inclui a carga do Astrea) criaria centenas de previsões sem pedido e
-- poluiria o financeiro — se um dia for desejado, roda-se um script pontual.
