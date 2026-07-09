-- ============================================================
-- 045_tratamento_nota.sql — Estação de tratamento de Publicações
-- Nota livre gravada durante o TRATAMENTO de uma publicação (fluxo tipo Astrea:
-- a tela é uma estação de tratamento; a tarefa é subproduto). A nota é opcional
-- e independe de haver tarefa criada. Ver docs/PLANO-PUBLICACOES-OPUS.md.
-- ============================================================

ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS tratamento_nota TEXT;

COMMENT ON COLUMN publicacoes.tratamento_nota IS 'Nota livre registrada no tratamento da publicação (estação de tratamento). Opcional e independente de tarefa; NUNCA contém HTML cru do campo texto.';
