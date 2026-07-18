-- 066_2 — colunas do claim/reparent que ficaram fora do banco.
--
-- As tabelas drive_espelho/drive_sync_fila foram criadas em produção com o
-- schema ORIGINAL da 066; o review adicionou processando_em (claim atômico) e
-- parent_drive_id (reparenting) DENTRO dos CREATE TABLE IF NOT EXISTS — que
-- viraram no-op na re-execução e as colunas nunca materializaram (o dreno
-- falhava o claim com "column does not exist" → botão respondia 0 de 0).
-- Lição: coluna nova em migration já aplicada SEMPRE via ALTER explícito.

ALTER TABLE drive_sync_fila
  ADD COLUMN IF NOT EXISTS processando_em TIMESTAMPTZ;
COMMENT ON COLUMN drive_sync_fila.processando_em IS
  'Claim atômico do dreno (cron × botão): NULL = livre; timestamp velho (>15min) = dreno morto, pode reclamar.';

ALTER TABLE drive_espelho
  ADD COLUMN IF NOT EXISTS parent_drive_id TEXT;
COMMENT ON COLUMN drive_espelho.parent_drive_id IS
  'Pasta-pai atual no Drive (tipos arquivo/atalho) — base do reparenting quando o documento muda de pasta no SIMAS.';
