-- ============================================================
-- 007_workflow_revisao.sql
-- Fluxo de revisão por perfil de usuário
-- Documentos vinculados ao cliente (dossiê permanente)
-- ============================================================

-- 1. Colunas de controle de revisão em pecas
--    Novos status suportados: aguardando_revisao | rejeitada
--    (a coluna status já é TEXT, sem CHECK constraint)

ALTER TABLE pecas
  ADD COLUMN IF NOT EXISTS revisado_por    UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS revisado_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_rejeicao TEXT;

-- Índice para consulta eficiente da fila de revisão
CREATE INDEX IF NOT EXISTS idx_pecas_status_tenant ON pecas(tenant_id, status);

-- ─────────────────────────────────────────────────────────────

-- 2. Vincular documentos ao cliente para reaproveitamento em
--    atendimentos futuros (dossiê permanente)

ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_cliente ON documentos(cliente_id);

-- Backfill: preenche cliente_id nos documentos já existentes
UPDATE documentos d
SET    cliente_id = a.cliente_id
FROM   atendimentos a
WHERE  d.atendimento_id = a.id
  AND  d.cliente_id IS NULL;
