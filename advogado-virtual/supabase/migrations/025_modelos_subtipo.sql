-- Migration 025: Adicionar subtipo aos modelos de documento
-- subtipo identifica o tipo específico da peça (peticao_inicial, contestacao, etc.)
-- 'todos' serve como fallback quando não há modelo específico

ALTER TABLE modelos_documento ADD COLUMN IF NOT EXISTS subtipo TEXT NOT NULL DEFAULT 'todos';

CREATE INDEX IF NOT EXISTS idx_modelos_documento_subtipo ON modelos_documento (tenant_id, tipo, subtipo);
