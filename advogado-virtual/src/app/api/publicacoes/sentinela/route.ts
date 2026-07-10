import { NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// ─────────────────────────────────────────────────────────────
// GET /api/publicacoes/sentinela — alertas da sentinela DataJud × DJEN
// (admin/advogado). Movimentos cuja natureza implica publicação no diário mas
// SEM comunicação correspondente no DJEN — aviso interno de triagem: a
// sentinela NUNCA notifica cliente e NUNCA calcula prazo.
//
// Default: só alertas abertos (status='aberta'). `?status=todas` traz o
// histórico (qualquer status) limitado a 50. Enriquece com processo→cliente
// em LOTE (1 query em `processos` + 1 em `clientes`; sem N+1).
// ─────────────────────────────────────────────────────────────

// Teto defensivo mesmo na lista de abertas (o painel é de triagem, não relatório).
const LIMITE_ABERTAS = 200
const LIMITE_HISTORICO = 50

interface AlertaRow {
  id: string
  processo_id: string
  numero_processo: string
  movimento_nome: string
  movimento_data: string
  status: string
  created_at: string
}

/** Formata 20 dígitos → NNNNNNN-DD.AAAA.J.TR.OOOO (máscara CNJ p/ exibição). */
function formatarCnj(digitos: string): string | null {
  const s = (digitos ?? '').replace(/\D/g, '')
  if (s.length !== 20) return null
  return `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16, 20)}`
}

export async function GET(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate

  const { searchParams } = new URL(req.url)
  const todas = searchParams.get('status') === 'todas'

  let query = supabase
    .from('sentinela_publicacoes')
    .select('id, processo_id, numero_processo, movimento_nome, movimento_data, status, created_at', {
      count: 'exact',
    })
    .eq('tenant_id', usuario.tenant_id) // defesa em profundidade (RLS já isola)
    .order('created_at', { ascending: false })
  query = todas ? query.limit(LIMITE_HISTORICO) : query.eq('status', 'aberta').limit(LIMITE_ABERTAS)

  const { data, error, count } = await query
  if (error) return jsonError(error.message, 500)
  const alertas = (data ?? []) as AlertaRow[]

  // processo → cliente em LOTE (sem N+1). `clientes.nome` é plaintext.
  const processoIds = [...new Set(alertas.map((a) => a.processo_id))]
  const clientePorProcesso = new Map<string, { clienteId: string; clienteNome: string | null }>()
  if (processoIds.length) {
    const { data: procs } = await supabase
      .from('processos')
      .select('id, cliente_id')
      .eq('tenant_id', usuario.tenant_id)
      .in('id', processoIds)
    const procsList = (procs ?? []) as { id: string; cliente_id: string }[]

    const clienteIds = [...new Set(procsList.map((p) => p.cliente_id).filter(Boolean))]
    const nomePorCliente = new Map<string, string | null>()
    if (clienteIds.length) {
      const { data: clis } = await supabase
        .from('clientes')
        .select('id, nome')
        .eq('tenant_id', usuario.tenant_id)
        .in('id', clienteIds)
      for (const c of (clis ?? []) as { id: string; nome: string | null }[]) {
        nomePorCliente.set(c.id, c.nome ?? null)
      }
    }
    for (const p of procsList) {
      clientePorProcesso.set(p.id, {
        clienteId: p.cliente_id,
        clienteNome: nomePorCliente.get(p.cliente_id) ?? null,
      })
    }
  }

  return NextResponse.json({
    alertas: alertas.map((a) => {
      const vinculo = clientePorProcesso.get(a.processo_id)
      return {
        id: a.id,
        numeroProcesso: a.numero_processo,
        numeroMascara: formatarCnj(a.numero_processo),
        movimentoNome: a.movimento_nome,
        movimentoData: a.movimento_data,
        clienteId: vinculo?.clienteId ?? null,
        clienteNome: vinculo?.clienteNome ?? null,
        status: a.status,
        createdAt: a.created_at,
      }
    }),
    total: count ?? alertas.length,
  })
}
