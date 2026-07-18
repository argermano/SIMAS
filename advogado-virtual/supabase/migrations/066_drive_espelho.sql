-- ============================================================
-- 066_drive_espelho.sql — espelho do dossiê no Google Drive (Fundação)
-- O dono quer REPLICAR a árvore de documentos do SIMAS no Google Drive do
-- escritório. Decisões: SIMAS = fonte da verdade; Drive = espelho SÓ de ida
-- (mexer no Drive não volta); sem retroativo (lazy — só clientes com atividade
-- daqui em diante). Ver src/lib/drive/{auth,api,espelho}.ts.
--
-- Duas tabelas de BOOKKEEPING internas (nenhuma UI lê):
--  • drive_espelho: mapeia cada nó lógico do SIMAS (cliente/pasta/arquivo/atalho)
--    ao seu id no Drive — é o que torna a reconciliação IDEMPOTENTE (consulta
--    aqui antes de criar) e permite renomear/lixeira sem recriar.
--  • drive_sync_fila: clientes a espelhar (dedup natural pela PK cliente_id) —
--    a Fase 2 (gatilhos) enfileira; um drenador chama espelharCliente.
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS drive_espelho (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Tipo do nó espelhado. cliente = pasta do cliente sob a RAIZ; subraiz =
  -- containers fixos (Gerais/Casos/Processos); pasta_caso/pasta_processo = uma
  -- pasta por caso/processo; arquivo = arquivo real; atalho = shortcut nativo.
  tipo       TEXT NOT NULL CHECK (tipo IN
               ('cliente','subraiz','pasta_caso','pasta_processo','arquivo','atalho')),
  -- Id LÓGICO do nó no SIMAS (não é o id do Drive): cliente_id | '<cliente>:gerais'
  -- | '<cliente>:casos' | '<cliente>:processos' | atendimento_id | processo_id |
  -- documento_id | 'doc:<documento_id>:<ref_da_pasta>' (atalho). Estável → resgate.
  ref_id     TEXT NOT NULL,
  drive_id   TEXT NOT NULL,               -- id do arquivo/pasta/atalho no Google Drive
  -- Último nome espelhado — permite detectar rename (título do caso / file_name
  -- mudou) sem um GET no Drive a cada ciclo. NULL só em linhas antigas.
  nome       TEXT,
  -- id (no Drive) da PASTA PRIMÁRIA que hoje contém o arquivo/atalho — só para
  -- tipo 'arquivo' e 'atalho' (NULL nos demais). Permite detectar que a pasta
  -- primária desejada mudou (ex.: doc anexado em Gerais e depois organizado num
  -- caso) e RE-PARENTAR (moverArquivo) antes da limpeza, para o arquivo não
  -- encalhar na pasta antiga que iria para a lixeira. Ver espelho.ts.
  parent_drive_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Um nó lógico → no máximo um id de Drive por tenant (idempotência do resgate).
  UNIQUE (tenant_id, tipo, ref_id)
);

-- Reconciliação carrega o espelho por tenant (seed do cache + varredura de órfãos).
CREATE INDEX IF NOT EXISTS idx_drive_espelho_tenant ON drive_espelho (tenant_id);

DROP TRIGGER IF EXISTS drive_espelho_updated_at ON drive_espelho; -- idempotência (rerun)
CREATE TRIGGER drive_espelho_updated_at
  BEFORE UPDATE ON drive_espelho
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Fila de clientes a espelhar. PK = cliente_id → dedup natural (enfileirar o mesmo
-- cliente 2x é no-op via upsert). tenant_id acompanha p/ FK/limpeza.
CREATE TABLE IF NOT EXISTS drive_sync_fila (
  cliente_id     UUID PRIMARY KEY REFERENCES clientes(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enfileirado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- CLAIM do drenador: marca "em processamento" para que dois drenos concorrentes
  -- (cron na folga × botão "Sincronizar agora") não espelhem o MESMO cliente ao
  -- mesmo tempo — o que duplicaria pastas/arquivos no Drive (o resgate por
  -- appProperties não protege contra a corrida: ambos consultam antes de qualquer
  -- criar). O claim é um UPDATE condicional atômico (só um dreno vence). NULL =
  -- livre; um valor mais velho que a janela stale volta a ser elegível (dreno que
  -- morreu no meio). Ver processarFilaDrive em src/lib/drive/espelho.ts.
  processando_em TIMESTAMPTZ
);

-- Drenagem "mais antigo primeiro".
CREATE INDEX IF NOT EXISTS idx_drive_sync_fila_ordem ON drive_sync_fila (enfileirado_em);

-- RLS service-only: estas tabelas são BOOKKEEPING do motor de espelho, escritas
-- exclusivamente pelo service_role (que bypassa RLS). Habilitamos RLS SEM policy
-- permissiva → nenhum usuário anon/authenticated lê ou escreve (padrão das tabelas
-- puramente internas; contraste com 053, que tem policy porque a UI a consulta).
ALTER TABLE drive_espelho   ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_sync_fila ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE drive_espelho IS
  'Bookkeeping do espelho no Google Drive: mapeia nó lógico do SIMAS (tipo+ref_id) → id no Drive. Torna a reconciliação idempotente. Service-only (RLS sem policy). Ver 066 e src/lib/drive/espelho.ts.';
COMMENT ON TABLE drive_sync_fila IS
  'Fila de clientes a espelhar no Drive (dedup pela PK cliente_id). A Fase 2 enfileira; processarFilaDrive drena. Service-only. Ver 066.';
