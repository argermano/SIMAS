-- ============================================================
-- 028_integridade_users.sql
-- 1) E-mail único POR TENANT (em vez de global) — permite o mesmo e-mail
--    em escritórios diferentes (correção do isolamento multi-tenant).
-- 2) ON DELETE SET NULL nas FKs NULÁVEIS de auditoria que referenciam users(id)
--    — preserva o histórico ao remover/desativar um usuário.
--
-- NÃO altera as FKs NOT NULL (ex.: atendimentos.user_id, pecas.created_by,
-- analises.created_by, api_usage_log.user_id, documentos_gerados.created_by,
-- exportacoes.exported_by): exigem decisão (CASCADE x tornar nulável x
-- reatribuir na aplicação) — tratado em etapa posterior.
-- task_assignees.user_id já é ON DELETE CASCADE.
-- ============================================================

-- 1) UNIQUE(email) global -> UNIQUE(tenant_id, email)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_email_key;
ALTER TABLE users ADD CONSTRAINT users_tenant_email_key UNIQUE (tenant_id, email);

-- 2) FKs nuláveis -> ON DELETE SET NULL
ALTER TABLE analises            DROP CONSTRAINT IF EXISTS analises_revisada_por_fkey;
ALTER TABLE analises            ADD  CONSTRAINT analises_revisada_por_fkey            FOREIGN KEY (revisada_por) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE clientes            DROP CONSTRAINT IF EXISTS clientes_created_by_fkey;
ALTER TABLE clientes            ADD  CONSTRAINT clientes_created_by_fkey             FOREIGN KEY (created_by)   REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE contract_signatures DROP CONSTRAINT IF EXISTS contract_signatures_created_by_fkey;
ALTER TABLE contract_signatures ADD  CONSTRAINT contract_signatures_created_by_fkey  FOREIGN KEY (created_by)   REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE contratos_honorarios DROP CONSTRAINT IF EXISTS contratos_honorarios_criado_por_fkey;
ALTER TABLE contratos_honorarios ADD CONSTRAINT contratos_honorarios_criado_por_fkey FOREIGN KEY (criado_por)   REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE documentos          DROP CONSTRAINT IF EXISTS documentos_confirmado_por_fkey;
ALTER TABLE documentos          ADD  CONSTRAINT documentos_confirmado_por_fkey       FOREIGN KEY (confirmado_por) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE kanban_boards       DROP CONSTRAINT IF EXISTS kanban_boards_created_by_fkey;
ALTER TABLE kanban_boards       ADD  CONSTRAINT kanban_boards_created_by_fkey        FOREIGN KEY (created_by)   REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE modelos_documento   DROP CONSTRAINT IF EXISTS modelos_documento_created_by_fkey;
ALTER TABLE modelos_documento   ADD  CONSTRAINT modelos_documento_created_by_fkey    FOREIGN KEY (created_by)   REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE pecas               DROP CONSTRAINT IF EXISTS pecas_revisado_por_fkey;
ALTER TABLE pecas               ADD  CONSTRAINT pecas_revisado_por_fkey              FOREIGN KEY (revisado_por) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE pecas_versoes       DROP CONSTRAINT IF EXISTS pecas_versoes_alterado_por_fkey;
ALTER TABLE pecas_versoes       ADD  CONSTRAINT pecas_versoes_alterado_por_fkey      FOREIGN KEY (alterado_por) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE task_lists          DROP CONSTRAINT IF EXISTS task_lists_created_by_fkey;
ALTER TABLE task_lists          ADD  CONSTRAINT task_lists_created_by_fkey           FOREIGN KEY (created_by)   REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE tasks               DROP CONSTRAINT IF EXISTS tasks_created_by_fkey;
ALTER TABLE tasks               ADD  CONSTRAINT tasks_created_by_fkey                FOREIGN KEY (created_by)   REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE templates_contrato  DROP CONSTRAINT IF EXISTS templates_contrato_created_by_fkey;
ALTER TABLE templates_contrato  ADD  CONSTRAINT templates_contrato_created_by_fkey   FOREIGN KEY (created_by)   REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE templates_documentos DROP CONSTRAINT IF EXISTS templates_documentos_criado_por_fkey;
ALTER TABLE templates_documentos ADD CONSTRAINT templates_documentos_criado_por_fkey FOREIGN KEY (criado_por)   REFERENCES users(id) ON DELETE SET NULL;
