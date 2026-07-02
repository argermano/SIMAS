import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const client = new pg.Client({
  host: process.env.PG_HOST, port: 5432,
  user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  database: 'postgres', ssl: { rejectUnauthorized: false },
})
await client.connect()

// 1. Tamanho atual
const t = await client.query(`
  SELECT COUNT(*) qtd, pg_size_pretty(SUM((metadata->>'size')::bigint)) AS tamanho
  FROM storage.objects WHERE bucket_id = 'documentos'
`)
console.log('▼ Storage atual:', t.rows[0])

// 2. Atendimentos com audio_url apontando pra chunks deletados
const a = await client.query(`
  SELECT id, audio_url FROM atendimentos
  WHERE audio_url IS NOT NULL AND audio_url::text ~ 'chunk_'
`)
console.log(`\n▼ Atendimentos com refs a chunks: ${a.rows.length}`)
for (const r of a.rows.slice(0, 5)) console.log(`  ${r.id}  ${r.audio_url?.substring(0, 100)}`)

// 3. Testa API agora
console.log('\n▼ Testando Storage API novamente...')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data, error } = await supabase.storage.from('documentos').list('', { limit: 1 })
if (error) console.log(`  ❌ ainda bloqueada: ${error.message}`)
else console.log(`  ✅ API funcionando! (listou ${data?.length ?? 0} item)`)

await client.end()
