-- ============================================================
-- 082_conversas_acervo.sql — Etapa 0 do plano Conversas Próprias
-- (docs/PLANO-CONVERSAS-PROPRIAS-OPUS.md): o SIMAS passa a ser DONO do acervo
-- de conversas do WhatsApp. O encaminhador do VPS (ai-attendant) manda TODO
-- evento da Evolution para POST /api/integracao/conversas/eventos e a mídia sobe
-- DIRETO ao Storage por URL assinada (/api/integracao/conversas/preparar-media).
-- Nada é desligado nesta etapa: a ponte Evolution↔Chatwoot continua no ar; este
-- acervo roda EM PARALELO (e o medidor de perda usa conversa_gaps).
--
-- Três tabelas:
--  • conversas_acervo   — uma linha por conversa (instância + jid do WhatsApp).
--  • conversa_mensagens — o acervo em si; dedupe por (tenant, instância, id da
--    Evolution) → re-tentar um lote inteiro é SEMPRE seguro (contrato do
--    encaminhador: 5xx/timeout = re-enviar o lote).
--  • conversa_gaps      — medidor de paridade nosso × Chatwoot por conversa/dia.
--
-- DECISÃO REGISTRADA (dono, 2026-07-25): o TEXTO das mensagens fica CLARO no
-- banco — o acervo precisa ser buscável (é o produto: histórico jurídico do
-- escritório). A proteção é RLS SERVICE-ONLY (RLS habilitada SEM policy: nenhum
-- anon/authenticated lê ou escreve; só o service_role, que bypassa RLS, toca
-- estas tabelas — mesmo padrão das tabelas internas 066/068/072). Cifrar só se o
-- dono pedir (custo: perde a busca).
--
-- Idempotente (CREATE/ALTER explícitos, lição da 066/068). NÃO aplicar à mão —
-- o orquestrador aplica antes do deploy.
-- ============================================================

-- ------------------------------------------------------------
-- conversas_acervo — a conversa (individual ou grupo) por instância.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversas_acervo (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Instância da Evolution que recebeu/enviou ('whatsapp-sc' | 'whatsapp-df').
  -- TEXT (não enum) de propósito: uma unidade nova não deve exigir migration.
  instancia          TEXT NOT NULL,
  -- remoteJid da Evolution: '<numero>@s.whatsapp.net' (individual) ou
  -- '<id>@g.us' (grupo). É a identidade da conversa — nunca normalizado aqui.
  jid                TEXT NOT NULL,
  tipo               TEXT NOT NULL DEFAULT 'individual'
                       CHECK (tipo IN ('individual','grupo')),
  -- Nome do grupo (subject) quando disponível; NULL em conversa individual (o
  -- nome do contato vem do cadastro/pushName, não daqui).
  titulo             TEXT,
  -- Timestamp da mensagem mais recente já ingerida (ordenação da lista).
  -- Só AVANÇA: evento fora de ordem/backfill não pode "envelhecer" a conversa.
  ultima_mensagem_em TIMESTAMPTZ,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Identidade da conversa: mesma pessoa em instâncias diferentes = conversas
  -- diferentes (são caixas de entrada distintas — DF e SC).
  UNIQUE (tenant_id, instancia, jid)
);

-- Lição da 066/068: coluna nova em tabela que PODE já existir sempre por ALTER
-- explícito (o CREATE ... IF NOT EXISTS vira no-op na re-execução).
ALTER TABLE conversas_acervo ADD COLUMN IF NOT EXISTS instancia          TEXT;
ALTER TABLE conversas_acervo ADD COLUMN IF NOT EXISTS jid                TEXT;
ALTER TABLE conversas_acervo ADD COLUMN IF NOT EXISTS tipo               TEXT;
ALTER TABLE conversas_acervo ADD COLUMN IF NOT EXISTS titulo             TEXT;
ALTER TABLE conversas_acervo ADD COLUMN IF NOT EXISTS ultima_mensagem_em TIMESTAMPTZ;
ALTER TABLE conversas_acervo ADD COLUMN IF NOT EXISTS criado_em          TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE conversas_acervo ADD COLUMN IF NOT EXISTS atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now();

-- Lista de conversas do tenant, mais recente primeiro (tela da Etapa 2).
CREATE INDEX IF NOT EXISTS idx_conversas_acervo_recentes
  ON conversas_acervo (tenant_id, ultima_mensagem_em DESC NULLS LAST);

-- ------------------------------------------------------------
-- conversa_mensagens — o acervo. Uma linha por mensagem da Evolution.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversa_mensagens (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversa_id           UUID NOT NULL REFERENCES conversas_acervo(id) ON DELETE CASCADE,
  -- key.id da Evolution. Com (tenant_id, instancia) forma a chave de DEDUPE.
  mensagem_id           TEXT NOT NULL,
  instancia             TEXT NOT NULL,
  -- key.fromMe: true = saiu do nosso número (bot ou atendente).
  de_mim                BOOLEAN NOT NULL DEFAULT false,
  -- Só quando de_mim: 'sistema' (id do bot) | 'atendente' (humano). NULL quando
  -- é mensagem recebida — ou quando o encaminhador não soube decidir.
  origem                TEXT CHECK (origem IN ('sistema','atendente')),
  -- Em GRUPO, quem falou (participant). NULL em conversa individual.
  autor_jid             TEXT,
  push_name             TEXT,
  tipo                  TEXT NOT NULL DEFAULT 'outro'
                          CHECK (tipo IN ('texto','imagem','video','audio','documento','sticker','outro')),
  -- Texto da mensagem ou caption da mídia. CLARO (ver decisão no cabeçalho).
  texto                 TEXT,
  -- Objeto no bucket privado `documentos`, prefixo <tenant>/conversas-acervo/...
  -- O binário sobe DIRETO do VPS por URL assinada; aqui fica só o caminho.
  media_storage_path    TEXT,
  media_filename        TEXT,
  media_mimetype        TEXT,
  media_tamanho         INT,
  -- Mídia que EXISTE na conversa mas não pôde ser guardada (getBase64 falhou,
  -- excedeu o teto, path inválido...). Registrar a EXISTÊNCIA é o que impede o
  -- buraco silencioso que motivou este plano.
  media_pendente_motivo TEXT,
  -- Timestamp da mensagem no WhatsApp (não o da ingestão).
  timestamp_msg         TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- DEDUPE: o mesmo lote reenviado (retry do encaminhador) e o ECO da nossa
  -- própria mensagem que volta pelo webhook caem aqui. ON CONFLICT DO NOTHING.
  UNIQUE (tenant_id, instancia, mensagem_id)
);

ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS origem                TEXT;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS autor_jid             TEXT;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS push_name             TEXT;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS texto                 TEXT;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS media_storage_path    TEXT;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS media_filename        TEXT;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS media_mimetype        TEXT;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS media_tamanho         INT;
ALTER TABLE conversa_mensagens ADD COLUMN IF NOT EXISTS media_pendente_motivo TEXT;

-- Thread de uma conversa em ordem cronológica (leitura da tela / medidor).
CREATE INDEX IF NOT EXISTS idx_conversa_mensagens_thread
  ON conversa_mensagens (conversa_id, timestamp_msg);
-- Medidor de paridade e relatórios por dia dentro do tenant.
CREATE INDEX IF NOT EXISTS idx_conversa_mensagens_tenant_ts
  ON conversa_mensagens (tenant_id, timestamp_msg);

-- ------------------------------------------------------------
-- conversa_gaps — medidor de perda (nosso acervo × Chatwoot), por conversa/dia.
-- É a RÉGUA que diz quando a Etapa 4 (aposentar o Chatwoot) fica segura.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversa_gaps (
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dia            DATE NOT NULL,
  -- Chave estável da conversa no formato '<instancia>:<jid>' (ver
  -- conversaChave em src/lib/conversas-acervo/normalizar.ts). TEXT em vez de FK
  -- para o medidor poder registrar conversa que só existe de um dos lados.
  conversa_chave TEXT NOT NULL,
  nossas         INT NOT NULL DEFAULT 0,
  chatwoot       INT NOT NULL DEFAULT 0,
  -- Diagnóstico curto (ex.: 'so_no_chatwoot', 'midia_faltando'). LGPD: NUNCA o
  -- conteúdo das mensagens comparadas.
  detalhe        TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Re-rodar o medidor no mesmo dia/conversa ATUALIZA a linha (upsert).
  PRIMARY KEY (tenant_id, dia, conversa_chave)
);

ALTER TABLE conversa_gaps ADD COLUMN IF NOT EXISTS nossas   INT NOT NULL DEFAULT 0;
ALTER TABLE conversa_gaps ADD COLUMN IF NOT EXISTS chatwoot INT NOT NULL DEFAULT 0;
ALTER TABLE conversa_gaps ADD COLUMN IF NOT EXISTS detalhe  TEXT;

CREATE INDEX IF NOT EXISTS idx_conversa_gaps_dia ON conversa_gaps (tenant_id, dia DESC);

-- ------------------------------------------------------------
-- RLS SERVICE-ONLY: habilitada SEM policy → nenhum anon/authenticated lê ou
-- escreve. Só o service_role (que bypassa RLS) toca estas tabelas — a ingestão
-- e, na Etapa 2, as rotas de leitura autenticadas. Mesmo padrão de 066/068.
-- ------------------------------------------------------------
ALTER TABLE conversas_acervo   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversa_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversa_gaps      ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE conversas_acervo IS
  'Acervo próprio de conversas do WhatsApp: uma linha por (tenant, instancia, jid). Alimentada por POST /api/integracao/conversas/eventos. Service-only (RLS sem policy). Ver 082 e docs/PLANO-CONVERSAS-PROPRIAS-OPUS.md.';
COMMENT ON TABLE conversa_mensagens IS
  'Mensagens do acervo próprio. Dedupe por UNIQUE (tenant_id, instancia, mensagem_id) = key.id da Evolution → retry de lote e eco do webhook são idempotentes. Texto CLARO (acervo buscável); proteção = RLS service-only. Ver 082.';
COMMENT ON TABLE conversa_gaps IS
  'Medidor de paridade acervo próprio × Chatwoot por conversa/dia (régua da Etapa 4). LGPD: só contagens e um código em detalhe, nunca conteúdo. Ver 082.';
COMMENT ON COLUMN conversas_acervo.ultima_mensagem_em IS
  'Timestamp da mensagem mais recente ingerida. Só avança (evento fora de ordem não regride a conversa).';
COMMENT ON COLUMN conversa_mensagens.media_pendente_motivo IS
  'Código curto do motivo de a mídia não ter sido guardada (ex.: download_falhou, excede_teto, path_invalido). A mensagem fica registrada mesmo sem o binário.';
COMMENT ON COLUMN conversa_mensagens.origem IS
  'Só quando de_mim: sistema (bot) | atendente (humano). NULL em mensagem recebida.';
