-- ============================================================
-- 061_documentos_processo.sql
-- Documentos podem ser vinculados a um PROCESSO (Fase 5), não só a um
-- atendimento/caso. O dono quer, no dossiê do cliente, distinguir docs GERAIS
-- de docs ESPECÍFICOS de um caso e/ou processo — e poder anexar a um caso um
-- documento que já está no cadastro do cliente (vínculo, sem duplicar o arquivo).
-- cliente_id (060) continua sendo o DONO do doc; atendimento_id/processo_id são
-- o vínculo específico opcional.
-- ============================================================

-- 1) Vínculo opcional a um processo. ON DELETE SET NULL: processo apagado
--    devolve o doc ao estado GERAL — o arquivo é do cliente e nunca some junto.
ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS processo_id UUID NULL REFERENCES processos(id) ON DELETE SET NULL;

-- 2) O vínculo ESPECÍFICO é no máximo UM: ou um caso (atendimento_id) ou um
--    processo (processo_id), nunca os dois ao mesmo tempo. (cliente_id, o dono,
--    não entra neste CHECK — segue livre.)
ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_vinculo_especifico_chk;
ALTER TABLE documentos
  ADD CONSTRAINT documentos_vinculo_especifico_chk
  CHECK (NOT (atendimento_id IS NOT NULL AND processo_id IS NOT NULL));

-- 3) Índice parcial para listar os docs de um processo dentro do tenant.
CREATE INDEX IF NOT EXISTS idx_documentos_tenant_processo
  ON documentos(tenant_id, processo_id) WHERE processo_id IS NOT NULL;

COMMENT ON COLUMN documentos.processo_id IS
  'Processo (Fase 5) ao qual o doc está vinculado; NULL = geral ou de caso. ON DELETE SET NULL: processo apagado devolve o doc a geral (o arquivo é do cliente, nunca some). Exclusivo com atendimento_id (documentos_vinculo_especifico_chk).';
