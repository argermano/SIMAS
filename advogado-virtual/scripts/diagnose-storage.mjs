#!/usr/bin/env node
// Diagnóstico de uso de DB + Storage. Apenas leituras.
// Uso: SUPABASE_URL=... SUPABASE_KEY=... node scripts/diagnose-storage.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltam variáveis: SUPABASE_URL, SUPABASE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function fmtBytes(bytes) {
  if (bytes == null) return '—'
  const n = Number(bytes)
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function main() {
  // ─── Storage: lista tudo paginado ────────────────────────────────────────
  console.log('\n▼ Coletando storage.objects (pode demorar)...\n')

  const buckets = new Map() // bucket_id -> { count, bytes }
  const tipos = new Map()   // tipo -> { count, bytes }
  const tenants = new Map() // tenant_id -> { count, bytes }
  const topFiles = []

  const PAGE = 1000
  let from = 0
  let total = 0

  while (true) {
    const { data, error } = await supabase
      .schema('storage')
      .from('objects')
      .select('bucket_id, name, metadata, created_at')
      .range(from, from + PAGE - 1)

    if (error) {
      console.error('Erro lendo storage.objects:', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break

    for (const o of data) {
      const size = Number(o.metadata?.size ?? 0)
      total += size

      const b = buckets.get(o.bucket_id) ?? { count: 0, bytes: 0 }
      b.count++; b.bytes += size
      buckets.set(o.bucket_id, b)

      // Classificação por tipo (heurística baseada no path)
      let tipo = 'outros'
      if (/\/audio[_.]/i.test(o.name) || /\.wav$|\.webm$/i.test(o.name)) {
        if (/audio_upload_.*chunk_/i.test(o.name)) tipo = 'audio_chunk_wav'
        else if (/\/audio_/i.test(o.name)) tipo = 'audio_atendimento'
        else tipo = 'audio_outro'
      } else if (o.name.includes('/docs/')) tipo = 'documentos_cliente'
      else if (o.name.includes('/modelos/')) tipo = 'modelos_documento'
      else if (o.name.includes('/contratos/')) tipo = 'modelos_contrato'

      const t = tipos.get(tipo) ?? { count: 0, bytes: 0 }
      t.count++; t.bytes += size
      tipos.set(tipo, t)

      const tenantId = o.name.split('/')[0]
      const tn = tenants.get(tenantId) ?? { count: 0, bytes: 0 }
      tn.count++; tn.bytes += size
      tenants.set(tenantId, tn)

      topFiles.push({ name: o.name, bucket: o.bucket_id, bytes: size, created_at: o.created_at })
    }

    if (data.length < PAGE) break
    from += PAGE
  }

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  STORAGE — Total geral:', fmtBytes(total))
  console.log('═══════════════════════════════════════════════════════════════\n')

  console.log('▼ Por bucket:')
  const bucketRows = [...buckets.entries()].sort((a, b) => b[1].bytes - a[1].bytes)
  for (const [name, info] of bucketRows) {
    console.log(`  • ${name.padEnd(20)} ${String(info.count).padStart(6)} arq.  ${fmtBytes(info.bytes)}`)
  }

  console.log('\n▼ Por tipo (heurística por path):')
  const tipoRows = [...tipos.entries()].sort((a, b) => b[1].bytes - a[1].bytes)
  for (const [name, info] of tipoRows) {
    console.log(`  • ${name.padEnd(22)} ${String(info.count).padStart(6)} arq.  ${fmtBytes(info.bytes)}`)
  }

  console.log('\n▼ Top 10 tenants consumidores:')
  const tenantRows = [...tenants.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10)
  for (const [name, info] of tenantRows) {
    console.log(`  • ${name.padEnd(38)} ${String(info.count).padStart(6)} arq.  ${fmtBytes(info.bytes)}`)
  }

  console.log('\n▼ Top 20 maiores arquivos:')
  topFiles.sort((a, b) => b.bytes - a.bytes)
  for (const f of topFiles.slice(0, 20)) {
    console.log(`  ${fmtBytes(f.bytes).padStart(9)}  ${f.name}`)
  }

  // ─── Órfãos: áudios sem atendimento ──────────────────────────────────────
  console.log('\n▼ Verificando áudios órfãos (atendimento já deletado)...')

  // Coleta IDs de atendimentos existentes
  const atendimentoIds = new Set()
  let aFrom = 0
  while (true) {
    const { data, error } = await supabase
      .from('atendimentos')
      .select('id')
      .range(aFrom, aFrom + PAGE - 1)
    if (error) { console.error('  erro:', error.message); break }
    if (!data || data.length === 0) break
    for (const a of data) atendimentoIds.add(a.id)
    if (data.length < PAGE) break
    aFrom += PAGE
  }
  console.log(`  atendimentos no DB: ${atendimentoIds.size}`)

  let orfaosCount = 0
  let orfaosBytes = 0
  const sampleOrfaos = []
  for (const f of topFiles) {
    if (!/\/audio[_.]/i.test(f.name) && !/\.wav$|\.webm$/i.test(f.name)) continue
    const parts = f.name.split('/')
    if (parts.length < 2) continue
    const atId = parts[1]
    if (!atendimentoIds.has(atId)) {
      orfaosCount++
      orfaosBytes += f.bytes
      if (sampleOrfaos.length < 10) sampleOrfaos.push(f)
    }
  }
  console.log(`  áudios órfãos: ${orfaosCount} arquivos / ${fmtBytes(orfaosBytes)}`)
  if (sampleOrfaos.length > 0) {
    console.log('  exemplos:')
    for (const f of sampleOrfaos) console.log(`    ${fmtBytes(f.bytes).padStart(9)}  ${f.name}`)
  }

  // ─── Órfãos: documentos sem registro no DB ───────────────────────────────
  console.log('\n▼ Verificando documentos órfãos (file_url sem registro)...')
  const docFileUrls = new Set()
  let dFrom = 0
  while (true) {
    const { data, error } = await supabase
      .from('documentos')
      .select('file_url')
      .range(dFrom, dFrom + PAGE - 1)
    if (error) { console.error('  erro:', error.message); break }
    if (!data || data.length === 0) break
    for (const d of data) if (d.file_url) docFileUrls.add(d.file_url)
    if (data.length < PAGE) break
    dFrom += PAGE
  }
  console.log(`  registros documentos no DB: ${docFileUrls.size}`)

  let docOrfaosCount = 0
  let docOrfaosBytes = 0
  for (const f of topFiles) {
    if (!f.name.includes('/docs/')) continue
    if (!docFileUrls.has(f.name)) {
      docOrfaosCount++
      docOrfaosBytes += f.bytes
    }
  }
  console.log(`  documentos órfãos: ${docOrfaosCount} arquivos / ${fmtBytes(docOrfaosBytes)}`)

  // ─── Resumo final ────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  RESUMO — limpeza imediata possível:')
  console.log('═══════════════════════════════════════════════════════════════')
  const chunkBytes = tipos.get('audio_chunk_wav')?.bytes ?? 0
  console.log(`  Áudios órfãos          : ${fmtBytes(orfaosBytes)}`)
  console.log(`  Documentos órfãos      : ${fmtBytes(docOrfaosBytes)}`)
  console.log(`  Chunks WAV (descartáv.): ${fmtBytes(chunkBytes)}`)
  console.log(`  ──────────────────────────────────────`)
  console.log(`  Total limpeza segura   : ${fmtBytes(orfaosBytes + docOrfaosBytes + chunkBytes)}`)
  console.log(`  Storage atual          : ${fmtBytes(total)}`)
}

main().catch(err => {
  console.error('\nERRO:', err.message)
  process.exit(1)
})
