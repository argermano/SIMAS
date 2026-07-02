#!/usr/bin/env node
// Testa se a Storage API responde apesar do exceed_storage_size_quota.
// Tenta UMA operação .remove() com o menor chunk WAV (alvo seguro).
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Pega 1 chunk WAV pequeno via Postgres direto
const pgClient = new pg.Client({
  host: process.env.PG_HOST,
  port: 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
})

await pgClient.connect()
const { rows } = await pgClient.query(`
  SELECT name, (metadata->>'size')::bigint AS bytes
  FROM storage.objects
  WHERE bucket_id = 'documentos'
    AND name ~* 'audio_upload_.*chunk_'
  ORDER BY (metadata->>'size')::bigint ASC
  LIMIT 1
`)
await pgClient.end()

if (rows.length === 0) {
  console.log('Nenhum chunk WAV encontrado.')
  process.exit(0)
}

const alvo = rows[0]
console.log(`Alvo: ${alvo.name} (${alvo.bytes} bytes)`)
console.log('Tentando .remove() via Storage API...')

const { data, error } = await supabase.storage
  .from('documentos')
  .remove([alvo.name])

if (error) {
  console.log('\n❌ BLOQUEADO:', error.message)
  console.log('   Status:', error.statusCode || 'n/a')
  console.log('\nFallback necessário (SQL direto).')
  process.exit(1)
}

console.log('\n✅ Storage API funciona!')
console.log('Resposta:', JSON.stringify(data, null, 2))
