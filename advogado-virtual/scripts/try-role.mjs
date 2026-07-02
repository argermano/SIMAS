import pg from 'pg'
const client = new pg.Client({
  host: process.env.PG_HOST, port: 5432,
  user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  database: 'postgres', ssl: { rejectUnauthorized: false },
})
await client.connect()

// 1. Ver a função do trigger
console.log('▼ storage.protect_delete():')
const fn = await client.query(`
  SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname='storage' AND p.proname='protect_delete'
`)
console.log(fn.rows[0]?.def ?? '(não encontrada)')

// 2. Posso virar supabase_storage_admin?
console.log('\n▼ Tentando SET ROLE supabase_storage_admin:')
try {
  await client.query(`SET ROLE supabase_storage_admin`)
  console.log('  ✅ funcionou!')
  const u = await client.query('SELECT current_user')
  console.log(' ', u.rows[0])
} catch (e) {
  console.log(`  ❌ ${e.message}`)
}

await client.end()
