-- Prazo para revisão de peças
ALTER TABLE pecas ADD COLUMN IF NOT EXISTS prazo_revisao TIMESTAMPTZ;
