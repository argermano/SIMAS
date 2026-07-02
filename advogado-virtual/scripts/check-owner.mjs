import pg from 'pg'
const client = new pg.Client({
  host: process.env.PG_HOST, port: 5432,
  user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  database: 'postgres', ssl: { rejectUnauthorized: false },
})
await client.connect()

console.log('▼ Owner de storage.objects:')
const o = await client.query(`
  SELECT tableowner FROM pg_tables
  WHERE schemaname='storage' AND tablename='objects'
`)
console.log(' ', o.rows[0])

console.log('\n▼ Roles que tenho:')
const r = await client.query(`
  SELECT rolname FROM pg_roles WHERE pg_has_role(current_user, oid, 'member')
`)
console.log(' ', r.rows.map(x => x.rolname).join(', '))

console.log('\n▼ Funções de storage que parecem deletar:')
const f = await client.query(`
  SELECT proname, prosrc::text FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'storage' AND (proname ILIKE '%delete%' OR proname ILIKE '%remove%')
`)
for (const row of f.rows) console.log(`  ${row.proname}`)

console.log('\n▼ Função storage.protect_delete (o trigger):')
const pd = await client.query(`
  SELECT pg_get_functiondef(oid) AS def FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname='storage' AND proname='protect_delete'
`)
if (pd.rows.length) console.log(pd.rows[0].def)

await client.end()
