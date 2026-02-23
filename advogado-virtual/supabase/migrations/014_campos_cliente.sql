-- 014_campos_cliente.sql
-- Adiciona campos complementares ao cadastro do cliente

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS rg           TEXT,
  ADD COLUMN IF NOT EXISTS estado_civil TEXT,
  ADD COLUMN IF NOT EXISTS profissao    TEXT,
  ADD COLUMN IF NOT EXISTS bairro       TEXT,
  ADD COLUMN IF NOT EXISTS cep          TEXT;
