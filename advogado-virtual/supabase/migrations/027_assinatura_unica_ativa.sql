-- ============================================================
-- 027_assinatura_unica_ativa.sql
-- Impede, no nível do banco, dois processos de assinatura ativos
-- para o mesmo contrato (race condition / dupla submissão).
--
-- Um índice UNIQUE parcial garante atomicidade: requisições concorrentes
-- que tentem criar uma segunda assinatura ativa falham no INSERT.
--
-- OBS.: se já existirem duplicatas ativas, a criação do índice falhará.
-- Cancele/limpe as duplicatas antes de aplicar, se necessário.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uniq_contract_signatures_ativa
  ON contract_signatures (contrato_id)
  WHERE status IN ('uploaded', 'signers_registered', 'waiting_signatures');
