-- ============================================================
-- 059_processos_sync_pendente.sql — fila durável de sincronização de andamentos
-- Quando uma publicação do DJEN casa com um processo cadastrado (djen.ts), o
-- processo é MARCADO como pendente de sync (publicação = sinal de atividade). O
-- cron drena a fila (sincronizarProcessos) puxando os andamentos do DataJud e,
-- em QUALQUER via de sync bem-sucedido (cron, botão "Buscar andamentos",
-- cadastro/vínculo), a flag é LIMPA. É durável: o que não couber no orçamento de
-- um ciclo permanece marcado e é drenado no próximo — nada se perde.
-- Ver src/lib/processos/{djen,sync}.ts e docs/PLANO-FASE-5-OPUS.md.
-- ============================================================

ALTER TABLE processos
  ADD COLUMN IF NOT EXISTS sync_pendente BOOLEAN NOT NULL DEFAULT false;

-- Índice PARCIAL: a fila é minoria (só processos com publicação recente casada),
-- então indexar apenas as linhas pendentes mantém o drain do cron barato.
CREATE INDEX IF NOT EXISTS idx_processos_sync_pendente
  ON processos (tenant_id) WHERE sync_pendente;

COMMENT ON COLUMN processos.sync_pendente IS
  'Fila durável de sync de andamentos: DJEN marca (publicação casada = atividade); o cron drena via DataJud; qualquer sync bem-sucedido limpa. Ver 059.';
