import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { autorizadoIntegracao } from '@/lib/funil/auth-integracao'
import { mesmoTelefone } from '@/lib/funil/telefone'
import { logger } from '@/lib/logger'

export const maxDuration = 20

// GET /api/integracao/processos/by-phone/[telefone] — chamada pelo ai-attendant
// (Lote 3). Casa o telefone com um CLIENTE do escritório e devolve o andamento
// FACTUAL (resumo + nome + data) dos processos dele. Nunca devolve dados de outro
// cliente; 200 { ok:false } quando não há correspondência. Ver PLANO §7.
export async function GET(req: Request, { params }: { params: Promise<{ telefone: string }> }) {
  if (!autorizadoIntegracao(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const tenantId = process.env.FUNIL_TENANT_ID
  if (!tenantId) {
    logger.error('processos.by_phone.sem_tenant', {})
    return NextResponse.json({ ok: false })
  }

  const { telefone } = await params
  let alvo: string
  try {
    alvo = decodeURIComponent(telefone)
  } catch {
    return NextResponse.json({ ok: false }) // URI malformada: contrato é sempre 200
  }

  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Clientes reais do escritório (exclui pré-cadastros do funil e apagados).
  // Ordem determinística: se dois clientes compartilham a linha, o match é estável.
  const { data: clientes } = await admin
    .from('clientes')
    .select('id, nome, telefone')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .neq('status_cadastro', 'pre_cadastro')
    .not('telefone', 'is', null)
    .order('created_at', { ascending: true })

  const cliente = (clientes ?? []).find((c) => mesmoTelefone(c.telefone, alvo))
  if (!cliente) return NextResponse.json({ ok: false })

  const { data: processos } = await admin
    .from('processos')
    .select('id, numero_cnj, apelido, classe, orgao_julgador, situacao')
    .eq('tenant_id', tenantId)
    .eq('cliente_id', cliente.id)
    .order('created_at', { ascending: false })

  if (!processos || processos.length === 0) {
    return NextResponse.json({ ok: true, temProcessos: false, cliente: { primeiroNome: primeiroNome(cliente.nome) } })
  }

  const saida = []
  for (const p of processos) {
    const { data: movs } = await admin
      .from('processo_movimentos')
      .select('nome, resumo_ia, data_hora')
      .eq('processo_id', p.id)
      .order('data_hora', { ascending: false, nullsFirst: false })
      .limit(5)
    saida.push({
      apelido: p.apelido,
      numero: p.numero_cnj,
      classe: p.classe,
      orgao: p.orgao_julgador,
      situacao: p.situacao,
      ultimos: (movs ?? []).map((m) => ({
        data: m.data_hora ? String(m.data_hora).substring(0, 10) : null,
        resumo: m.resumo_ia,
        nome: m.nome,
      })),
    })
  }

  return NextResponse.json({
    ok: true,
    temProcessos: true,
    cliente: { primeiroNome: primeiroNome(cliente.nome) },
    processos: saida,
  })
}

function primeiroNome(nome: string | null): string {
  const p = (nome ?? '').trim().split(/\s+/)[0]
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''
}
