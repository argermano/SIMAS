import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { validarNumeroCNJ, aliasDataJud } from '@/lib/jurisprudencia/verificador-citacoes'
import { buscarProcessoPorNumero } from '@/lib/jurisprudencia/datajud'

export const maxDuration = 60

// POST /api/atendimentos/[id]/processo — grava o nº CNJ do caso e consulta o
// DataJud (E2). Sempre SUGERE (não sobrescreve capa silenciosamente); a UI
// confirma. Best-effort: se o DataJud não responder, grava o número mesmo assim.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { numero } = (await req.json()) as { numero?: string }
  const limpo = (numero ?? '').replace(/\D/g, '')

  if (!validarNumeroCNJ(limpo)) {
    return jsonError('Número de processo inválido — o dígito verificador (CNJ) não confere.', 400)
  }

  // Confirma que o atendimento é do tenant antes de gravar.
  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()
  if (!atendimento) return jsonError('Caso não encontrado', 404)

  // Consulta o DataJud (best-effort — pode não localizar/estar indexado).
  const alias = aliasDataJud(limpo)
  const dados = alias ? await buscarProcessoPorNumero(alias, limpo) : null

  // Formata o número CNJ com máscara para exibição.
  const formatado = `${limpo.slice(0, 7)}-${limpo.slice(7, 9)}.${limpo.slice(9, 13)}.${limpo.slice(13, 14)}.${limpo.slice(14, 16)}.${limpo.slice(16, 20)}`

  const { error } = await supabase
    .from('atendimentos')
    .update({ numero_processo: formatado, dados_processo: dados })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (error) return jsonError('Falha ao salvar o número do processo.', 500)

  return NextResponse.json({
    numero: formatado,
    dados,
    encontrado: !!dados,
    coberto: !!alias, // false = tribunal fora da cobertura do DataJud público
  })
}
