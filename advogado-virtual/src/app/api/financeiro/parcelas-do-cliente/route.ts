import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { apenasDigitos, mesmoTelefone } from '@/lib/conversas/telefone'
import { gerarPixCopiaECola } from '@/lib/financeiro/pix'
import { montarTextoAvisoParcela } from '@/lib/financeiro/aviso'
import { hojeSaoPauloISO } from '@/lib/processos/util'

// GET /api/financeiro/parcelas-do-cliente?clienteId= OU ?telefone=
// Parcelas EM ABERTO de um cliente, para o card "PARCELAS EM ABERTO" do
// PainelContexto das Conversas. O match por telefone usa mesmoTelefone
// (tolera máscara BR, DDI 55 e o 9º dígito — padrão do /api/conversas/contexto).
// Cada parcela vem com o Pix copia-e-cola (se o escritório configurou a chave)
// e o texto de aviso pronto para preencher o composer — o humano revisa e envia.

const ROLES = ['admin', 'advogado', 'colaborador']

interface ConfigFinanceiro {
  pix_chave?: string
  pix_nome?: string
  pix_cidade?: string
}

export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const clienteId = (searchParams.get('clienteId') ?? '').trim()
  const telefone = (searchParams.get('telefone') ?? '').trim()
  if (!clienteId && !telefone) {
    return jsonError('Informe clienteId ou telefone', 400)
  }

  // Resolve o cliente.
  let cliente: { id: string; nome: string | null } | null = null
  if (clienteId) {
    const { data } = await supabase
      .from('clientes')
      .select('id, nome')
      .eq('id', clienteId)
      .eq('tenant_id', usuario.tenant_id)
      .is('deleted_at', null)
      .maybeSingle()
    cliente = data ?? null
  } else {
    if (!apenasDigitos(telefone)) return jsonError('Telefone inválido', 400)
    // Ordem determinística: se dois clientes compartilham a linha, o match é estável.
    const { data: clientes, error } = await supabase
      .from('clientes')
      .select('id, nome, telefone')
      .eq('tenant_id', usuario.tenant_id)
      .is('deleted_at', null)
      .not('telefone', 'is', null)
      .order('created_at', { ascending: true })
    if (error) return jsonError(error.message, 500)
    cliente = (clientes ?? []).find((c) => mesmoTelefone(c.telefone, telefone)) ?? null
  }

  if (!cliente) return NextResponse.json({ cliente: null, parcelas: [] })

  const [{ data: parcelas, error: erroParcelas }, { data: tenant }] = await Promise.all([
    supabase
      .from('parcelas')
      .select('id, descricao, valor_centavos, vencimento, contrato_id, processo_id')
      .eq('tenant_id', usuario.tenant_id)
      .eq('cliente_id', cliente.id)
      .eq('status', 'aberta')
      .order('vencimento', { ascending: true }),
    supabase.from('tenants').select('nome, config').eq('id', usuario.tenant_id).single(),
  ])
  if (erroParcelas) return jsonError(erroParcelas.message, 500)

  const cfg = ((tenant?.config as { financeiro?: ConfigFinanceiro } | null)?.financeiro ?? {})
  const pixConfigurado = !!(cfg.pix_chave && cfg.pix_nome && cfg.pix_cidade)
  const hoje = hojeSaoPauloISO()

  const lista = (parcelas ?? []).map((p) => {
    let pix: string | null = null
    if (pixConfigurado) {
      try {
        pix = gerarPixCopiaECola({
          chave: cfg.pix_chave!,
          nome: cfg.pix_nome!,
          cidade: cfg.pix_cidade!,
          valorCentavos: p.valor_centavos,
        })
      } catch {
        pix = null // config inválida não derruba o card
      }
    }
    return {
      ...p,
      vencida: p.vencimento < hoje,
      pix,
      textoAviso: montarTextoAvisoParcela({
        nomeCliente: cliente!.nome,
        descricao: p.descricao,
        valorCentavos: p.valor_centavos,
        vencimentoISO: p.vencimento,
        pixCopiaECola: pix,
        escritorioNome: tenant?.nome ?? null,
        ehHoje: p.vencimento === hoje,
      }),
    }
  })

  return NextResponse.json({
    cliente: { id: cliente.id, nome: cliente.nome },
    parcelas: lista,
  })
}
