-- E3 — Lembrete de prazo por e-mail. Marca quando o lembrete de uma tarefa já
-- foi enviado, para o cron diário não repetir o mesmo aviso.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS lembrete_enviado_em timestamptz;

COMMENT ON COLUMN tasks.lembrete_enviado_em IS 'Quando o lembrete de prazo desta tarefa foi enviado (idempotência do cron).';
