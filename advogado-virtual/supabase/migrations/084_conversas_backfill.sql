-- ============================================================
-- 084_conversas_backfill.sql — BACKFILL do histórico do Chatwoot para o acervo
-- próprio (plano Conversas Próprias, docs/PLANO-CONVERSAS-PROPRIAS-OPUS.md).
--
-- A etapa de backfill era da Etapa 4; foi ANTECIPADA por decisão do dono
-- (2026-07-27) para a Etapa 2 (a tela /conversas lendo do NOSSO banco) nascer
-- com o passado completo — sem isto, a tela própria mostraria só o que a
-- ingestão da Etapa 0 capturou (de 2026-07-25 em diante).
--
-- O que esta migration cria:
--
--  • conversas_backfill_estado — CURSOR DURÁVEL da varredura, uma linha por
--    (inbox × status) do Chatwoot. A importação roda em ticks de cron com
--    deadline (a função Vercel morre em 300s): o cursor é o que permite parar no
--    meio e retomar exatamente de onde parou, sem reimportar o que já veio.
--    Os contadores são só observabilidade (LGPD: contagem, nunca conteúdo).
--
--  • conversa_mensagens.origem_backfill — PROVENIÊNCIA: true = a linha veio do
--    histórico do Chatwoot (importada), false = veio do webhook da Evolution
--    pelo encaminhador (Etapa 0). Auditoria e, no futuro, uma eventual
--    re-importação seletiva.
--
-- ANTI-LOOP (o ponto mais perigoso desta etapa, registrado aqui de propósito):
-- toda mensagem importada nasce com chatwoot_confirmada_em preenchido — ela VEIO
-- do Chatwoot, logo está no Chatwoot. Sem esse carimbo, o reconciliador da
-- Etapa 1 (migration 083) leria o acervo inteiro como "suspeito de perdido" e
-- tentaria REPOSTAR o passado do escritório no Chatwoot. chatwoot_postada_em
-- NUNCA é preenchido pelo backfill: nós não postamos nada, só lemos.
--
-- Idempotente (CREATE/ALTER explícitos, lição da 066/068). NÃO aplicar à mão —
-- o orquestrador aplica antes do deploy.
-- ============================================================

-- ------------------------------------------------------------
-- conversas_backfill_estado — cursor da varredura por (inbox × status).
-- São 8 linhas por tenant: df/sc × open/resolved/pending/snoozed (os QUATRO
-- status do Chatwoot — conversa parada no bot fica em 'pending' e não aparece
-- em open/resolved: sem ela o "todo o histórico" seria mentira). Cada
-- combinação é uma listagem paginada independente no Chatwoot
-- (GET /conversations?status=&page=&inbox=).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversas_backfill_estado (
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Caixa de entrada do Chatwoot: 'df' | 'sc' (TEXT, não enum: unidade nova não
  -- deve exigir migration — mesma decisão de conversas_acervo.instancia).
  inbox                TEXT NOT NULL,
  -- Status da listagem no Chatwoot: 'open' | 'resolved' | 'pending' | 'snoozed'.
  status               TEXT NOT NULL,
  -- Próxima página a pedir ao Chatwoot (1-based). Só avança quando TODAS as
  -- conversas da página atual terminaram de importar.
  pagina               INT NOT NULL DEFAULT 1,
  -- true quando a listagem devolveu página vazia = fim desta combinação.
  concluido            BOOLEAN NOT NULL DEFAULT false,
  -- Ids (do Chatwoot) das conversas da PÁGINA ATUAL que já terminaram. Sem isto
  -- o progresso DENTRO da página não é durável: uma página cujo trabalho não
  -- cabe num tick (conversa com muita mídia) seria refeita do zero a cada 10 min
  -- e a varredura travaria para sempre naquela página. Esvaziado quando a página
  -- anda. Máximo ~25 ids (o tamanho da página do Chatwoot).
  conversas_pagina_ok  BIGINT[] NOT NULL DEFAULT '{}',
  -- Observabilidade (acumulados desde o início da varredura).
  conversas_feitas     INT NOT NULL DEFAULT 0,
  mensagens_importadas INT NOT NULL DEFAULT 0,
  anexos_importados    INT NOT NULL DEFAULT 0,
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, inbox, status)
);

-- Lição da 066/068: coluna nova em tabela que PODE já existir sempre por ALTER
-- explícito (o CREATE ... IF NOT EXISTS vira no-op na re-execução).
ALTER TABLE conversas_backfill_estado ADD COLUMN IF NOT EXISTS pagina               INT NOT NULL DEFAULT 1;
ALTER TABLE conversas_backfill_estado ADD COLUMN IF NOT EXISTS concluido            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE conversas_backfill_estado ADD COLUMN IF NOT EXISTS conversas_pagina_ok  BIGINT[] NOT NULL DEFAULT '{}';
ALTER TABLE conversas_backfill_estado ADD COLUMN IF NOT EXISTS conversas_feitas     INT NOT NULL DEFAULT 0;
ALTER TABLE conversas_backfill_estado ADD COLUMN IF NOT EXISTS mensagens_importadas INT NOT NULL DEFAULT 0;
ALTER TABLE conversas_backfill_estado ADD COLUMN IF NOT EXISTS anexos_importados    INT NOT NULL DEFAULT 0;
ALTER TABLE conversas_backfill_estado ADD COLUMN IF NOT EXISTS atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now();

-- ------------------------------------------------------------
-- Proveniência da mensagem: importada do Chatwoot × capturada ao vivo.
-- NOT NULL DEFAULT false: as linhas que já existem são todas da Etapa 0.
-- ------------------------------------------------------------
ALTER TABLE conversa_mensagens
  ADD COLUMN IF NOT EXISTS origem_backfill BOOLEAN NOT NULL DEFAULT false;

-- Fila de mídia do backfill: anexo cuja mensagem já entrou mas cujo binário
-- ainda não coube no tick (ou falhou). Índice PARCIAL — no estado normal é
-- vazio, então não custa nada no acervo inteiro.
CREATE INDEX IF NOT EXISTS idx_conversa_mensagens_backfill_media
  ON conversa_mensagens (tenant_id, conversa_id)
  WHERE origem_backfill AND media_storage_path IS NULL AND media_pendente_motivo IS NOT NULL;

-- ------------------------------------------------------------
-- RLS SERVICE-ONLY: habilitada SEM policy → nenhum anon/authenticated lê ou
-- escreve; só o service_role (que bypassa RLS) toca a tabela. Mesmo padrão de
-- 066/068/082.
-- ------------------------------------------------------------
ALTER TABLE conversas_backfill_estado ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE conversas_backfill_estado IS
  'Cursor durável do backfill do histórico do Chatwoot para o acervo próprio: uma linha por (tenant, inbox, status). Service-only (RLS sem policy). Ver 084 e docs/PLANO-CONVERSAS-PROPRIAS-OPUS.md.';
COMMENT ON COLUMN conversas_backfill_estado.pagina IS
  'Próxima página da listagem do Chatwoot (1-based). Só avança quando toda a página atual terminou — retomada é sempre idempotente (dedupe por UNIQUE tenant+instancia+mensagem_id).';
COMMENT ON COLUMN conversas_backfill_estado.conversas_pagina_ok IS
  'Conversas (id do Chatwoot) da página atual já concluídas: progresso DURÁVEL dentro da página. Uma página cujo trabalho não cabe num tick (muita mídia) só termina porque as conversas já feitas são puladas sem custo de relay. Volta a {} quando a página anda.';
COMMENT ON COLUMN conversas_backfill_estado.concluido IS
  'true quando a listagem devolveu página vazia (fim). Para RE-RODAR a varredura (ex.: depois de ligar RELAY_PROXY_ATTACHMENTS e recuperar os anexos que ficaram pendentes), basta voltar concluido=false e pagina=1: mensagens já importadas são deduplicadas e só a mídia faltante é preenchida.';
COMMENT ON COLUMN conversa_mensagens.origem_backfill IS
  'true = linha IMPORTADA do histórico do Chatwoot (backfill, 084); false = capturada ao vivo pelo encaminhador da Evolution (Etapa 0, 082). Toda linha do backfill nasce com chatwoot_confirmada_em preenchido (ela veio do Chatwoot) e NUNCA com chatwoot_postada_em — sem isso o reconciliador da 083 tentaria repostar o passado inteiro.';
