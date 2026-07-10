import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { apenasDigitos, mesmoTelefone } from '@/lib/conversas/telefone'
import { extrairTextoPlano } from '@/lib/processos/djen'
import type { ContextoConversa } from '@/lib/conversas/tipos'

// GET /api/conversas/contexto?telefone=E164 — contexto SIMAS do contato da
// conversa (PainelContexto). Casa o telefone com um CLIENTE do tenant (mesma
// lógica do by-phone da Fase 5: mesmoTelefone tolera máscara BR, DDI 55 e o
// 9º dígito) e devolve os processos dele + as últimas publicações desses
// processos. { cliente: null } quando não há correspondência.

const TAMANHO_TRECHO = 140

/** 20 dígitos CNJ → NNNNNNN-DD.AAAA.J.TR.OOOO (mesma máscara do sync da Fase 5). */
function mascararCNJ(numero: string | null): string | null {
  const d = (numero ?? '').replace(/\D/g, '')
  if (d.length !== 20) return numero || null
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`
}

/** Trecho de ~140 chars do texto plano da publicação (uma linha, com reticências). */
function trechoPublicacao(html: string | null): string {
  const plano = extrairTextoPlano(html).replace(/\s+/g, ' ').trim()
  if (plano.length <= TAMANHO_TRECHO) return plano
  return `${plano.slice(0, TAMANHO_TRECHO).trimEnd()}…`
}

export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const telefone = (searchParams.get('telefone') ?? '').trim()
  if (!telefone || !apenasDigitos(telefone)) {
    return jsonError('Parâmetro telefone é obrigatório', 400)
  }

  // Clientes reais do tenant (exclui pré-cadastros do funil e apagados).
  // Ordem determinística: se dois clientes compartilham a linha, o match é estável.
  const { data: clientes, error: erroClientes } = await supabase
    .from('clientes')
    .select('id, nome, telefone')
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .neq('status_cadastro', 'pre_cadastro')
    .not('telefone', 'is', null)
    .order('created_at', { ascending: true })
  if (erroClientes) return jsonError(erroClientes.message, 500)

  const cliente = (clientes ?? []).find((c) => mesmoTelefone(c.telefone, telefone))
  if (!cliente) {
    const vazio: ContextoConversa = { cliente: null, processos: [], publicacoes: [] }
    return NextResponse.json(vazio)
  }

  const { data: processos, error: erroProcessos } = await supabase
    .from('processos')
    .select('id, numero_cnj, apelido, classe, situacao')
    .eq('tenant_id', usuario.tenant_id)
    .eq('cliente_id', cliente.id)
    .order('created_at', { ascending: false })
  if (erroProcessos) return jsonError(erroProcessos.message, 500)

  const listaProcessos = processos ?? []
  const numeros = listaProcessos.map((p) => p.numero_cnj).filter(Boolean)

  let publicacoes: ContextoConversa['publicacoes'] = []
  if (numeros.length > 0) {
    const { data: pubs, error: erroPubs } = await supabase
      .from('publicacoes')
      .select('id, texto, sigla_tribunal, data_disponibilizacao')
      .eq('tenant_id', usuario.tenant_id)
      .in('numero_processo', numeros)
      .order('data_disponibilizacao', { ascending: false })
      .order('created_at', { ascending: false }) // tie-break estável
      .limit(3)
    if (erroPubs) return jsonError(erroPubs.message, 500)
    publicacoes = (pubs ?? []).map((p) => ({
      id: p.id,
      trecho: trechoPublicacao(p.texto),
      tribunal: p.sigla_tribunal ?? null,
      data: p.data_disponibilizacao ?? null,
    }))
  }

  const contexto: ContextoConversa = {
    cliente: { id: cliente.id, nome: cliente.nome },
    processos: listaProcessos.map((p) => ({
      id: p.id,
      numeroMascara: mascararCNJ(p.numero_cnj),
      titulo: p.apelido || p.classe || null,
      situacao: p.situacao ?? null,
    })),
    publicacoes,
  }
  return NextResponse.json(contexto)
}
