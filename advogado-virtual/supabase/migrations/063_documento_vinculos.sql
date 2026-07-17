-- ============================================================
-- 063_documento_vinculos.sql — vínculo documento ↔ caso/processo vira N:N
-- Antes (060/061): o vínculo específico de um doc era UM só
-- (documentos.atendimento_id XOR processo_id, garantido pelo CHECK da 061).
-- O dono quer o dossiê como "árvore de pastas": o MESMO arquivo pode aparecer em
-- VÁRIOS casos e processos ao mesmo tempo, como ATALHOS — sem duplicar o arquivo.
-- Isso exige uma tabela de vínculos N:N.
--
-- documentos.atendimento_id/processo_id PERMANECEM, mas só como ORIGEM (onde o doc
-- nasceu): as rotas de atendimento seguem gravando atendimento_id ao criar o doc.
-- TODA leitura/gestão de vínculo passa a ser por documento_vinculos.
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS documento_vinculos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  documento_id   UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  -- Alvos do vínculo — exatamente UM preenchido (CHECK abaixo). ON DELETE CASCADE
  -- nos DOIS alvos: apagar o caso/processo faz o ATALHO sumir (esta linha), não
  -- anular a coluna deixando uma linha órfã sem alvo (que violaria o CHECK). O
  -- arquivo em si nunca some junto — ele é do cliente, vive em `documentos`.
  atendimento_id UUID REFERENCES atendimentos(id) ON DELETE CASCADE,
  processo_id    UUID REFERENCES processos(id)    ON DELETE CASCADE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exatamente UM alvo por linha (um vínculo = um doc dentro de UMA "pasta").
  CONSTRAINT documento_vinculos_alvo_chk
    CHECK ((atendimento_id IS NOT NULL) <> (processo_id IS NOT NULL))
);

-- Idempotência do vínculo: o mesmo doc não entra 2x na mesma pasta. Índices
-- parciais (um por tipo de alvo) porque o outro alvo é sempre NULL na linha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_documento_vinculos_atendimento
  ON documento_vinculos (documento_id, atendimento_id) WHERE atendimento_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_documento_vinculos_processo
  ON documento_vinculos (documento_id, processo_id) WHERE processo_id IS NOT NULL;

-- Listagem "docs desta pasta" dentro do tenant (tela do caso / do processo).
CREATE INDEX IF NOT EXISTS idx_documento_vinculos_tenant_atendimento
  ON documento_vinculos (tenant_id, atendimento_id) WHERE atendimento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documento_vinculos_tenant_processo
  ON documento_vinculos (tenant_id, processo_id) WHERE processo_id IS NOT NULL;
-- Listagem "pastas deste doc" (join em lote no dossiê, sem N+1).
CREATE INDEX IF NOT EXISTS idx_documento_vinculos_documento
  ON documento_vinculos (documento_id);

-- RLS padrão do repo (isolamento por tenant via get_user_tenant_id()), igual às
-- tabelas vizinhas (043/053). Sem WITH CHECK explícito → a USING também vale como
-- WITH CHECK no INSERT (a rota sempre grava tenant_id = tenant do usuário).
ALTER TABLE documento_vinculos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_documento_vinculos ON documento_vinculos;
CREATE POLICY tenant_isolation_documento_vinculos ON documento_vinculos
  USING (tenant_id = get_user_tenant_id());

-- ── BACKFILL: cada vínculo ÚNICO atual (060/061) vira uma linha ──────────────
-- Docs nascidos/vinculados a um caso (origem atendimento_id).
INSERT INTO documento_vinculos (tenant_id, documento_id, atendimento_id)
SELECT d.tenant_id, d.id, d.atendimento_id
  FROM documentos d
 WHERE d.atendimento_id IS NOT NULL
ON CONFLICT DO NOTHING;
-- Docs vinculados a um processo (061).
INSERT INTO documento_vinculos (tenant_id, documento_id, processo_id)
SELECT d.tenant_id, d.id, d.processo_id
  FROM documentos d
 WHERE d.processo_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- O CHECK exclusivo da 061 (no máx. UM entre atendimento_id/processo_id em
-- documentos) não faz mais sentido: o vínculo agora é N:N na tabela nova e as
-- colunas de documentos viram apenas ORIGEM. Removê-lo permite, p.ex., manter o
-- atendimento_id de origem enquanto o doc também é atalho de um processo. A coluna
-- documentos.processo_id (061) deixa de receber vínculo novo (só sobra como
-- histórico de origem); todo vínculo novo é linha em documento_vinculos.
ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_vinculo_especifico_chk;

COMMENT ON TABLE documento_vinculos IS
  'Vínculos N:N documento ↔ caso(atendimento)/processo — atalhos de "pasta" no dossiê. Exatamente um alvo por linha (documento_vinculos_alvo_chk). ON DELETE CASCADE nos alvos: apagar a pasta remove o atalho, nunca o arquivo (que é do cliente, em documentos).';
