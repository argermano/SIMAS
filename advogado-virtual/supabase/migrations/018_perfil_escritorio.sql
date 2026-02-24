-- ============================================================
-- 018_perfil_escritorio.sql
-- Move dados profissionais do escritório de users para tenants
-- Os dados são do escritório (tenant), não de cada usuário
-- ============================================================

-- Adicionar campos profissionais na tabela tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS oab_numero TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS oab_estado TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cpf_responsavel TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rg_responsavel TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS orgao_expedidor TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS estado_civil TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nacionalidade TEXT DEFAULT 'brasileiro(a)';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nome_responsavel TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_profissional TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bairro TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS estado TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cep TEXT;

-- Migrar dados do advogado principal (se houver) para o tenant
UPDATE tenants t
SET
  oab_numero       = u.oab_numero,
  oab_estado       = u.oab_estado,
  cpf_responsavel  = u.cpf_profissional,
  rg_responsavel   = u.rg_profissional,
  orgao_expedidor  = u.orgao_expedidor_profissional,
  estado_civil     = u.estado_civil_profissional,
  nacionalidade    = COALESCE(u.nacionalidade_profissional, 'brasileiro(a)'),
  nome_responsavel = u.nome,
  telefone         = u.telefone_profissional,
  email_profissional = u.email_profissional,
  endereco         = u.endereco_profissional,
  bairro           = u.bairro_profissional,
  cidade           = u.cidade_profissional,
  estado           = u.estado_profissional,
  cep              = u.cep_profissional
FROM users u
WHERE u.tenant_id = t.id
  AND u.is_advogado_principal = true;
