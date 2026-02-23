-- 015_perfil_advogado.sql
-- Adiciona campos de perfil profissional e flag de advogado principal

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS oab_numero            TEXT,
  ADD COLUMN IF NOT EXISTS oab_estado            TEXT,
  ADD COLUMN IF NOT EXISTS telefone_profissional TEXT,
  ADD COLUMN IF NOT EXISTS email_profissional    TEXT,
  ADD COLUMN IF NOT EXISTS endereco_profissional TEXT,
  ADD COLUMN IF NOT EXISTS cidade_profissional   TEXT,
  ADD COLUMN IF NOT EXISTS estado_profissional   TEXT,
  ADD COLUMN IF NOT EXISTS cep_profissional      TEXT,
  ADD COLUMN IF NOT EXISTS is_advogado_principal BOOLEAN NOT NULL DEFAULT false;
