-- ============================================================
-- 026_storage_tenant_isolation.sql
-- Endurece o isolamento multi-tenant do bucket 'documentos'.
--
-- Antes: qualquer usuário autenticado podia ler/inserir/apagar QUALQUER
-- objeto do bucket (policies com USING/WITH CHECK = bucket_id = 'documentos').
-- Agora: cada usuário só acessa objetos cujo primeiro segmento do path
-- (a "pasta" raiz) é o tenant_id dele. Todos os uploads do app já usam o
-- prefixo `${tenant_id}/...`, então não há impacto em arquivos existentes.
-- ============================================================

-- Remove as policies permissivas antigas
DROP POLICY IF EXISTS "Usuários autenticados podem fazer upload" ON storage.objects;
DROP POLICY IF EXISTS "Usuários autenticados podem ler"          ON storage.objects;
DROP POLICY IF EXISTS "Usuários autenticados podem deletar"      ON storage.objects;

-- Remove versões novas (idempotência em re-execução)
DROP POLICY IF EXISTS "documentos_tenant_select" ON storage.objects;
DROP POLICY IF EXISTS "documentos_tenant_insert" ON storage.objects;
DROP POLICY IF EXISTS "documentos_tenant_update" ON storage.objects;
DROP POLICY IF EXISTS "documentos_tenant_delete" ON storage.objects;

-- SELECT: só objetos do próprio tenant
CREATE POLICY "documentos_tenant_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documentos'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

-- INSERT: só dentro da pasta do próprio tenant
CREATE POLICY "documentos_tenant_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documentos'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

-- UPDATE: só objetos do próprio tenant (necessário p/ upsert)
CREATE POLICY "documentos_tenant_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documentos'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
)
WITH CHECK (
  bucket_id = 'documentos'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

-- DELETE: só objetos do próprio tenant
CREATE POLICY "documentos_tenant_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'documentos'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);
