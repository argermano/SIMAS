#!/usr/bin/env node
// Cleanup com bypass do trigger protect_objects_delete.
// Sequência: DISABLE trigger → DELETEs → ENABLE trigger. Tudo em transação.
import pg from 'pg'

const DRY_RUN = process.env.DRY_RUN === '1'

const client = new pg.Client({
  host: process.env.PG_HOST,
  port: 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
})

function fmt(b) {
  const n = Number(b)
  if (n < 1024) return `${n} B`
  if (n < 1024**2) return `${(n/1024).toFixed(1)} KB`
  if (n < 1024**3) return `${(n/1024/1024).toFixed(1)} MB`
  return `${(n/1024/1024/1024).toFixed(2)} GB`
}

await client.connect()
console.log(`Modo: ${DRY_RUN ? 'DRY_RUN' : 'EXECUÇÃO REAL'}\n`)

const ANTES = (await client.query(`
  SELECT COALESCE(SUM((metadata->>'size')::bigint), 0)::bigint AS bytes, COUNT(*)::int AS qtd
  FROM storage.objects WHERE bucket_id = 'documentos'
`)).rows[0]
console.log(`▼ ANTES: ${ANTES.qtd} arquivos / ${fmt(ANTES.bytes)}\n`)

// Mostra o que vai ser deletado
const chunks = (await client.query(`
  SELECT COUNT(*)::int AS qtd, COALESCE(SUM((metadata->>'size')::bigint), 0)::bigint AS bytes
  FROM storage.objects
  WHERE bucket_id = 'documentos' AND name ~* 'audio_upload_.*chunk_'
`)).rows[0]
const orfA = (await client.query(`
  SELECT COUNT(*)::int AS qtd, COALESCE(SUM((metadata->>'size')::bigint), 0)::bigint AS bytes
  FROM storage.objects so
  WHERE so.bucket_id = 'documentos'
    AND (so.name ~* '/audio[_.]' OR so.name ~* '\\.wav$|\\.webm$')
    AND NOT EXISTS (SELECT 1 FROM atendimentos a WHERE a.id::text = SPLIT_PART(so.name, '/', 2))
`)).rows[0]
const orfD = (await client.query(`
  SELECT COUNT(*)::int AS qtd, COALESCE(SUM((metadata->>'size')::bigint), 0)::bigint AS bytes
  FROM storage.objects so
  WHERE so.bucket_id = 'documentos' AND so.name LIKE '%/docs/%'
    AND NOT EXISTS (SELECT 1 FROM documentos d WHERE d.file_url = so.name)
`)).rows[0]

console.log(`[1] Chunks WAV          : ${chunks.qtd} arq. / ${fmt(chunks.bytes)}`)
console.log(`[2] Áudios órfãos       : ${orfA.qtd} arq. / ${fmt(orfA.bytes)}`)
console.log(`[3] Documentos órfãos   : ${orfD.qtd} arq. / ${fmt(orfD.bytes)}`)
console.log(`    TOTAL               : ${chunks.qtd + orfA.qtd + orfD.qtd} arq. / ${fmt(Number(chunks.bytes) + Number(orfA.bytes) + Number(orfD.bytes))}\n`)

if (DRY_RUN) {
  console.log('[DRY_RUN] Saindo sem deletar.')
  await client.end()
  process.exit(0)
}

await client.query('BEGIN')
try {
  console.log('→ SET storage.allow_delete_query = true (bypass oficial do trigger)')
  await client.query(`SET LOCAL "storage.allow_delete_query" = 'true'`)

  console.log('→ DELETE chunks WAV')
  const d1 = await client.query(`
    DELETE FROM storage.objects
    WHERE bucket_id = 'documentos' AND name ~* 'audio_upload_.*chunk_'
  `)
  console.log(`   ${d1.rowCount} linhas`)

  console.log('→ DELETE áudios órfãos')
  const d2 = await client.query(`
    DELETE FROM storage.objects so
    WHERE so.bucket_id = 'documentos'
      AND (so.name ~* '/audio[_.]' OR so.name ~* '\\.wav$|\\.webm$')
      AND NOT EXISTS (SELECT 1 FROM atendimentos a WHERE a.id::text = SPLIT_PART(so.name, '/', 2))
  `)
  console.log(`   ${d2.rowCount} linhas`)

  console.log('→ DELETE documentos órfãos')
  const d3 = await client.query(`
    DELETE FROM storage.objects so
    WHERE so.bucket_id = 'documentos' AND so.name LIKE '%/docs/%'
      AND NOT EXISTS (SELECT 1 FROM documentos d WHERE d.file_url = so.name)
  `)
  console.log(`   ${d3.rowCount} linhas`)

  await client.query('COMMIT')
  console.log('\nCOMMIT OK. (SET LOCAL expira automaticamente)')
} catch (err) {
  console.error(`\nERRO: ${err.message}`)
  await client.query('ROLLBACK')
  await client.end()
  process.exit(1)
}

const DEPOIS = (await client.query(`
  SELECT COALESCE(SUM((metadata->>'size')::bigint), 0)::bigint AS bytes, COUNT(*)::int AS qtd
  FROM storage.objects WHERE bucket_id = 'documentos'
`)).rows[0]
console.log(`\n▼ DEPOIS: ${DEPOIS.qtd} arquivos / ${fmt(DEPOIS.bytes)}`)
console.log(`▼ LIBERADO: ${fmt(Number(ANTES.bytes) - Number(DEPOIS.bytes))}`)

await client.end()
