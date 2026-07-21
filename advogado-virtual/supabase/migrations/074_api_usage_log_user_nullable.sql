-- ============================================================
-- 074_api_usage_log_user_nullable.sql — uso de IA sem usuário (crons/sistema)
-- Auditoria "pipeline-processos" §21: a IA dos crons (resumos DataJud/DJEN)
-- gastava tokens Anthropic que NUNCA apareciam no painel de consumo
-- (api/configuracoes/uso-ia) porque `logUsage` insere via cliente anon (RLS) e
-- exige um usuário logado — inexistente no contexto de cron.
--
-- Agora o registro de uso do cron é gravado via service_role com user_id NULL
-- (não há usuário: é uso de SISTEMA). Para isso a coluna precisa aceitar NULL.
-- O painel uso-ia agrega por tenant/endpoint e não usa user_id, então nada quebra;
-- a FK para users(id) permanece (NULL é permitido em FK).
-- ============================================================

ALTER TABLE api_usage_log ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN api_usage_log.user_id IS
  'Usuário que originou a chamada de IA. NULL = uso de sistema/cron (ex.: resumos '
  'de movimentações DataJud/DJEN), gravado via service_role sem sessão.';
