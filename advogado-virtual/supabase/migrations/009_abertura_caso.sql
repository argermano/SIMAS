-- 009_abertura_caso.sql
-- Campos para classificação de serviço e checklist de documentos

ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS tipo_servico       TEXT CHECK (tipo_servico IN ('administrativo', 'judicial')),
  ADD COLUMN IF NOT EXISTS tipo_processo      TEXT,
  ADD COLUMN IF NOT EXISTS checklist_entregues JSONB NOT NULL DEFAULT '{}';

-- Índice para busca por tipo de serviço
CREATE INDEX IF NOT EXISTS idx_atendimentos_tipo_servico ON atendimentos (tipo_servico);
