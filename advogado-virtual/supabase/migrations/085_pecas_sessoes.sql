-- ============================================================
-- 085_pecas_sessoes.sql — Fundação de dados do MOTOR V3 ("Sessão de Lapidação"),
-- §5 de docs/PLANO-MOTOR-V3-OPUS.md. Pacote F0.1: só o MODELO DE DADOS — nenhuma
-- rota/UI usa estas tabelas ainda (F0.2/F0.3/F0.4).
--
-- A ideia: a peça continua sendo a verdade em pecas.conteudo_markdown +
-- pecas_versoes. A SESSÃO é a conversa de lapidação em volta dela — o agente
-- PROPÕE um patch por seção, o advogado ACEITA, e só então nasce uma versão
-- nova. Nada aqui grava a peça sozinho.
--
-- Seis tabelas novas:
--  • pecas_sessoes          — uma sessão de lapidação por peça (pode haver várias).
--  • pecas_turnos           — o histórico da conversa (instrução, resposta, ferramenta...).
--  • pecas_propostas        — o patch por seção que aguarda o aceite do advogado.
--  • pecas_sessoes_anexos   — documentos do dossiê montados na sessão.
--  • pecas_sessoes_eventos  — ledger idempotente de eventos do driver (reconexão do SSE).
--  • documentos_paginas     — texto por PÁGINA (paginação de verdade na leitura).
-- Mais ALTERs aditivos em documentos, pecas_versoes, api_usage_log, tenants e users.
--
-- RLS (duas políticas diferentes, de propósito):
--  • Tabelas de SESSÃO: RLS habilitada SEM policy → nenhum anon/authenticated lê
--    ou escreve; só o service_role (que bypassa RLS). Mesmo padrão de
--    conversas_acervo (082). As rotas da sessão vão usar o cliente admin e
--    conferir o tenant NO CÓDIGO (a peça já é tenant-scoped).
--  • documentos_paginas: policy por tenant "via documento", no padrão de
--    pecas_versoes na 005 — é extensão do texto do documento, não da sessão.
--
-- Idempotente: CREATE/ALTER explícitos (lição da 066/068/082). NÃO aplicar à
-- mão — o orquestrador aplica antes do deploy.
-- ============================================================

-- ------------------------------------------------------------
-- pecas_sessoes — a sessão de lapidação de UMA peça.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pecas_sessoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- tenant_id é DENORMALIZADO (a peça já tem o dele) para o medidor conseguir
  -- somar custo por tenant/mês sem join, e para a RLS futura ser direta.
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  peca_id          UUID NOT NULL REFERENCES pecas(id) ON DELETE CASCADE,
  -- Qual implementação do SessaoDriver conduz a sessão: 'messages' (Fase 0, uma
  -- request de streaming por rodada) ou 'managed' (Fase 1, Managed Agents).
  driver           TEXT NOT NULL DEFAULT 'messages'
                     CHECK (driver IN ('messages','managed')),
  -- Modelo FIXO por sessão: trocar no meio invalida todo o cache de prompt.
  modelo           TEXT NOT NULL,
  -- Nível de esforço (low|medium|high|xhigh|max). TEXT SEM CHECK de propósito:
  -- a Anthropic acrescenta níveis novos (xhigh entrou depois) e um CHECK aqui
  -- exigiria migration só para aceitar um valor novo.
  effort           TEXT,
  -- Só no driver 'managed': agente versionado e sessão do lado da Anthropic.
  agent_id         TEXT,
  agent_version    TEXT,
  session_id       TEXT UNIQUE,
  status           TEXT NOT NULL DEFAULT 'ativa'
                     CHECK (status IN ('ativa','aguardando_acao','pausada_orcamento','encerrada','erro')),
  -- Teto de gasto da sessão em USD de custo de LISTA. Ao bater, a sessão PAUSA
  -- (status pausada_orcamento) — nunca corta no meio de uma rodada.
  orcamento_usd    NUMERIC(10,4),
  custo_lista_usd  NUMERIC(12,6) NOT NULL DEFAULT 0,
  -- Acumulado de tokens da sessão: {input, output, cache_read, cache_write}.
  tokens           JSONB NOT NULL DEFAULT '{}',
  -- Cursor do ledger de eventos (retomada do SSE sem reprocessar o que já veio).
  ultimo_evento_id TEXT,
  -- Versão da peça no instante em que a sessão começou (base do "a peça mudou").
  versao_inicial   INT,
  criada_por       UUID REFERENCES users(id) ON DELETE SET NULL,
  criada_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizada_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  encerrada_em     TIMESTAMPTZ
);

ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS driver           TEXT;
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS modelo           TEXT;
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS effort           TEXT;
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS agent_id         TEXT;
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS agent_version    TEXT;
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS session_id       TEXT;
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS orcamento_usd    NUMERIC(10,4);
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS custo_lista_usd  NUMERIC(12,6) NOT NULL DEFAULT 0;
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS tokens           JSONB NOT NULL DEFAULT '{}';
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS ultimo_evento_id TEXT;
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS versao_inicial   INT;
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS criada_por       UUID;
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS atualizada_em    TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE pecas_sessoes ADD COLUMN IF NOT EXISTS encerrada_em     TIMESTAMPTZ;

-- Sessões de uma peça, mais recente primeiro (lista "retomar sessão").
CREATE INDEX IF NOT EXISTS idx_pecas_sessoes_peca
  ON pecas_sessoes (peca_id, criada_em DESC);
-- Custo/uso por tenant no mês (medidor e teto mensal).
CREATE INDEX IF NOT EXISTS idx_pecas_sessoes_tenant
  ON pecas_sessoes (tenant_id, criada_em DESC);
-- Varredura do cron de pendências: só as sessões que ainda podem exigir ação.
CREATE INDEX IF NOT EXISTS idx_pecas_sessoes_pendentes
  ON pecas_sessoes (status, atualizada_em)
  WHERE status IN ('ativa','aguardando_acao');

-- ------------------------------------------------------------
-- pecas_turnos — o histórico da conversa da sessão.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pecas_turnos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id         UUID NOT NULL REFERENCES pecas_sessoes(id) ON DELETE CASCADE,
  numero            INT NOT NULL,
  papel             TEXT NOT NULL CHECK (papel IN ('advogado','agente','sistema')),
  tipo              TEXT NOT NULL
                      CHECK (tipo IN ('instrucao','resposta','proposta','ferramenta','anexo','custo','erro')),
  -- Texto exibido no painel. LGPD: é conteúdo do caso — protegido pela RLS
  -- service-only (mesma decisão do acervo de conversas, 082).
  conteudo          TEXT,
  -- Estruturado do turno (args/resultado de ferramenta, ids de anexo, etc.).
  payload           JSONB,
  -- Versão da peça que este turno produziu (só quando houve aceite).
  versao_resultante INT,
  -- FK adicionada mais abaixo: pecas_propostas ainda não existe neste ponto.
  proposta_id       UUID,
  custo_usd         NUMERIC(12,6) NOT NULL DEFAULT 0,
  tokens            JSONB NOT NULL DEFAULT '{}',
  criado_por        UUID REFERENCES users(id) ON DELETE SET NULL,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Numeração estável dentro da sessão (e dedupe de reenvio da mesma rodada).
  UNIQUE (sessao_id, numero)
);

ALTER TABLE pecas_turnos ADD COLUMN IF NOT EXISTS conteudo          TEXT;
ALTER TABLE pecas_turnos ADD COLUMN IF NOT EXISTS payload           JSONB;
ALTER TABLE pecas_turnos ADD COLUMN IF NOT EXISTS versao_resultante INT;
ALTER TABLE pecas_turnos ADD COLUMN IF NOT EXISTS proposta_id       UUID;
ALTER TABLE pecas_turnos ADD COLUMN IF NOT EXISTS custo_usd         NUMERIC(12,6) NOT NULL DEFAULT 0;
ALTER TABLE pecas_turnos ADD COLUMN IF NOT EXISTS tokens            JSONB NOT NULL DEFAULT '{}';
ALTER TABLE pecas_turnos ADD COLUMN IF NOT EXISTS criado_por        UUID;

CREATE INDEX IF NOT EXISTS idx_pecas_turnos_sessao
  ON pecas_turnos (sessao_id, numero);

-- ------------------------------------------------------------
-- pecas_propostas — o patch por SEÇÃO que o agente propôs.
-- `patch` é um array de objetos:
--   [{ titulo, acao: substituir|inserir_apos|remover|inserir_inicio,
--      conteudo_markdown, motivo }]
-- `decisoes` guarda o que o advogado aceitou/rejeitou seção a seção.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pecas_propostas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id         UUID NOT NULL REFERENCES pecas_sessoes(id) ON DELETE CASCADE,
  turno_id          UUID REFERENCES pecas_turnos(id) ON DELETE SET NULL,
  -- Versão da peça sobre a qual o patch foi calculado. Se a peça avançou desde
  -- então (edição manual no editor), a UI avisa "a peça mudou" antes de aplicar.
  versao_base       INT,
  resumo            TEXT,
  patch             JSONB NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','aceita','parcial','rejeitada','expirada')),
  decisoes          JSONB,
  versao_resultante INT,
  decidido_por      UUID REFERENCES users(id) ON DELETE SET NULL,
  decidido_at       TIMESTAMPTZ,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pecas_propostas ADD COLUMN IF NOT EXISTS turno_id          UUID;
ALTER TABLE pecas_propostas ADD COLUMN IF NOT EXISTS versao_base       INT;
ALTER TABLE pecas_propostas ADD COLUMN IF NOT EXISTS resumo            TEXT;
ALTER TABLE pecas_propostas ADD COLUMN IF NOT EXISTS patch             JSONB NOT NULL DEFAULT '[]';
ALTER TABLE pecas_propostas ADD COLUMN IF NOT EXISTS decisoes          JSONB;
ALTER TABLE pecas_propostas ADD COLUMN IF NOT EXISTS versao_resultante INT;
ALTER TABLE pecas_propostas ADD COLUMN IF NOT EXISTS decidido_por      UUID;
ALTER TABLE pecas_propostas ADD COLUMN IF NOT EXISTS decidido_at       TIMESTAMPTZ;

-- Propostas pendentes de uma sessão (o que a UI mostra ao reabrir).
CREATE INDEX IF NOT EXISTS idx_pecas_propostas_sessao
  ON pecas_propostas (sessao_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pecas_propostas_pendentes
  ON pecas_propostas (sessao_id) WHERE status = 'pendente';

-- Fecha o ciclo turno ↔ proposta (só depois das duas tabelas existirem).
-- DROP + ADD explícitos = idempotente (padrão da 028).
ALTER TABLE pecas_turnos DROP CONSTRAINT IF EXISTS pecas_turnos_proposta_id_fkey;
ALTER TABLE pecas_turnos ADD  CONSTRAINT pecas_turnos_proposta_id_fkey
  FOREIGN KEY (proposta_id) REFERENCES pecas_propostas(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- pecas_sessoes_anexos — documentos do dossiê disponíveis para a sessão.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pecas_sessoes_anexos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id         UUID NOT NULL REFERENCES pecas_sessoes(id) ON DELETE CASCADE,
  documento_id      UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  -- Id do arquivo na Files API da Anthropic (sobe 1×, referencia N×).
  anthropic_file_id TEXT,
  -- Caminho do arquivo montado no container da sessão (driver 'managed').
  mount_path        TEXT,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Anexar o mesmo documento duas vezes é no-op (ON CONFLICT DO NOTHING).
  UNIQUE (sessao_id, documento_id)
);

ALTER TABLE pecas_sessoes_anexos ADD COLUMN IF NOT EXISTS anthropic_file_id TEXT;
ALTER TABLE pecas_sessoes_anexos ADD COLUMN IF NOT EXISTS mount_path        TEXT;

CREATE INDEX IF NOT EXISTS idx_pecas_sessoes_anexos_sessao
  ON pecas_sessoes_anexos (sessao_id);

-- ------------------------------------------------------------
-- pecas_sessoes_eventos — LEDGER IDEMPOTENTE dos eventos do driver.
-- O proxy de SSE da Vercel morre aos ~300s e o cliente reconecta pedindo os
-- eventos desde ultimo_evento_id; o mesmo evento chega mais de uma vez. O
-- UNIQUE abaixo é o que torna reprocessar um lote SEMPRE seguro.
-- (evento_id é único DENTRO da sessão — fora dela não significa nada.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pecas_sessoes_eventos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id  UUID NOT NULL REFERENCES pecas_sessoes(id) ON DELETE CASCADE,
  evento_id  TEXT NOT NULL,
  tipo       TEXT,
  payload    JSONB,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sessao_id, evento_id)
);

ALTER TABLE pecas_sessoes_eventos ADD COLUMN IF NOT EXISTS tipo    TEXT;
ALTER TABLE pecas_sessoes_eventos ADD COLUMN IF NOT EXISTS payload JSONB;

CREATE INDEX IF NOT EXISTS idx_pecas_sessoes_eventos_sessao
  ON pecas_sessoes_eventos (sessao_id, criado_em);

-- ------------------------------------------------------------
-- documentos_paginas — texto extraído PÁGINA A PÁGINA.
-- Sem isto, "ler as páginas 40 a 60 da ficha" só existe como recorte de string
-- do texto inteiro (que já vem truncado). Alimentada pelo OCR em lote (Haiku).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documentos_paginas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  pagina       INT NOT NULL,
  texto        TEXT,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Re-extrair a mesma página ATUALIZA a linha (upsert), não duplica.
  UNIQUE (documento_id, pagina)
);

ALTER TABLE documentos_paginas ADD COLUMN IF NOT EXISTS texto TEXT;

CREATE INDEX IF NOT EXISTS idx_documentos_paginas_doc
  ON documentos_paginas (documento_id, pagina);

-- ============================================================
-- ALTERs aditivos nas tabelas existentes
-- ============================================================

-- documentos: o dossiê como RECURSO da sessão (Files API) + resumo/paginação.
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS anthropic_file_id TEXT;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS anthropic_file_at TIMESTAMPTZ;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS resumo_ia         TEXT;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS paginas           INT;

-- pecas_versoes: de onde veio a versão. 'manual' cobre TODAS as linhas antigas
-- (o DEFAULT preenche o histórico) — sessão/refino/correção só a partir daqui.
ALTER TABLE pecas_versoes ADD COLUMN IF NOT EXISTS origem    TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE pecas_versoes ADD COLUMN IF NOT EXISTS sessao_id UUID;
ALTER TABLE pecas_versoes ADD COLUMN IF NOT EXISTS turno_id  UUID;
-- A instrução do advogado que gerou esta versão (rastro do "porquê").
ALTER TABLE pecas_versoes ADD COLUMN IF NOT EXISTS instrucao TEXT;

ALTER TABLE pecas_versoes DROP CONSTRAINT IF EXISTS pecas_versoes_origem_check;
ALTER TABLE pecas_versoes ADD  CONSTRAINT pecas_versoes_origem_check
  CHECK (origem IN ('manual','sessao','correcao','refino'));

ALTER TABLE pecas_versoes DROP CONSTRAINT IF EXISTS pecas_versoes_sessao_id_fkey;
ALTER TABLE pecas_versoes ADD  CONSTRAINT pecas_versoes_sessao_id_fkey
  FOREIGN KEY (sessao_id) REFERENCES pecas_sessoes(id) ON DELETE SET NULL;
ALTER TABLE pecas_versoes DROP CONSTRAINT IF EXISTS pecas_versoes_turno_id_fkey;
ALTER TABLE pecas_versoes ADD  CONSTRAINT pecas_versoes_turno_id_fkey
  FOREIGN KEY (turno_id) REFERENCES pecas_turnos(id) ON DELETE SET NULL;

-- api_usage_log: o medidor passa a enxergar cache e sessão.
-- NOT NULL DEFAULT 0 (e não só DEFAULT): contagem nula viraria NULL na soma do
-- dashboard e zeraria a coluna de custo inteira.
ALTER TABLE api_usage_log ADD COLUMN IF NOT EXISTS tokens_cache_read  INT NOT NULL DEFAULT 0;
ALTER TABLE api_usage_log ADD COLUMN IF NOT EXISTS tokens_cache_write INT NOT NULL DEFAULT 0;
ALTER TABLE api_usage_log ADD COLUMN IF NOT EXISTS sessao_id          UUID;
ALTER TABLE api_usage_log ADD COLUMN IF NOT EXISTS turno_id           UUID;
ALTER TABLE api_usage_log ADD COLUMN IF NOT EXISTS origem             TEXT NOT NULL DEFAULT 'messages';

ALTER TABLE api_usage_log DROP CONSTRAINT IF EXISTS api_usage_log_sessao_id_fkey;
ALTER TABLE api_usage_log ADD  CONSTRAINT api_usage_log_sessao_id_fkey
  FOREIGN KEY (sessao_id) REFERENCES pecas_sessoes(id) ON DELETE SET NULL;
ALTER TABLE api_usage_log DROP CONSTRAINT IF EXISTS api_usage_log_turno_id_fkey;
ALTER TABLE api_usage_log ADD  CONSTRAINT api_usage_log_turno_id_fkey
  FOREIGN KEY (turno_id) REFERENCES pecas_turnos(id) ON DELETE SET NULL;

-- Custo por sessão (BarraCusto e teto por sessão).
CREATE INDEX IF NOT EXISTS idx_api_usage_sessao
  ON api_usage_log (sessao_id, created_at) WHERE sessao_id IS NOT NULL;

-- tenants: parâmetros comerciais da IA por escritório.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ia_config JSONB NOT NULL DEFAULT '{}';

-- users: administrador da PLATAFORMA (cross-tenant), diferente do admin do
-- escritório (users.role='admin'). Usado no painel interno da Fase 3.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- A policy "users: gerenciar próprio" (005) é FOR ALL sobre a própria linha —
-- sem a trava abaixo, qualquer usuário autenticado poderia se promover a
-- administrador da plataforma editando o próprio registro. O trigger só deixa
-- a flag mudar quando NÃO há usuário autenticado no JWT (service_role/scripts).
CREATE OR REPLACE FUNCTION protege_is_platform_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.is_platform_admin := false;
  ELSIF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
    NEW.is_platform_admin := OLD.is_platform_admin;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS users_protege_is_platform_admin ON users;
CREATE TRIGGER users_protege_is_platform_admin
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION protege_is_platform_admin();

-- ============================================================
-- RLS
-- ============================================================

-- Tabelas de SESSÃO: RLS habilitada SEM policy → só o service_role passa.
ALTER TABLE pecas_sessoes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pecas_turnos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pecas_propostas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pecas_sessoes_anexos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pecas_sessoes_eventos  ENABLE ROW LEVEL SECURITY;

-- documentos_paginas: isolamento por tenant "via documento" (padrão da 005).
ALTER TABLE documentos_paginas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "documentos_paginas: via documento" ON documentos_paginas;
CREATE POLICY "documentos_paginas: via documento" ON documentos_paginas
  FOR ALL USING (
    documento_id IN (
      SELECT id FROM documentos WHERE tenant_id = get_user_tenant_id()
    )
  );

-- ============================================================
-- Comentários (documentação viva no banco)
-- ============================================================

COMMENT ON TABLE pecas_sessoes IS
  'Sessão de lapidação de uma peça (Motor v3, §5 de docs/PLANO-MOTOR-V3-OPUS.md). Modelo FIXO por sessão (trocar invalida o cache de prompt). Service-only (RLS sem policy). Ver 085.';
COMMENT ON TABLE pecas_turnos IS
  'Histórico da conversa de uma sessão de lapidação (instrução do advogado, resposta do agente, ferramenta, anexo, custo, erro). UNIQUE (sessao_id, numero). Service-only. Ver 085.';
COMMENT ON TABLE pecas_propostas IS
  'Patch por seção proposto pelo agente, aguardando aceite do advogado (ComparadorSecoes). A peça só vira versão nova DEPOIS do aceite. Service-only. Ver 085.';
COMMENT ON TABLE pecas_sessoes_anexos IS
  'Documentos do dossiê disponíveis para a sessão (Files API / mount no container). UNIQUE (sessao_id, documento_id) = anexar de novo é no-op. Service-only. Ver 085.';
COMMENT ON TABLE pecas_sessoes_eventos IS
  'Ledger idempotente de eventos do driver: UNIQUE (sessao_id, evento_id) torna a reconexão do SSE e o reprocessamento de lote sempre seguros. Service-only. Ver 085.';
COMMENT ON TABLE documentos_paginas IS
  'Texto extraído por PÁGINA de um documento — base da leitura paginada (ler_documento(id, pag_ini, pag_fim)). RLS por tenant via documentos. Ver 085.';

COMMENT ON COLUMN pecas_sessoes.driver IS
  'messages (Fase 0: 1 request de streaming por rodada) | managed (Fase 1: Managed Agents).';
COMMENT ON COLUMN pecas_sessoes.effort IS
  'Nível de esforço do modelo (low|medium|high|xhigh|max). Sem CHECK: a Anthropic acrescenta níveis novos.';
COMMENT ON COLUMN pecas_sessoes.orcamento_usd IS
  'Teto de custo de LISTA da sessão em USD. Ao bater, a sessão pausa (pausada_orcamento) — nunca corta no meio da rodada.';
COMMENT ON COLUMN pecas_sessoes.tokens IS
  'Acumulado da sessão: {input, output, cache_read, cache_write}.';
COMMENT ON COLUMN pecas_sessoes.ultimo_evento_id IS
  'Cursor do ledger: de onde o stream retoma após uma reconexão.';
COMMENT ON COLUMN pecas_propostas.patch IS
  'Array [{titulo, acao: substituir|inserir_apos|remover|inserir_inicio, conteudo_markdown, motivo}].';
COMMENT ON COLUMN pecas_propostas.versao_base IS
  'Versão da peça sobre a qual o patch foi calculado — se a peça avançou, a UI avisa antes de aplicar.';
COMMENT ON COLUMN pecas_versoes.origem IS
  'manual (edição no editor; default do histórico) | sessao | correcao | refino.';
COMMENT ON COLUMN pecas_versoes.instrucao IS
  'Instrução do advogado que originou esta versão (rastro do porquê da mudança).';
COMMENT ON COLUMN api_usage_log.tokens_cache_read IS
  'cache_read_input_tokens da resposta — custa 0,1x o preço de input do modelo.';
COMMENT ON COLUMN api_usage_log.tokens_cache_write IS
  'cache_creation_input_tokens da resposta — custa 2x o preço de input no TTL de 1h.';
COMMENT ON COLUMN api_usage_log.origem IS
  'Driver/origem do custo: messages (default) | managed | transcricao.';
COMMENT ON COLUMN documentos.anthropic_file_id IS
  'Id do documento na Files API da Anthropic (sobe 1x, referencia N vezes).';
COMMENT ON COLUMN documentos.resumo_ia IS
  'Resumo curto gerado por Haiku para documentos grandes (>30k chars), usado no INDEX do dossiê.';
COMMENT ON COLUMN documentos.paginas IS
  'Número de páginas do documento (base da leitura paginada em documentos_paginas).';
COMMENT ON COLUMN tenants.ia_config IS
  'Parâmetros comerciais da IA do escritório: {orcamento_mensal_usd, teto_sessao_usd, usd_brl, markup, modelo_padrao, plano}.';
COMMENT ON COLUMN users.is_platform_admin IS
  'Administrador da PLATAFORMA (cross-tenant) — diferente de role=admin (admin do escritório). Só o service_role altera (trigger users_protege_is_platform_admin).';
