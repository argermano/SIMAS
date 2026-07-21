-- ============================================================
-- 072_filas_tentativas.sql — contador de tentativas + dead-letter passivo
-- nas filas de espelho (drive_sync_fila, calendar_sync_fila).
--
-- PROBLEMA (auditoria 2026-07-21, achado #8): um item com falha PERMANENTE
-- (documento que nunca baixa do bucket, evento que o Google sempre rejeita com
-- HTTP 4xx) era liberado do claim a cada dreno e reprocessado PARA SEMPRE, em
-- silêncio — queimando budget e sumindo da vista do dono.
--
-- CORREÇÃO: 'tentativas' incrementa a cada falha; ao atingir o teto (ver
-- TETO_TENTATIVAS em src/lib/{drive,calendar}/espelho.ts) o item vira DEAD-LETTER
-- PASSIVO: continua na tabela para inspeção mas sai do claim (o dreno o ignora e
-- loga a contagem de mortos). 'ultimo_erro' guarda SÓ a classe/código HTTP do
-- último erro — LGPD: NUNCA o corpo da resposta do Google (pode conter e-mail).
--
-- Lição da 066/068: coluna nova em tabela já aplicada SEMPRE via ALTER explícito.
-- Idempotente. NÃO aplicar à mão (o orquestrador aplica antes do deploy).
-- ============================================================

ALTER TABLE drive_sync_fila
  ADD COLUMN IF NOT EXISTS tentativas  INT  NOT NULL DEFAULT 0;
ALTER TABLE drive_sync_fila
  ADD COLUMN IF NOT EXISTS ultimo_erro TEXT;

ALTER TABLE calendar_sync_fila
  ADD COLUMN IF NOT EXISTS tentativas  INT  NOT NULL DEFAULT 0;
ALTER TABLE calendar_sync_fila
  ADD COLUMN IF NOT EXISTS ultimo_erro TEXT;

COMMENT ON COLUMN drive_sync_fila.tentativas IS
  'Falhas consecutivas no dreno; ao atingir o teto (TETO_TENTATIVAS) vira dead-letter passivo (fora do claim, fica para inspeção). Ver src/lib/drive/espelho.ts.';
COMMENT ON COLUMN drive_sync_fila.ultimo_erro IS
  'Classe/código HTTP do último erro (ex.: http_400, DriveApiError). LGPD: só código/classe, NUNCA o corpo do erro.';
COMMENT ON COLUMN calendar_sync_fila.tentativas IS
  'Falhas consecutivas no dreno; ao atingir o teto (TETO_TENTATIVAS) vira dead-letter passivo (fora do claim, fica para inspeção). Ver src/lib/calendar/espelho.ts.';
COMMENT ON COLUMN calendar_sync_fila.ultimo_erro IS
  'Classe/código HTTP do último erro (ex.: http_400, CalendarApiError). LGPD: só código/classe, NUNCA o corpo do erro.';
