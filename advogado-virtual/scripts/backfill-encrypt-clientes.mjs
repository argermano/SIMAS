/**
 * Backfill: cifra CPF/RG de clientes já existentes (que estão em texto-plano).
 *
 * Idempotente — valores já cifrados (prefixo "enc:v1:") são ignorados.
 * Usa o MESMO formato AES-256-GCM de src/lib/encryption.ts, então o app
 * consegue decifrar normalmente após a execução.
 *
 * Requisitos (env):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY
 *
 * Uso:
 *   node scripts/backfill-encrypt-clientes.mjs --dry-run   # só relata, não grava
 *   node scripts/backfill-encrypt-clientes.mjs             # aplica
 *
 * RECOMENDADO: faça backup da tabela `clientes` antes de aplicar.
 */
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENC = process.env.ENCRYPTION_KEY
const DRY_RUN = process.argv.includes('--dry-run')

if (!URL || !SERVICE_KEY) {
  console.error('❌ Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!ENC || ENC.includes('gere_com')) {
  console.error('❌ ENCRYPTION_KEY não configurada (ou ainda é o placeholder).')
  process.exit(1)
}

const PREFIX = 'enc:v1:'
const key = /^[0-9a-fA-F]{64}$/.test(ENC)
  ? Buffer.from(ENC, 'hex')
  : crypto.createHash('sha256').update(ENC).digest()

function encryptField(plain) {
  if (plain == null || plain === '') return plain
  if (typeof plain === 'string' && plain.startsWith(PREFIX)) return plain
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

const supabase = createClient(URL, SERVICE_KEY)

async function main() {
  console.log(DRY_RUN ? '🔍 DRY-RUN (nada será gravado)\n' : '🔐 Aplicando criptografia...\n')

  const PAGE = 500
  let from = 0
  let total = 0
  let cifrados = 0
  let jaCifrados = 0

  for (;;) {
    const { data, error } = await supabase
      .from('clientes')
      .select('id, cpf, rg')
      .range(from, from + PAGE - 1)

    if (error) {
      console.error('❌ Erro ao ler clientes:', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break

    for (const c of data) {
      total++
      const cpfPrecisa = typeof c.cpf === 'string' && c.cpf && !c.cpf.startsWith(PREFIX)
      const rgPrecisa = typeof c.rg === 'string' && c.rg && !c.rg.startsWith(PREFIX)

      if (!cpfPrecisa && !rgPrecisa) {
        if ((c.cpf && c.cpf.startsWith(PREFIX)) || (c.rg && c.rg.startsWith(PREFIX))) jaCifrados++
        continue
      }

      const update = {}
      if (cpfPrecisa) update.cpf = encryptField(c.cpf)
      if (rgPrecisa) update.rg = encryptField(c.rg)

      if (DRY_RUN) {
        cifrados++
        continue
      }

      const { error: upErr } = await supabase.from('clientes').update(update).eq('id', c.id)
      if (upErr) console.error(`  ✗ falha ao atualizar ${c.id}:`, upErr.message)
      else cifrados++
    }

    if (data.length < PAGE) break
    from += PAGE
  }

  console.log('\n─────────────────────────────')
  console.log(`Total de clientes:     ${total}`)
  console.log(`Já cifrados (pulados): ${jaCifrados}`)
  console.log(DRY_RUN ? `Seriam cifrados:       ${cifrados}` : `Cifrados agora:        ${cifrados}`)
  console.log('✅ Concluído.')
}

main().catch((err) => {
  console.error('❌ Erro fatal:', err)
  process.exit(1)
})
