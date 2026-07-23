-- ============================================================
-- 080_documentos_peca.sql — vínculo materializado peça → documento do caso
-- Quando uma peça chega ao ESTADO FINAL (revisão aprovada ou exportada), o motor
-- materializa o .docx no bucket `documentos` e cria uma linha em `documentos`
-- (que a árvore do dossiê já lista). RE-aprovar/RE-exportar a MESMA peça deve
-- ATUALIZAR o mesmo documento — nunca duplicar. Para isso a linha guarda `peca_id`.
--
-- Lição 066/075: coluna nova em tabela que JÁ existe sempre via ALTER explícito.
-- Aditiva e sem semântica nova para os fluxos atuais (todo doc existente fica com
-- peca_id NULL — são anexos comuns). LGPD: só uma FK/uuid, nunca conteúdo/PII.
-- ============================================================

ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS peca_id UUID REFERENCES pecas(id) ON DELETE SET NULL;

-- Idempotência da materialização: no máximo UM documento materializado por peça
-- dentro do tenant. O upsert por peca_id (motor) depende deste índice parcial —
-- docs comuns (peca_id NULL) ficam de fora, sem restrição.
CREATE UNIQUE INDEX IF NOT EXISTS uq_documentos_peca
  ON documentos (tenant_id, peca_id) WHERE peca_id IS NOT NULL;

COMMENT ON COLUMN documentos.peca_id IS
  'Peça de origem quando o documento foi MATERIALIZADO a partir do editor (080): revisão aprovada/exportada gera o .docx no dossiê. NULL para anexos comuns. Re-aprovar/exportar a mesma peça atualiza a MESMA linha (uq_documentos_peca).';
