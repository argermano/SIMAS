-- ============================================================
-- 086_pecas_sessoes_artefatos.sql — ARTEFATOS DE APOIO gerados pela IA
-- (pacote F0.5 de docs/PLANO-MOTOR-V3-OPUS.md, §7 "materialização AUTOMÁTICA").
--
-- Quando o agente roda python no sandbox (server tool `code_execution`) e
-- produz um arquivo — a planilha de cálculos, a memória de cálculo, um gráfico —
-- esse arquivo vai SEM confirmação para o dossiê do caso (tipo `apoio_ia`,
-- vínculos na pasta do caso/processo, espelho no Drive). Exigência do dono.
--
-- Esta migration é ADITIVA e pequena: `pecas_sessoes_anexos` deixa de ser só
-- "documentos que o advogado anexou" e passa a ser o MAPA dos documentos da
-- sessão, com duas colunas novas:
--
--  • origem — 'advogado' (anexo manual, o comportamento de sempre) | 'gerado'
--             (artefato produzido pela IA). O contexto da rodada só monta os
--             de origem 'advogado': reinjetar a planilha que o próprio agente
--             acabou de escrever queimaria tokens e invalidaria o cache.
--  • slug   — o NOME LÓGICO do artefato dentro da sessão ("calculos-rescisao").
--             É a chave do versionamento: regerar a planilha SUBSTITUI a
--             anterior (mesmo Storage, mesma linha em documentos) em vez de
--             encher o dossiê de cópias — mesmo espírito do uq_documentos_peca.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
-- NÃO aplicar à mão — o orquestrador aplica antes do deploy.
-- ============================================================

ALTER TABLE pecas_sessoes_anexos
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'advogado';

ALTER TABLE pecas_sessoes_anexos
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- Versionamento por NOME LÓGICO: no máximo um artefato 'gerado' por (sessão, slug).
-- Índice PARCIAL de propósito: anexos do advogado não têm slug e não competem aqui.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pecas_sessoes_anexos_gerado
  ON pecas_sessoes_anexos (sessao_id, slug)
  WHERE origem = 'gerado' AND slug IS NOT NULL;

-- A montagem do contexto filtra por origem a cada rodada.
CREATE INDEX IF NOT EXISTS idx_pecas_sessoes_anexos_origem
  ON pecas_sessoes_anexos (sessao_id, origem);

COMMENT ON COLUMN pecas_sessoes_anexos.origem IS
  'advogado = documento anexado por uma pessoa (entra no contexto da rodada) | gerado = artefato produzido pela IA no sandbox e materializado no dossiê (NÃO volta ao contexto). Ver 086 e src/lib/ia/sessao/artefatos.ts.';
COMMENT ON COLUMN pecas_sessoes_anexos.slug IS
  'Nome lógico do artefato gerado dentro da sessão. Regerar o mesmo nome lógico substitui o arquivo e atualiza a MESMA linha em documentos (uq_pecas_sessoes_anexos_gerado).';
