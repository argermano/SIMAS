-- ============================================================
-- 060_documentos_cliente.sql
-- Documentos podem pertencer DIRETO ao cliente (aba Documentos do dossiê),
-- não só a um atendimento. Antes: documentos.atendimento_id NOT NULL (todo doc
-- preso a um caso). Agora: atendimento_id OU cliente_id (pelo menos um).
-- cliente_id já existia (012) só para busca; passa a ser a posse do doc no dossiê.
-- ============================================================

-- 1) Solta a obrigatoriedade do atendimento (docs diretos do dossiê não têm um).
ALTER TABLE documentos ALTER COLUMN atendimento_id DROP NOT NULL;

-- 2) cliente_id já existe (012) com ON DELETE SET NULL. Troca para CASCADE: um doc
--    direto (sem atendimento) viraria órfão e violaria o CHECK abaixo se o cliente
--    fosse apagado — deve sumir junto com o cliente. (Docs de caso continuam sendo
--    removidos pelo CASCADE do atendimento_id.)
ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_cliente_id_fkey;
ALTER TABLE documentos
  ADD CONSTRAINT documentos_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;

-- 3) Backfill: todo doc de atendimento herda o cliente do atendimento, para que a
--    listagem do dossiê por cliente_id enxergue TODOS os docs (diretos + de casos).
UPDATE documentos d
   SET cliente_id = a.cliente_id
  FROM atendimentos a
 WHERE d.atendimento_id = a.id
   AND d.cliente_id IS NULL;

-- 4) Todo doc precisa de um dono (um atendimento OU um cliente).
ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_dono_chk;
ALTER TABLE documentos
  ADD CONSTRAINT documentos_dono_chk
  CHECK (atendimento_id IS NOT NULL OR cliente_id IS NOT NULL);

-- 5) Índice para a listagem do dossiê (docs do cliente dentro do tenant).
CREATE INDEX IF NOT EXISTS idx_documentos_tenant_cliente
  ON documentos(tenant_id, cliente_id);

COMMENT ON COLUMN documentos.cliente_id IS
  'Dono do documento no dossiê. Preenchido para TODOS os docs (diretos + herdado do atendimento no backfill 060).';
COMMENT ON COLUMN documentos.atendimento_id IS
  'Atendimento de origem quando o doc nasceu num caso; NULL para docs anexados direto no dossiê do cliente (060). Serve de flag de origem.';
