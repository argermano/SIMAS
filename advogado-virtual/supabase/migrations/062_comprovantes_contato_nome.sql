-- ============================================================
-- 062_comprovantes_contato_nome.sql — nome do contato do Chatwoot no inbox
-- Um comprovante enviado por um COLABORADOR do escritório aparecia como
-- "Cliente não identificado" + telefone cru. O nome do contato do Chatwoot
-- (meta.sender.name no webhook) torna a origem óbvia mesmo sem cadastro de
-- cliente. best-effort: pode ficar null (webhook sem nome, relay antigo, ou a
-- autocura do GET ainda não convergiu). Idempotente.
-- ============================================================

ALTER TABLE comprovantes_recebidos
  ADD COLUMN IF NOT EXISTS contato_nome TEXT;

COMMENT ON COLUMN comprovantes_recebidos.contato_nome IS 'Nome do contato no Chatwoot no momento do recebimento (meta.sender.name do webhook); best-effort — pode ser null e é preenchido por autocura via relay quando faltar. LGPD: nunca logar.';
