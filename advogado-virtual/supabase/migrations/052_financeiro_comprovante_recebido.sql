-- ============================================================
-- 052_financeiro_comprovante_recebido.sql — staging do comprovante
-- que o cliente envia no WhatsApp (webhook Chatwoot → SIMAS).
-- Quando um anexo (imagem/PDF) de um telefone que casa com cliente
-- que tem parcela aberta é lido pela MESMA IA já existente e casa com
-- UMA parcela, gravamos aqui o "comprovante pendente" — apenas
-- PRÉ-ORGANIZA a baixa.
-- INVARIANTE DURA: a baixa NUNCA é automática — um humano confere e
-- confirma na tela /financeiro. Parcela "aguardando baixa" (estado
-- derivado) = status 'aberta' E comprovante_recebido_em IS NOT NULL.
-- RLS: as policies existentes de parcelas (tenant_isolation_parcelas,
-- 050) já cobrem estas colunas — nada a mexer aqui.
-- ============================================================

ALTER TABLE parcelas
  ADD COLUMN IF NOT EXISTS comprovante_recebido_em    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comprovante_recebido_url   TEXT,
  ADD COLUMN IF NOT EXISTS comprovante_recebido_dados JSONB;

COMMENT ON COLUMN parcelas.comprovante_recebido_em IS 'Quando o cliente enviou (WhatsApp) um comprovante que a IA casou com esta parcela. NOT NULL + status aberta = "aguardando baixa". NÃO é baixa — só staging para conferência humana.';
COMMENT ON COLUMN parcelas.comprovante_recebido_url IS 'Path do comprovante recebido no bucket privado "documentos" (formato financeiro/<tenantId>/pendentes/...).';
COMMENT ON COLUMN parcelas.comprovante_recebido_dados IS 'Dados extraídos pela IA + { mensagemId, conversaId, contentType }. mensagemId serve de dedup do webhook do Chatwoot.';
