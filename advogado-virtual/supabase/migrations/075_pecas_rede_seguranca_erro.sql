-- ============================================================
-- 072_pecas_rede_seguranca_erro.sql — marcador de falha da rede de segurança
-- Resiliência (auditoria "motor-after"): salvarPecaPosStreamSeVazia() é a última
-- linha de defesa quando o cliente cai no meio do stream — grava o conteúdo da
-- peça em after(). Se esse after() falhar (mesmo após 1 retry), a peça se perdia
-- em silêncio: o usuário já recebeu "sucesso" e o erro só ia para console.error.
--
-- Esta coluna materializa o estado de erro RECUPERÁVEL: quando não-nula, a peça
-- ficou vazia porque o servidor não conseguiu persistir. É um gancho de dados
-- (decoupled) para a UI/GET pecas oferecer "gerar de novo" em vez de ficar em
-- polling até o teto. Nenhuma consulta existente a lê — é aditiva e não muda
-- semântica de `status` (não interfere na fila de revisão nem nos badges).
--
-- LGPD: guarda só o INSTANTE da falha — nunca texto da peça, nome ou telefone.
-- ============================================================

-- Lição da 066/068/069/070: coluna nova em tabela que JÁ existe sempre via ALTER explícito.
ALTER TABLE pecas
  ADD COLUMN IF NOT EXISTS rede_seguranca_erro_at TIMESTAMPTZ;

COMMENT ON COLUMN pecas.rede_seguranca_erro_at IS
  'Instante em que a rede de segurança pós-stream (salvarPecaPosStreamSeVazia no motor) desistiu de gravar o conteúdo após 1 retry. Não-nulo = peça possivelmente vazia/perdida, recuperável via nova geração. Só timestamp (LGPD).';
