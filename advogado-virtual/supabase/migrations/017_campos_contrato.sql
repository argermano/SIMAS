-- Campos adicionais para contratos: cliente + perfil advogado

-- Clientes: órgão expedidor do RG e nacionalidade
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS orgao_expedidor TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS nacionalidade TEXT DEFAULT 'brasileiro(a)';

-- Users (perfil profissional do advogado): CPF, RG, órgão expedidor, estado civil, nacionalidade, bairro
ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf_profissional TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rg_profissional TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS orgao_expedidor_profissional TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS estado_civil_profissional TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nacionalidade_profissional TEXT DEFAULT 'brasileiro(a)';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bairro_profissional TEXT;
