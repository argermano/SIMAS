-- ============================================================================
-- Storage Cleanup — Supabase
-- Rode estas queries no SQL Editor do Supabase, na ordem indicada.
-- Cada bloco é independente. SEMPRE rode a versão SELECT antes do DELETE
-- para conferir o que vai ser removido.
-- ============================================================================


-- ─── 1. DIAGNÓSTICO: onde está o espaço? ─────────────────────────────────────

-- 1.1 Total e distribuição por tipo de arquivo no bucket "documentos"
SELECT
  CASE
    WHEN name ~* '/audio[_.]'        THEN 'audio_atendimento'
    WHEN name ~* '\.wav$|\.webm$'    THEN 'audio_outro'
    WHEN name LIKE '%/docs/%'        THEN 'documentos_cliente'
    WHEN name LIKE '%/modelos/%'     THEN 'modelos_documento'
    WHEN name LIKE '%/contratos/%'   THEN 'modelos_contrato'
    ELSE 'outros'
  END AS tipo,
  COUNT(*)                                                AS qtd_arquivos,
  pg_size_pretty(SUM((metadata->>'size')::bigint))        AS tamanho,
  ROUND(SUM((metadata->>'size')::bigint)/1024.0/1024, 1)  AS mb
FROM storage.objects
WHERE bucket_id = 'documentos'
GROUP BY 1
ORDER BY SUM((metadata->>'size')::bigint) DESC;


-- 1.2 Top 30 maiores arquivos individuais
SELECT
  name,
  pg_size_pretty((metadata->>'size')::bigint) AS tamanho,
  created_at
FROM storage.objects
WHERE bucket_id = 'documentos'
ORDER BY (metadata->>'size')::bigint DESC
LIMIT 30;


-- 1.3 Top tenants que mais consomem
SELECT
  SPLIT_PART(name, '/', 1) AS tenant_id,
  COUNT(*)                                         AS qtd,
  pg_size_pretty(SUM((metadata->>'size')::bigint)) AS tamanho
FROM storage.objects
WHERE bucket_id = 'documentos'
GROUP BY 1
ORDER BY SUM((metadata->>'size')::bigint) DESC
LIMIT 10;


-- ─── 2. ÁUDIOS ÓRFÃOS (atendimento já deletado) ──────────────────────────────
-- Caminhos seguem o padrão: {tenant_id}/{atendimento_id}/audio*
-- Se o atendimento foi deletado, o áudio fica como lixo no Storage.

-- 2.1 PREVIEW — quantos e qual o ganho?
WITH paths AS (
  SELECT
    so.name,
    (so.metadata->>'size')::bigint AS bytes,
    SPLIT_PART(so.name, '/', 1)::uuid AS tenant_id,
    SPLIT_PART(so.name, '/', 2)::uuid AS atendimento_id
  FROM storage.objects so
  WHERE so.bucket_id = 'documentos'
    AND so.name ~* '/audio[_.]'
)
SELECT
  COUNT(*)                       AS arquivos_orfaos,
  pg_size_pretty(SUM(bytes))     AS espaco_a_liberar
FROM paths p
WHERE NOT EXISTS (
  SELECT 1 FROM atendimentos a WHERE a.id = p.atendimento_id
);

-- 2.2 LISTAR — ver os paths antes de deletar
WITH paths AS (
  SELECT
    so.name,
    (so.metadata->>'size')::bigint AS bytes,
    SPLIT_PART(so.name, '/', 2)::uuid AS atendimento_id
  FROM storage.objects so
  WHERE so.bucket_id = 'documentos'
    AND so.name ~* '/audio[_.]'
)
SELECT name, pg_size_pretty(bytes) AS tamanho
FROM paths p
WHERE NOT EXISTS (
  SELECT 1 FROM atendimentos a WHERE a.id = p.atendimento_id
)
ORDER BY bytes DESC;

-- 2.3 DELETAR — só rode depois de conferir 2.1 e 2.2!
-- DELETE FROM storage.objects so
-- WHERE so.bucket_id = 'documentos'
--   AND so.name ~* '/audio[_.]'
--   AND NOT EXISTS (
--     SELECT 1 FROM atendimentos a
--     WHERE a.id = SPLIT_PART(so.name, '/', 2)::uuid
--   );


-- ─── 3. DOCUMENTOS ÓRFÃOS (registro deletado do DB) ──────────────────────────
-- Caminhos: {tenant_id}/{atendimento_id}/docs/{ts}_{filename}

-- 3.1 PREVIEW
WITH orfaos AS (
  SELECT so.name, (so.metadata->>'size')::bigint AS bytes
  FROM storage.objects so
  WHERE so.bucket_id = 'documentos'
    AND so.name LIKE '%/docs/%'
    AND NOT EXISTS (
      SELECT 1 FROM documentos d WHERE d.file_url = so.name
    )
)
SELECT COUNT(*) AS arquivos_orfaos, pg_size_pretty(SUM(bytes)) AS espaco_a_liberar
FROM orfaos;

-- 3.2 DELETAR — descomente após conferir
-- DELETE FROM storage.objects so
-- WHERE so.bucket_id = 'documentos'
--   AND so.name LIKE '%/docs/%'
--   AND NOT EXISTS (
--     SELECT 1 FROM documentos d WHERE d.file_url = so.name
--   );


-- ─── 4. ÁUDIOS DE ATENDIMENTOS ANTIGOS (> 90 dias) ───────────────────────────
-- Mantém o atendimento e a transcrição, remove só o áudio.
-- ATENÇÃO: depois disso, não dá pra re-transcrever esse atendimento.

-- 4.1 PREVIEW
WITH antigos AS (
  SELECT
    so.name,
    (so.metadata->>'size')::bigint AS bytes
  FROM storage.objects so
  JOIN atendimentos a
    ON a.id = SPLIT_PART(so.name, '/', 2)::uuid
  WHERE so.bucket_id = 'documentos'
    AND so.name ~* '/audio[_.]'
    AND a.created_at < NOW() - INTERVAL '90 days'
)
SELECT COUNT(*) AS qtd, pg_size_pretty(SUM(bytes)) AS espaco
FROM antigos;

-- 4.2 LIMPAR audio_url nos atendimentos afetados (rodar JUNTO com 4.3)
-- UPDATE atendimentos
-- SET audio_url = NULL
-- WHERE created_at < NOW() - INTERVAL '90 days'
--   AND audio_url IS NOT NULL;

-- 4.3 DELETAR arquivos
-- DELETE FROM storage.objects so
-- USING atendimentos a
-- WHERE so.bucket_id = 'documentos'
--   AND so.name ~* '/audio[_.]'
--   AND a.id = SPLIT_PART(so.name, '/', 2)::uuid
--   AND a.created_at < NOW() - INTERVAL '90 days';


-- ─── 5. CHUNKS DE UPLOAD ANTIGOS (audio_upload_*) ────────────────────────────
-- Quando o usuário faz upload de áudio grande, o client divide em chunks WAV.
-- Esses chunks já foram transcritos e geralmente não precisam ser mantidos.

-- 5.1 PREVIEW
SELECT
  COUNT(*)                                         AS qtd_chunks,
  pg_size_pretty(SUM((metadata->>'size')::bigint)) AS tamanho
FROM storage.objects
WHERE bucket_id = 'documentos'
  AND name ~* 'audio_upload_.*chunk_';

-- 5.2 DELETAR todos chunks de upload mais antigos que 7 dias
-- DELETE FROM storage.objects
-- WHERE bucket_id = 'documentos'
--   AND name ~* 'audio_upload_.*chunk_'
--   AND created_at < NOW() - INTERVAL '7 days';


-- ─── 6. VERIFICAÇÃO FINAL ────────────────────────────────────────────────────
SELECT
  COUNT(*)                                         AS total_objetos,
  pg_size_pretty(SUM((metadata->>'size')::bigint)) AS total_bucket
FROM storage.objects
WHERE bucket_id = 'documentos';
