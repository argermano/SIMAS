/**
 * Executa as migrations do Supabase via Management API
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_REF = 'wlhtejsimgzzngruhcqt'
const ACCESS_TOKEN = 'sbp_e3cee89642903354447d38512e8d4a5903dd2be6'

const MIGRATIONS = [
  '001_tenants_users.sql',
  '002_clientes.sql',
  '003_atendimentos_documentos.sql',
  '004_analises_pecas.sql',
  '005_rls_policies.sql',
  '006_atendimentos_v2.sql',
]

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

  for (const arquivo of MIGRATIONS) {
    const caminho = join(__dirname, '..', 'supabase', 'migrations', arquivo)
    const sql = readFileSync(caminho, 'utf-8')

    process.stdout.write(`▶ ${arquivo} ... `)

    try {
      await executarSQL(sql, arquivo)
      console.log('✅ OK')
    } catch (err) {
      const msg = err.message || String(err)
      // Erros de "já existe" são aceitáveis (idempotente)
      if (msg.includes('already exists') || msg.includes('duplicate key') || msg.includes('já existe')) {
        console.log(`⚠️  Já existe (ignorado)`)
      } else {
        console.log(`❌ ERRO: ${msg}`)
        process.exit(1)
      }
    }
  }

  console.log('\n✅ Todas as migrations executadas com sucesso!')
  console.log(`\nProjeto: https://supabase.com/dashboard/project/${PROJECT_REF}`)
}

main().catch(err => {
  console.error('❌ Erro fatal:', err.message)
  process.exit(1)
})
