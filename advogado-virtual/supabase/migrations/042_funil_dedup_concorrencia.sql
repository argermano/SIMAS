-- ============================================================
-- 042_funil_dedup_concorrencia.sql
-- Impede duplicação de lead ativo / pré-cadastro por telefone quando chegam
-- requisições concorrentes (rajada de mensagens do WhatsApp). O upsert passa a
-- tratar o conflito (23505) reusando o registro existente.
-- Pré-requisito: dados já deduplicados (scripts/_tmp-dedup).
-- ============================================================

-- No máximo 1 cliente pré-cadastro (não deletado) por telefone.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cliente_precadastro_tel
  ON clientes (tenant_id, telefone)
  WHERE status_cadastro = 'pre_cadastro' AND deleted_at IS NULL AND telefone IS NOT NULL;

-- No máximo 1 lead ATIVO (não-terminal) por telefone.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_funil_lead_ativo_tel
  ON funil_leads (tenant_id, telefone)
  WHERE etapa NOT IN ('contrato_fechado', 'perdido');
