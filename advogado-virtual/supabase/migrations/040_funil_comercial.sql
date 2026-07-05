-- ============================================================
-- 040_funil_comercial.sql — Funil comercial (Kanban de leads), Fase 4.
-- Lead = ciclo comercial (WhatsApp → contrato). Cliente = a pessoa (modelo
-- canônico existente). O funil NÃO duplica cadastro: referencia clientes.
-- Migração aditiva; RLS multi-tenant padrão do repo. Nada existente muda.
-- ============================================================

-- Clientes: pré-cadastro automático na entrada do lead (aditivo).
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS status_cadastro TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status_cadastro IN ('ativo', 'pre_cadastro', 'inativo')),
  ADD COLUMN IF NOT EXISTS origem TEXT;

COMMENT ON COLUMN clientes.status_cadastro IS 'pre_cadastro = criado pelo funil (mínimo de dados); ativo = cliente completo.';

CREATE TABLE IF NOT EXISTS funil_leads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id               UUID NOT NULL REFERENCES clientes(id),
  nome_informado           TEXT,
  telefone                 TEXT NOT NULL,          -- E.164
  email                    TEXT,
  area                     TEXT,
  unidade                  TEXT NOT NULL DEFAULT 'SC',   -- 'DF' | 'SC'
  origem                   TEXT NOT NULL DEFAULT 'whatsapp',
  etapa                    TEXT NOT NULL DEFAULT 'novo_lead'
    CHECK (etapa IN ('novo_lead', 'consulta_agendada', 'consulta_realizada',
                     'proposta_enviada', 'contrato_fechado', 'perdido')),
  valor_estimado           NUMERIC,
  motivo_perda             TEXT
    CHECK (motivo_perda IN ('sem_retorno', 'achou_caro', 'fechou_com_outro',
                            'sem_viabilidade_juridica', 'fora_da_area_de_atuacao', 'desistiu', 'outro')),
  motivo_perda_obs         TEXT,
  chatwoot_conversation_id INTEGER,
  cal_booking_uid          TEXT,
  consulta_data            TIMESTAMPTZ,
  consulta_formato         TEXT,                   -- 'presencial' | 'online'
  meet_url                 TEXT,
  aguardando_confirmacao   BOOLEAN NOT NULL DEFAULT false,
  sugerir_perda            BOOLEAN NOT NULL DEFAULT false,
  consulta_cancelada       BOOLEAN NOT NULL DEFAULT false,
  ultimo_contato_em        TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funil_leads_tenant_etapa ON funil_leads (tenant_id, etapa);
CREATE INDEX IF NOT EXISTS idx_funil_leads_telefone     ON funil_leads (tenant_id, telefone);
CREATE INDEX IF NOT EXISTS idx_funil_leads_cliente      ON funil_leads (cliente_id);
-- Idempotência do webhook Cal.com por uid do booking.
CREATE UNIQUE INDEX IF NOT EXISTS idx_funil_leads_booking
  ON funil_leads (cal_booking_uid) WHERE cal_booking_uid IS NOT NULL;

CREATE TABLE IF NOT EXISTS funil_lead_eventos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES funil_leads(id) ON DELETE CASCADE,
  de_etapa   TEXT,
  para_etapa TEXT NOT NULL,
  ator       TEXT NOT NULL CHECK (ator IN ('ia', 'humano', 'sistema')),
  ator_nome  TEXT,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funil_eventos_lead ON funil_lead_eventos (lead_id);

ALTER TABLE funil_leads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE funil_lead_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_funil_leads ON funil_leads;
CREATE POLICY tenant_isolation_funil_leads
  ON funil_leads USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_funil_eventos ON funil_lead_eventos;
CREATE POLICY tenant_isolation_funil_eventos
  ON funil_lead_eventos
  USING (lead_id IN (SELECT id FROM funil_leads WHERE tenant_id = get_user_tenant_id()));

COMMENT ON TABLE funil_leads IS 'Funil comercial: ciclo lead→contrato (Fase 4). Referencia clientes, não duplica cadastro.';
