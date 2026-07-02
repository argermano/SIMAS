#!/usr/bin/env node
import pg from 'pg'

const client = new pg.Client({
  host: process.env.PG_HOST,
  port: 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
})

await client.connect()

console.log('▼ Triggers em storage.objects:')
const t = await client.query(`
  SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS def
  FROM pg_trigger
  WHERE tgrelid = 'storage.objects'::regclass
    AND NOT tgisinternal
`)
for (const r of t.rows) console.log(`  ${r.tgname} (enabled=${r.tgenabled})\n    ${r.def}`)

console.log('\n▼ Usuário atual e roles:')
const u = await client.query(`SELECT current_user, session_user, current_role`)
console.log(' ', u.rows[0])

console.log('\n▼ Permissões em storage.objects:')
const p = await client.query(`
  SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema = 'storage' AND table_name = 'objects'
  ORDER BY grantee, privilege_type
`)
for (const r of p.rows) console.log(`  ${r.grantee.padEnd(20)} ${r.privilege_type}`)

console.log('\n▼ Sou superuser?')
const s = await client.query(`SELECT usesuper FROM pg_user WHERE usename = current_user`)
console.log(' ', s.rows[0])

await client.end()
