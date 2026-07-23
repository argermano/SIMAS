-- ============================================================
-- 079_users_celular_avisos.sql — celular do atendente + fila de claim do
-- aviso diário de tarefas por WhatsApp (frente W3).
--
-- CONTEXTO: o membro da equipe passa a ter um WhatsApp próprio (users.celular).
-- Serve a dois consumidores:
--   (1) o bot do VPS (GET /api/integracao/equipe-celulares) — para IGNORAR os
--       números da equipe (não responder a colega achando que é cliente);
--   (2) o aviso diário (cron lembretes-prazo → src/lib/tarefas/aviso-diario.ts) —
--       manda ao PRÓPRIO membro a lista das tarefas dele que vencem HOJE.
--
-- INVARIANTE (frente W3): isto NÃO cria nem calcula prazo — só LEMBRA tarefas com
-- vencimento (due_date) definido por um humano. Nunca há cálculo de prazo aqui.
--
-- Lição da 066/068/069: coluna nova em tabela que JÁ existe sempre via ALTER
-- explícito. Idempotente. NÃO aplicar à mão (o orquestrador aplica no deploy).
-- ============================================================

-- ── (A) Celular do membro ────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS celular TEXT;

COMMENT ON COLUMN users.celular IS
  'WhatsApp do PRÓPRIO membro da equipe (só dígitos, DDD+número, com/sem DDI 55). Admin configura em Configurações → Equipe. Usado por /api/integracao/equipe-celulares (o bot IGNORA esses números) e pelo aviso diário de tarefas (src/lib/tarefas/aviso-diario.ts). null = sem celular. Ver 079.';

-- ── (B) Fila/claim do aviso diário ───────────────────────────────────────────
-- Uma linha por (membro, dia) representa o CLAIM de que o aviso daquele dia já
-- foi (ou está sendo) enviado. O claim é o INSERT ON CONFLICT DO NOTHING: só quem
-- inserir a linha manda a mensagem — NUNCA 2 avisos ao mesmo membro no mesmo dia,
-- mesmo sob concorrência de execuções do cron. PK (user_id, dia) força a unicidade.
CREATE TABLE IF NOT EXISTS avisos_tarefas_diarios (
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  dia        DATE        NOT NULL,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dia)
);

-- Consultas/limpeza por tenant e dia (retenção do histórico de claims).
CREATE INDEX IF NOT EXISTS idx_avisos_tarefas_diarios_tenant_dia
  ON avisos_tarefas_diarios (tenant_id, dia);

-- RLS service-only: BOOKKEEPING de fila do motor, escrito SÓ pelo service_role
-- (que bypassa RLS). Habilitamos RLS SEM policy → nenhum anon/authenticated lê ou
-- escreve (mesmo padrão das filas internas: ver 066_drive_espelho / 068_calendar).
ALTER TABLE avisos_tarefas_diarios ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE avisos_tarefas_diarios IS
  'Claim do aviso diário de tarefas por WhatsApp: uma linha por (user_id, dia) = aviso do dia já reivindicado. INSERT ON CONFLICT DO NOTHING garante at-most-once por dia. Service-only (RLS sem policy). Ver 079 e src/lib/tarefas/aviso-diario.ts.';
