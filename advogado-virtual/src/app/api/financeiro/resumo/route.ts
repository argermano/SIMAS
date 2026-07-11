import { NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { hojeSaoPauloISO } from '@/lib/processos/util'

// GET /api/financeiro/resumo — indicadores do topo da tela /financeiro:
// a vencer nos próximos 7 dias, vencidas e recebido no mês (counts + somas
// em CENTAVOS). "Hoje" e "mês" no fuso America/Sao_Paulo.

const ROLES = ['admin', 'advogado', 'colaborador']

function addDiasISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  const hoje = hojeSaoPauloISO()
  const ate7 = addDiasISO(hoje, 7)
  const [ano, mes] = hoje.split('-').map(Number)
  // Limites do mês corrente em America/Sao_Paulo (offset fixo -03:00, sem DST no BR).
  const inicioMes = `${hoje.slice(0, 7)}-01T00:00:00-03:00`
  const proxMes = mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`
  const fimMes = `${proxMes}-01T00:00:00-03:00`

  const [aVencer, vencidas, recebidas] = await Promise.all([
    supabase
      .from('parcelas')
      .select('valor_centavos')
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'aberta')
      .gte('vencimento', hoje)
      .lte('vencimento', ate7),
    supabase
      .from('parcelas')
      .select('valor_centavos')
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'aberta')
      .lt('vencimento', hoje),
    supabase
      .from('parcelas')
      .select('valor_centavos, pago_valor_centavos')
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'paga')
      .gte('pago_em', inicioMes)
      .lt('pago_em', fimMes),
  ])

  const erro = aVencer.error ?? vencidas.error ?? recebidas.error
  if (erro) return jsonError(erro.message, 500)

  const soma = (linhas: { valor_centavos: number }[] | null) =>
    (linhas ?? []).reduce((acc, p) => acc + p.valor_centavos, 0)

  const recebidoSoma = (recebidas.data ?? []).reduce(
    (acc, p) => acc + (p.pago_valor_centavos ?? p.valor_centavos),
    0,
  )

  return NextResponse.json({
    aVencer7d: { quantidade: (aVencer.data ?? []).length, somaCentavos: soma(aVencer.data) },
    vencidas: { quantidade: (vencidas.data ?? []).length, somaCentavos: soma(vencidas.data) },
    recebidoMes: { quantidade: (recebidas.data ?? []).length, somaCentavos: recebidoSoma },
    hoje,
  })
}
