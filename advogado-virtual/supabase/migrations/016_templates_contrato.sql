-- Templates de contrato salvos pelo advogado (modelo convertido com variáveis)
CREATE TABLE IF NOT EXISTS templates_contrato (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  titulo        TEXT NOT NULL DEFAULT 'Contrato de Honorários',
  conteudo_markdown TEXT NOT NULL,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE templates_contrato ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_templates_contrato"
  ON templates_contrato
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE auth_user_id = auth.uid()));
