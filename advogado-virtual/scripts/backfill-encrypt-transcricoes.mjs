/**
 * Backfill: cifra as transcrições (transcricao_raw / transcricao_editada) de
 * atendimentos já existentes que estão em texto-plano.
 *
 * Idempotente — valores já cifrados (prefixo "enc:v1:") são ignorados.
 * Usa o MESMO formato AES-256-GCM de src/lib/encryption.ts, então o app
 * decifra normalmente após a execução.
 *
 * Requisitos (env):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY
 *
 * Uso:
 *   node --env-file=.env.local scripts/backfill-encrypt-transcricoes.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-encrypt-transcricoes.mjs
 *
 * ⚠️  Só rode com a ENCRYPTION_KEY de PRODUÇÃO idêntica à usada pelo app; uma
 * chave diferente tornaria os dados ilegíveis. RECOMENDADO: backup antes.
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
const CAMPOS = ['transcricao_raw', 'transcricao_editada']

async function main() {
  console.log(DRY_RUN ? '🔍 DRY-RUN (nada será gravado)\n' : '🔐 Aplicando criptografia às transcrições...\n')

  const PAGE = 500
  let from = 0
  let total = 0
  let cifrados = 0
  let jaCifrados = 0

  for (;;) {
    const { data, error } = await supabase
      .from('atendimentos')
      .select('id, transcricao_raw, transcricao_editada')
      .range(from, from + PAGE - 1)

    if (error) {
      console.error('❌ Erro ao ler atendimentos:', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break

    for (const a of data) {
      total++
      const update = {}
      let precisa = false
      let jaTinha = false
      for (const campo of CAMPOS) {
        const v = a[campo]
        if (typeof v === 'string' && v) {
          if (v.startsWith(PREFIX)) jaTinha = true
          else { update[campo] = encryptField(v); precisa = true }
        }
      }

      if (!precisa) {
        if (jaTinha) jaCifrados++
        continue
      }
      if (DRY_RUN) { cifrados++; continue }

      const { error: upErr } = await supabase.from('atendimentos').update(update).eq('id', a.id)
      if (upErr) console.error(`  ✗ falha ao atualizar ${a.id}:`, upErr.message)
      else cifrados++
    }

    if (data.length < PAGE) break
    from += PAGE
  }

  console.log('\n─────────────────────────────')
  console.log(`Total de atendimentos:      ${total}`)
  console.log(`Já cifrados (pulados):      ${jaCifrados}`)
  console.log(DRY_RUN ? `Seriam cifrados:            ${cifrados}` : `Cifrados agora:             ${cifrados}`)
  console.log('✅ Concluído.')
}

main().catch((err) => {
  console.error('❌ Erro fatal:', err)
  process.exit(1)
})
