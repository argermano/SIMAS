-- Migration 019: Ampliar tipos permitidos em templates_documentos
-- Adiciona suporte a: contrato_honorarios, substabelecimento, notificacao_extrajudicial

-- Remover constraint antiga e recriar com os novos tipos
ALTER TABLE templates_documentos
  DROP CONSTRAINT IF EXISTS templates_documentos_tipo_check;

ALTER TABLE templates_documentos
  ADD CONSTRAINT templates_documentos_tipo_check
  CHECK (tipo IN (
    'contrato',
    'procuracao',
    'declaracao_hipossuficiencia',
    'contrato_honorarios',
    'substabelecimento',
    'notificacao_extrajudicial'
  ));
