-- ============================================================
-- 053_financeiro_comprovantes_recebidos.sql — INBOX de comprovantes
-- Comprovante recebido no WhatsApp que a IA LEU e confirmou ser comprovante,
-- mas que NÃO virou staging automático numa parcela. Em vez de descartar (como
-- antes), criamos um registro aqui para o atendente conferir e ATRIBUIR a um
-- contrato/cliente. Casos que caem no inbox:
--   (a) cliente casado sem parcela aberta;
--   (b) cliente casado mas nenhuma parcela casou (sugestão null);
--   (c) claim de staging perdido (a parcela sugerida já tinha pendente);
--   (d) telefone não casa nenhum cliente — cliente_id fica null e o tenant é
--       resolvido pela heurística do ÚNICO escritório com Pix configurado.
-- INVARIANTE DURA: a baixa NUNCA é automática. ATRIBUIR (clique do atendente) É
-- a confirmação humana — só então nasce/baixa a parcela.
-- Dedup do webhook (reentrega do Chatwoot): UNIQUE (tenant_id, mensagem_id).
-- RLS tenant-scoped no padrão de parcelas (050): get_user_tenant_id().
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS comprovantes_recebidos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id    UUID REFERENCES clientes(id) ON DELETE SET NULL,   -- null quando o telefone não casou (caso d)
  telefone      TEXT NOT NULL,
  conversa_id   TEXT,
  mensagem_id   TEXT NOT NULL,
  dados         JSONB NOT NULL,                                    -- extração da IA (DadosComprovante)
  arquivo_url   TEXT NOT NULL,                                     -- financeiro/<tenantId>/inbox/<mensagemId>.<ext>
  content_type  TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','atribuido','descartado')),
  parcela_id    UUID REFERENCES parcelas(id) ON DELETE SET NULL,   -- preenchida ao atribuir (baixa)
  resolvido_em  TIMESTAMPTZ,
  resolvido_por UUID REFERENCES users(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mensagem_id)                                  -- dedup do webhook (reentrega)
);

-- Fila do atendente: pendentes do tenant por ordem de chegada.
CREATE INDEX IF NOT EXISTS idx_comprovantes_recebidos_tenant_status
  ON comprovantes_recebidos (tenant_id, status, criado_em DESC);
-- Consulta por cliente (ex.: inbox já atribuído a um cliente).
CREATE INDEX IF NOT EXISTS idx_comprovantes_recebidos_tenant_cliente
  ON comprovantes_recebidos (tenant_id, cliente_id);

-- RLS padrão do repo (isolamento por tenant via get_user_tenant_id()).
-- O webhook grava via service_role (bypassa RLS) sempre filtrando tenant_id.
ALTER TABLE comprovantes_recebidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_comprovantes_recebidos ON comprovantes_recebidos;
CREATE POLICY tenant_isolation_comprovantes_recebidos ON comprovantes_recebidos
  USING (tenant_id = get_user_tenant_id());

COMMENT ON TABLE comprovantes_recebidos IS 'Inbox de comprovantes recebidos no WhatsApp sem cobrança correspondente. Atendente confere e ATRIBUI (baixa) — nunca automático. Dedup por (tenant_id, mensagem_id).';
COMMENT ON COLUMN comprovantes_recebidos.cliente_id IS 'Palpite de cliente (telefone casou 1 cliente); null quando o telefone não casou (caso d) ou é ambíguo.';
COMMENT ON COLUMN comprovantes_recebidos.dados IS 'Dados extraídos pela IA (DadosComprovante). LGPD: nunca logar valores/nomes daqui.';
COMMENT ON COLUMN comprovantes_recebidos.arquivo_url IS 'Path do comprovante no bucket privado documentos: financeiro/<tenantId>/inbox/<mensagemId>.<ext>.';
COMMENT ON COLUMN comprovantes_recebidos.status IS 'pendente (aguardando atendente) | atribuido (virou baixa de parcela) | descartado.';
COMMENT ON COLUMN comprovantes_recebidos.parcela_id IS 'Parcela que recebeu a baixa ao atribuir (nova ou existente).';
