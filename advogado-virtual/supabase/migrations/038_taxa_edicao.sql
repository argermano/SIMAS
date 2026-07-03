-- E10 / B6-mínimo — Telemetria de edição. Guarda quanto a peça foi editada em
-- relação à geração original (0 = nada editado, 1 = totalmente diferente).
-- Alimenta a fila de curadoria: o prompt cujas peças mais são editadas primeiro.
ALTER TABLE pecas
  ADD COLUMN IF NOT EXISTS taxa_edicao numeric;

COMMENT ON COLUMN pecas.taxa_edicao IS 'Dissimilaridade (0..1) entre a peça gerada pela IA e a salva pelo advogado.';
