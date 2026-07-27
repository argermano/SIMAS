-- ============================================================
-- 083_conversa_mensagens_reconciliacao.sql — Etapa 1 do plano Conversas Próprias
-- (docs/PLANO-CONVERSAS-PROPRIAS-OPUS.md §Etapa 1): "garantia de entrega ao
-- Chatwoot — o bug atual morre aqui".
--
-- A Etapa 0 (migration 082) fez o SIMAS DONO do acervo: todo evento da Evolution
-- é gravado aqui, inclusive o que a ponte Evolution↔Chatwoot perde em silêncio
-- (mídia-primeiro em conversa não aberta; grupo). Esta migration dá ao acervo as
-- colunas de CONFIRMAÇÃO e de FILA da reconciliação:
--
--  • chatwoot_confirmada_em — a mensagem foi VISTA no Chatwoot (casada pelo
--    confirmador: marcador nosso, ou direção + tempo + prefixo/mídia). Enquanto
--    for NULL e postada_em for NULL, ela é "suspeita de perdida".
--  • chatwoot_postada_em / chatwoot_msg_id — NÓS a postamos no Chatwoot (via
--    POST {RELAY_URL}/reconciliar/mensagem) e o relay devolveu o id criado.
--  • rec_claim_em / rec_tentativas / rec_detalhe — a fila: claim de execução
--    (padrão da casa: UPDATE condicional, sem .or() com timestamp; claim velho
--    é retomado após ~10 min, o que cobre kill de função no meio da postagem),
--    contador de tentativas (dead-letter passivo) e o CÓDIGO do último desfecho
--    (LGPD: código curto, nunca conteúdo).
--
-- A ponte nativa da Evolution CONTINUA ligada: a reconciliação só cobre buraco
-- (posta o que comprovadamente NÃO chegou), e o marcador 'simas-rec:<id>' torna
-- a re-execução idempotente do lado do relay.
--
-- Idempotente (ALTER ... IF NOT EXISTS explícito, lição da 066/068). NÃO aplicar
-- à mão — o orquestrador aplica antes do deploy.
-- ============================================================

-- Confirmação (lado da leitura: o confirmador casa nosso acervo × Chatwoot).
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS chatwoot_confirmada_em TIMESTAMPTZ;
-- Postagem (lado da escrita: nós repusemos a mensagem no Chatwoot).
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS chatwoot_postada_em    TIMESTAMPTZ;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS chatwoot_msg_id        TEXT;
-- Fila da reconciliação.
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS rec_claim_em           TIMESTAMPTZ;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS rec_tentativas         INT NOT NULL DEFAULT 0;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS rec_detalhe            TEXT;

-- Varredura da folga do cron: "mensagens pendentes mais antigas do tenant".
-- Índice PARCIAL de propósito — o estado normal é TUDO confirmado, então o
-- índice fica minúsculo (só o backlog) e a varredura não paga um seq scan no
-- acervo inteiro. Mesma ordem (tenant_id, timestamp_msg) da consulta.
CREATE INDEX IF NOT EXISTS idx_conversa_mensagens_rec_pendentes
  ON conversa_mensagens (tenant_id, timestamp_msg)
  WHERE chatwoot_confirmada_em IS NULL AND chatwoot_postada_em IS NULL;

COMMENT ON COLUMN conversa_mensagens.chatwoot_confirmada_em IS
  'Quando o confirmador VIU esta mensagem no Chatwoot (casamento por marcador simas-rec:<id> ou por direção + |Δt| <= 180s + prefixo/mídia). NULL + postada_em NULL = suspeita de perdida. Ver 083.';
COMMENT ON COLUMN conversa_mensagens.chatwoot_postada_em IS
  'Quando NÓS repusemos a mensagem no Chatwoot (POST {RELAY_URL}/reconciliar/mensagem). Exclui a linha da fila para sempre. Ver 083.';
COMMENT ON COLUMN conversa_mensagens.chatwoot_msg_id IS
  'Id da mensagem criada no Chatwoot pela reconciliação (ou o id existente devolvido pela idempotência do relay).';
COMMENT ON COLUMN conversa_mensagens.rec_claim_em IS
  'Claim de execução da reconciliação (UPDATE condicional atômico). Claim com mais de ~10 min é retomado — cobre kill da função no meio da postagem.';
COMMENT ON COLUMN conversa_mensagens.rec_tentativas IS
  'Tentativas de postagem. Teto 5 (dead-letter passivo); casos esperados que dependem do outro lado (grupo_sem_conversa) têm teto próprio maior.';
COMMENT ON COLUMN conversa_mensagens.rec_detalhe IS
  'CÓDIGO curto do último desfecho (grupo_sem_conversa, contato_nao_criavel, http_502...). LGPD: nunca conteúdo de mensagem.';
