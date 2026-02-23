-- 012_documentos_cliente_id.sql
-- Adiciona cliente_id à tabela documentos para facilitar buscas por cliente

ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_cliente ON documentos(cliente_id);
