-- Tabela para armazenar contatos vindos da landing page / login
CREATE TABLE IF NOT EXISTS contatos_landing (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  email      TEXT NOT NULL,
  telefone   TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE contatos_landing ENABLE ROW LEVEL SECURITY;

-- Apenas service_role pode inserir/ler (via API server-side)
CREATE POLICY "service_role_all" ON contatos_landing
  FOR ALL USING (auth.role() = 'service_role');
