-- Migration 021: Assinaturas Digitais (integração D4Sign)

-- ─── Assinaturas de contratos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_signatures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contrato_id      UUID NOT NULL REFERENCES contratos_honorarios(id) ON DELETE CASCADE,
  d4sign_uuid      TEXT,
  d4sign_safe_uuid TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','uploaded','signers_registered','waiting_signatures','completed','cancelled','download_ready')),
  sent_at          TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,
  signed_file_url  TEXT,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_signatures_tenant     ON contract_signatures (tenant_id);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_contrato   ON contract_signatures (contrato_id);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_d4sign_uuid ON contract_signatures (d4sign_uuid);

-- ─── Signatários ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_signature_signers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_id UUID NOT NULL REFERENCES contract_signatures(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  cpf_cnpj     TEXT,
  phone        TEXT,
  act          TEXT NOT NULL DEFAULT '1',   -- 1=assinar, 2=aprovar, 5=testemunha
  auth_method  TEXT NOT NULL DEFAULT 'email', -- email, sms, whatsapp, pix
  sign_order   INT,
  d4sign_key   TEXT,
  signed       BOOLEAN NOT NULL DEFAULT FALSE,
  signed_at    TIMESTAMPTZ,
  signing_link TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signers_signature ON contract_signature_signers (signature_id);

-- ─── Trigger updated_at ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_contract_signatures_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_signatures_updated_at ON contract_signatures;
CREATE TRIGGER trg_contract_signatures_updated_at
  BEFORE UPDATE ON contract_signatures
  FOR EACH ROW EXECUTE FUNCTION update_contract_signatures_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE contract_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_signature_signers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_signatures_tenant ON contract_signatures;
CREATE POLICY contract_signatures_tenant ON contract_signatures
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS contract_signature_signers_tenant ON contract_signature_signers;
CREATE POLICY contract_signature_signers_tenant ON contract_signature_signers
  USING (
    signature_id IN (
      SELECT id FROM contract_signatures WHERE tenant_id = get_user_tenant_id()
    )
  );
