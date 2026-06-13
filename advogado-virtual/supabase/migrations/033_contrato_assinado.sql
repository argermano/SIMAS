-- Assinatura manual de contrato: status "assinado" + importação do contrato físico assinado.
--
-- Antes só havia rascunho/em_revisao/aprovado/exportado, e "exportado" era usado
-- como terminal para o caminho manual (exportar PDF = finalizado), sem distinguir
-- "exportei para assinar" de "assinado e devolvido". Agora há um estado próprio.

-- 1) Amplia o CHECK de status para incluir 'assinado'
ALTER TABLE contratos_honorarios DROP CONSTRAINT IF EXISTS contratos_honorarios_status_check;
ALTER TABLE contratos_honorarios ADD CONSTRAINT contratos_honorarios_status_check
  CHECK (status IN ('rascunho', 'em_revisao', 'aprovado', 'exportado', 'assinado'));

-- 2) Metadados da assinatura manual + arquivo assinado importado
ALTER TABLE contratos_honorarios
  ADD COLUMN IF NOT EXISTS assinado_em           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assinado_por          UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS arquivo_assinado_url  TEXT,
  ADD COLUMN IF NOT EXISTS arquivo_assinado_nome TEXT;

COMMENT ON COLUMN contratos_honorarios.assinado_em IS 'Quando o contrato foi confirmado como assinado (assinatura manual/física).';
COMMENT ON COLUMN contratos_honorarios.assinado_por IS 'Usuário que confirmou a assinatura.';
COMMENT ON COLUMN contratos_honorarios.arquivo_assinado_url IS 'Path no Storage (bucket documentos) do contrato assinado importado: {tenant_id}/contratos/{contratoId}/...';
COMMENT ON COLUMN contratos_honorarios.arquivo_assinado_nome IS 'Nome original do arquivo assinado importado.';
