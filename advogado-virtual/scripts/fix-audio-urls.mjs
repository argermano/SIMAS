// Limpa audio_url de atendimentos que apontam pra chunks deletados.
// Remove só os paths de chunks; mantém os outros (audio_atendimento) intactos.
import pg from 'pg'

const client = new pg.Client({
  host: process.env.PG_HOST, port: 5432,
  user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  database: 'postgres', ssl: { rejectUnauthorized: false },
})
await client.connect()

const { rows } = await client.query(`
  SELECT id, audio_url FROM atendimentos
  WHERE audio_url IS NOT NULL AND audio_url::text ~ 'chunk_'
`)
console.log(`Atendimentos com refs a chunks: ${rows.length}`)

await client.query('BEGIN')
try {
  for (const r of rows) {
    let paths = []
    try {
      const parsed = JSON.parse(r.audio_url)
      paths = Array.isArray(parsed) ? parsed : [r.audio_url]
    } catch {
      paths = [r.audio_url]
    }
    const filtered = paths.filter(p => typeof p === 'string' && !/audio_upload_.*chunk_/i.test(p))
    const novoValor = filtered.length === 0 ? null : JSON.stringify(filtered)
    console.log(`  ${r.id}: ${paths.length} → ${filtered.length} paths`)
    await client.query(
      `UPDATE atendimentos SET audio_url = $1 WHERE id = $2`,
      [novoValor, r.id]
    )
  }
  await client.query('COMMIT')
  console.log('\nCOMMIT OK.')
} catch (err) {
  await client.query('ROLLBACK')
  console.error(`ERRO: ${err.message}`)
  process.exit(1)
}

await client.end()
