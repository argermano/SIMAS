/**
 * Executa as migrations do Supabase via Management API.
 *
 * Cada migration roda UMA VEZ: os arquivos aplicados ficam registrados na
 * tabela _migrations_aplicadas e são pulados nas rodadas seguintes.
 * (Antes o script reexecutava tudo e confiava em "IF NOT EXISTS" — mas
 * backfills de DADOS rodavam de novo a cada rodada; foi assim que a migration
 * 018 ficou meses sobrescrevendo os dados profissionais de Configurações com
 * valores antigos de users — o caso da "OAB 32777 que sempre voltava".)
 */
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!PROJECT_REF || !ACCESS_TOKEN) {
  console.error(
    '❌ Defina SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN no ambiente antes de rodar.\n' +
    '   Ex.: SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/run-migrations.mjs'
  )
  process.exit(1)
}

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations')
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

async function executarSQL(sql, nome) {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })

  const texto = await res.text()

  if (!res.ok) {
    throw new Error(`Erro HTTP ${res.status}: ${texto}`)
  }

  // Pode ser array (SELECT) ou objeto de erro
  let resultado
  try {
    resultado = JSON.parse(texto)
  } catch {
    resultado = texto
  }

  // Verifica se é erro do Postgres
  if (resultado && resultado.message && resultado.code) {
    throw new Error(`Erro Postgres: ${resultado.message} (código: ${resultado.code})`)
  }

  return resultado
}

async function main() {
  console.log('🚀 Iniciando execução das migrations...\n')

  await executarSQL(`
    CREATE TABLE IF NOT EXISTS _migrations_aplicadas (
      nome text PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE _migrations_aplicadas ENABLE ROW LEVEL SECURITY;
  `, '_migrations_aplicadas')

  const aplicadas = new Set(
    (await executarSQL('SELECT nome FROM _migrations_aplicadas', 'listar')).map((r) => r.nome),
  )

  let executadas = 0
  for (const arquivo of MIGRATIONS) {
    if (aplicadas.has(arquivo)) continue

    const caminho = join(MIGRATIONS_DIR, arquivo)
    const sql = readFileSync(caminho, 'utf-8')

    process.stdout.write(`▶ ${arquivo} ... `)

    try {
      await executarSQL(sql, arquivo)
      console.log('✅ OK')
    } catch (err) {
      const msg = err.message || String(err)
      // Erros de "já existe" são aceitáveis (migrations antigas pré-rastreamento)
      if (msg.includes('already exists') || msg.includes('duplicate key') || msg.includes('já existe')) {
        console.log(`⚠️  Já existe (ignorado)`)
      } else {
        console.log(`❌ ERRO: ${msg}`)
        process.exit(1)
      }
    }

    // Registra mesmo quando caiu no "já existe": o arquivo foi processado e
    // não deve rodar de novo (é justamente a reexecução que causava estrago).
    await executarSQL(
      `INSERT INTO _migrations_aplicadas (nome) VALUES ('${arquivo.replace(/'/g, "''")}') ON CONFLICT (nome) DO NOTHING`,
      `registrar ${arquivo}`,
    )
    executadas++
  }

  if (executadas === 0) {
    console.log('✅ Nenhuma migration pendente — tudo já aplicado.')
  } else {
    console.log(`\n✅ ${executadas} migration(s) executada(s) com sucesso!`)
  }
  console.log(`\nProjeto: https://supabase.com/dashboard/project/${PROJECT_REF}`)
}

main().catch(err => {
  console.error('❌ Erro fatal:', err.message)
  process.exit(1)
})
