#!/usr/bin/env node
// Diagnóstico via conexão Postgres direta (bypassa bloqueio de API).
// Uso: PG_HOST=... PG_USER=... PG_PASSWORD=... node scripts/diagnose-pg.mjs

import pg from 'pg'

const cfg = {
  host:     process.env.PG_HOST,
  port:     parseInt(process.env.PG_PORT || '5432', 10),
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE || 'postgres',
  ssl:      { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
}

if (!cfg.host || !cfg.user || !cfg.password) {
  console.error('Faltam variáveis: PG_HOST, PG_USER, PG_PASSWORD')
  process.exit(1)
}

const client = new pg.Client(cfg)

function fmtBytes(b) {
  const n = Number(b)
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024**2) return `${(n/1024).toFixed(1)} KB`
  if (n < 1024**3) return `${(n/1024/1024).toFixed(1)} MB`
  return `${(n/1024/1024/1024).toFixed(2)} GB`
}

async function q(label, sql) {
  console.log(`\n▼ ${label}`)
  try {
    const res = await client.query(sql)
    return res.rows
  } catch (err) {
    console.log(`  erro: ${err.message}`)
    return null
  }
}

async function main() {
  console.log(`Conectando em ${cfg.host}:${cfg.port} como ${cfg.user}...`)
  await client.connect()
  console.log('OK conectado.')

  // 1. Tamanho do banco
  let rows = await q('Tamanho do banco Postgres', `
    SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
           pg_database_size(current_database()) AS db_bytes
  `)
  if (rows) console.log('  ', rows[0])

  // 2. Total Storage por bucket
  rows = await q('Storage por bucket', `
    SELECT bucket_id,
           COUNT(*) AS qtd,
           pg_size_pretty(SUM((metadata->>'size')::bigint)) AS tamanho,
           SUM((metadata->>'size')::bigint) AS bytes
    FROM storage.objects
    GROUP BY bucket_id
    ORDER BY 4 DESC NULLS LAST
  `)
  if (rows) for (const r of rows) console.log(`   ${String(r.bucket_id).padEnd(18)} ${String(r.qtd).padStart(6)} arq.  ${r.tamanho}`)

  // 3. Storage por tipo
  rows = await q('Storage por tipo (bucket=documentos)', `
    SELECT
      CASE
        WHEN name ~* 'audio_upload_.*chunk_'  THEN 'audio_chunk_wav'
        WHEN name ~* '/audio[_.]'             THEN 'audio_atendimento'
        WHEN name ~* '\\.wav$|\\.webm$'         THEN 'audio_outro'
        WHEN name LIKE '%/docs/%'             THEN 'documentos_cliente'
        WHEN name LIKE '%/modelos/%'          THEN 'modelos_documento'
        WHEN name LIKE '%/contratos/%'        THEN 'modelos_contrato'
        ELSE 'outros'
      END AS tipo,
      COUNT(*) AS qtd,
      pg_size_pretty(SUM((metadata->>'size')::bigint)) AS tamanho
    FROM storage.objects
    WHERE bucket_id = 'documentos'
    GROUP BY 1
    ORDER BY SUM((metadata->>'size')::bigint) DESC NULLS LAST
  `)
  if (rows) for (const r of rows) console.log(`   ${String(r.tipo).padEnd(22)} ${String(r.qtd).padStart(6)} arq.  ${r.tamanho}`)

  // 4. Top 20 arquivos
  rows = await q('Top 20 maiores arquivos', `
    SELECT name, pg_size_pretty((metadata->>'size')::bigint) AS tamanho, created_at
    FROM storage.objects
    WHERE bucket_id = 'documentos'
    ORDER BY (metadata->>'size')::bigint DESC NULLS LAST
    LIMIT 20
  `)
  if (rows) for (const r of rows) console.log(`   ${String(r.tamanho).padStart(10)}  ${r.name}`)

  // 5. Top tenants
  rows = await q('Top 10 tenants consumidores', `
    SELECT SPLIT_PART(name, '/', 1) AS tenant_id,
           COUNT(*) AS qtd,
           pg_size_pretty(SUM((metadata->>'size')::bigint)) AS tamanho
    FROM storage.objects
    WHERE bucket_id = 'documentos'
    GROUP BY 1
    ORDER BY SUM((metadata->>'size')::bigint) DESC NULLS LAST
    LIMIT 10
  `)
  if (rows) for (const r of rows) console.log(`   ${String(r.tenant_id).padEnd(38)} ${String(r.qtd).padStart(6)} arq.  ${r.tamanho}`)

  // 6. Áudios órfãos
  rows = await q('Áudios órfãos (atendimento não existe)', `
    WITH paths AS (
      SELECT name, (metadata->>'size')::bigint AS bytes,
             SPLIT_PART(name, '/', 2) AS at_id
      FROM storage.objects
      WHERE bucket_id = 'documentos'
        AND (name ~* '/audio[_.]' OR name ~* '\\.wav$|\\.webm$')
    )
    SELECT COUNT(*) AS qtd,
           pg_size_pretty(SUM(bytes)) AS tamanho,
           SUM(bytes) AS bytes
    FROM paths p
    WHERE NOT EXISTS (
      SELECT 1 FROM atendimentos a WHERE a.id::text = p.at_id
    )
  `)
  if (rows) console.log('  ', rows[0])

  // 7. Documentos órfãos
  rows = await q('Documentos órfãos (file_url sem registro)', `
    SELECT COUNT(*) AS qtd,
           pg_size_pretty(SUM((so.metadata->>'size')::bigint)) AS tamanho,
           SUM((so.metadata->>'size')::bigint) AS bytes
    FROM storage.objects so
    WHERE so.bucket_id = 'documentos'
      AND so.name LIKE '%/docs/%'
      AND NOT EXISTS (
        SELECT 1 FROM documentos d WHERE d.file_url = so.name
      )
  `)
  if (rows) console.log('  ', rows[0])

  // 8. Top tabelas DB
  rows = await q('Top 15 tabelas (Postgres)', `
    SELECT schemaname || '.' || tablename AS tabela,
           pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS tamanho
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
    LIMIT 15
  `)
  if (rows) for (const r of rows) console.log(`   ${String(r.tamanho).padStart(10)}  ${r.tabela}`)

  await client.end()
  console.log('\nFim.')
}

main().catch(async (err) => {
  console.error('\nERRO:', err.message)
  try { await client.end() } catch {}
  process.exit(1)
})
