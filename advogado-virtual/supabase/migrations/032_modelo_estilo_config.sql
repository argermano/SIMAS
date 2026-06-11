-- ============================================================
-- 032_modelo_estilo_config.sql
-- Guarda o ESTILO real extraído do .docx que o advogado sobe como modelo
-- (fonte, margens, entrelinha, recuo, cabeçalho/rodapé). Precedência na
-- exportação: estilo do modelo > padrão do escritório > DEFAULT_ABNT.
-- Conteúdo (texto/markdown) continua em conteudo_markdown.
-- ============================================================

ALTER TABLE modelos_documento
  ADD COLUMN IF NOT EXISTS estilo_config JSONB;
