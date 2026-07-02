#!/usr/bin/env node
// Cleanup de storage.objects via Postgres direto.
// Roda 3 DELETEs em transação: chunks WAV + órfãos audio + órfãos docs.
// Uso: PG_HOST=... PG_USER=... PG_PASSWORD=... [DRY_RUN=1] node scripts/cleanup-storage.mjs

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
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024**2) return `${(n/1024).toFixed(1)} KB`
  if (n < 1024**3) return `${(n/1024/1024).toFixed(1)} MB`
  return `${(n/1024/1024/1024).toFixed(2)} GB`
}

async function totalStorage() {
  const { rows } = await client.query(`
    SELECT COALESCE(SUM((metadata->>'size')::bigint), 0) AS bytes,
           COUNT(*) AS qtd
    FROM storage.objects WHERE bucket_id = 'documentos'
  `)
  return rows[0]
}

await client.connect()
console.log(`Conectado. Modo: ${DRY_RUN ? 'DRY_RUN (sem deletar)' : 'EXECUÇÃO REAL'}\n`)

const antes = await totalStorage()
console.log(`▼ ANTES: ${antes.qtd} arquivos / ${fmt(antes.bytes)}\n`)

await client.query('BEGIN')

try {
  // ─── 1. Chunks WAV (audio_upload_*_chunk_*.wav) ────────────────────────
  const { rows: rChunks } = await client.query(`
    SELECT COUNT(*) AS qtd, COALESCE(SUM((metadata->>'size')::bigint), 0) AS bytes
    FROM storage.objects
    WHERE bucket_id = 'documentos'
      AND name ~* 'audio_upload_.*chunk_'
  `)
  console.log(`[1/3] Chunks WAV: ${rChunks[0].qtd} arq. / ${fmt(rChunks[0].bytes)}`)
  if (!DRY_RUN) {
    const del = await client.query(`
      DELETE FROM storage.objects
      WHERE bucket_id = 'documentos'
        AND name ~* 'audio_upload_.*chunk_'
    `)
    console.log(`      → DELETE: ${del.rowCount} linhas removidas`)
  }

  // ─── 2. Áudios órfãos (atendimento não existe) ─────────────────────────
  const { rows: rOrfA } = await client.query(`
    WITH paths AS (
      SELECT name, (metadata->>'size')::bigint AS bytes,
             SPLIT_PART(name, '/', 2) AS at_id
      FROM storage.objects
      WHERE bucket_id = 'documentos'
        AND (name ~* '/audio[_.]' OR name ~* '\\.wav$|\\.webm$')
    )
    SELECT COUNT(*) AS qtd, COALESCE(SUM(bytes), 0) AS bytes
    FROM paths p
    WHERE NOT EXISTS (SELECT 1 FROM atendimentos a WHERE a.id::text = p.at_id)
  `)
  console.log(`[2/3] Áudios órfãos: ${rOrfA[0].qtd} arq. / ${fmt(rOrfA[0].bytes)}`)
  if (!DRY_RUN) {
    const del = await client.query(`
      DELETE FROM storage.objects so
      WHERE so.bucket_id = 'documentos'
        AND (so.name ~* '/audio[_.]' OR so.name ~* '\\.wav$|\\.webm$')
        AND NOT EXISTS (
          SELECT 1 FROM atendimentos a
          WHERE a.id::text = SPLIT_PART(so.name, '/', 2)
        )
    `)
    console.log(`      → DELETE: ${del.rowCount} linhas removidas`)
  }

  // ─── 3. Documentos órfãos (file_url sem registro) ──────────────────────
  const { rows: rOrfD } = await client.query(`
    SELECT COUNT(*) AS qtd, COALESCE(SUM((so.metadata->>'size')::bigint), 0) AS bytes
    FROM storage.objects so
    WHERE so.bucket_id = 'documentos'
      AND so.name LIKE '%/docs/%'
      AND NOT EXISTS (SELECT 1 FROM documentos d WHERE d.file_url = so.name)
  `)
  console.log(`[3/3] Documentos órfãos: ${rOrfD[0].qtd} arq. / ${fmt(rOrfD[0].bytes)}`)
  if (!DRY_RUN) {
    const del = await client.query(`
      DELETE FROM storage.objects so
      WHERE so.bucket_id = 'documentos'
        AND so.name LIKE '%/docs/%'
        AND NOT EXISTS (SELECT 1 FROM documentos d WHERE d.file_url = so.name)
    `)
    console.log(`      → DELETE: ${del.rowCount} linhas removidas`)
  }

  if (DRY_RUN) {
    await client.query('ROLLBACK')
    console.log('\n[DRY_RUN] Transação revertida (nenhum DELETE persistido).')
  } else {
    await client.query('COMMIT')
    console.log('\nCOMMIT OK.')
  }
} catch (err) {
  await client.query('ROLLBACK')
  console.error('\nERRO — rollback:', err.message)
  await client.end()
  process.exit(1)
}

const depois = await totalStorage()
console.log(`\n▼ DEPOIS: ${depois.qtd} arquivos / ${fmt(depois.bytes)}`)
console.log(`▼ LIBERADO: ${fmt(Number(antes.bytes) - Number(depois.bytes))}`)

await client.end()
