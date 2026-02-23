-- Migration 011: Localização do cliente + Consentimento de gravação

-- Localização do cliente (cidade/estado para endereçamento nas peças)
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS cidade TEXT,
  ADD COLUMN IF NOT EXISTS estado CHAR(2);

-- Consentimento de gravação de áudio (LGPD)
ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS consentimento_gravacao       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consentimento_confirmado_em  TIMESTAMPTZ;
