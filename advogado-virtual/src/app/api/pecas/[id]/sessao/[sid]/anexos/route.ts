import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logger } from '@/lib/logger'
import { garantirResumoIA, LIMITE_RESUMO_CHARS } from '@/lib/documentos/resumir'
import { adminSessoes, carregarPecaDoTenant, carregarSessao, inserirTurno } from '@/lib/ia/sessao/sessoes'

// Documento grande pode disparar o resumo Haiku na hora do anexo.
export const maxDuration = 120

const schema = z.object({
  documentoId: z.string().uuid(),
})

// POST /api/pecas/[id]/sessao/[sid]/anexos — vincula à sessão um documento que
// JÁ existe no dossiê (subido pelo fluxo normal de documentos; anexar no chat é
// upload + extração + esta chamada). A partir da próxima rodada ele entra no
// contexto — inteiro se couber, como resumo se for grande.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id: pecaId, sid } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response

  const peca = await carregarPecaDoTenant(supabase, pecaId, usuario.tenant_id)
  if (!peca) return jsonError('Peça não encontrada', 404)

  const admin = adminSessoes()
  const sessao = await carregarSessao(admin, { sessaoId: sid, pecaId, tenantId: usuario.tenant_id })
  if (!sessao) return jsonError('Sessão não encontrada', 404)
  if (sessao.status === 'encerrada') return jsonError('Esta sessão está encerrada.', 409)

  // O documento é lido pelo client do USUÁRIO: a RLS confere o tenant.
  const { data: doc } = await supabase
    .from('documentos')
    .select('id, file_name, tipo, texto_extraido')
    .eq('id', parsed.data.documentoId)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!doc) return jsonError('Documento não encontrado', 404)

  // Anexar o mesmo documento duas vezes é no-op (UNIQUE sessao_id+documento_id).
  const { error } = await admin
    .from('pecas_sessoes_anexos')
    .upsert(
      { sessao_id: sessao.id, documento_id: doc.id },
      { onConflict: 'sessao_id,documento_id', ignoreDuplicates: true },
    )
  if (error) {
    logger.error('ia.sessao.anexo.falha', { pecaId, sessaoId: sid, documentoId: doc.id }, error)
    return jsonError('Não foi possível anexar o documento à sessão', 500)
  }

  const chars = ((doc.texto_extraido as string | null) ?? '').length
  const grande = chars > LIMITE_RESUMO_CHARS

  // Documento grande ganha o resumo AGORA (e não no meio da próxima rodada):
  // é ~1s de Haiku aqui contra 1s a mais de espera na resposta lá.
  let resumido = false
  if (grande) {
    const resumo = await garantirResumoIA(admin, {
      documentoId: doc.id,
      tenantId: usuario.tenant_id,
      userId: usuario.id,
    })
    resumido = Boolean(resumo)
  }

  // O turno de anexo entra no histórico: na rodada seguinte o agente sabe que
  // o documento chegou e por qual nome procurá-lo no material do caso.
  const aviso = grande
    ? ` (documento extenso — entra como resumo; a íntegra pode ser pedida em trechos)`
    : ''
  const texto = `O advogado anexou o documento "${doc.file_name}" (${doc.tipo}) ao material desta sessão${aviso}.`

  const turno = await inserirTurno(admin, {
    sessaoId: sessao.id,
    papel: 'sistema',
    tipo: 'anexo',
    conteudo: texto,
    payload: {
      blocos: [texto],
      documento_id: doc.id,
      file_name: doc.file_name,
      chars,
      resumido,
    },
    criadoPor: usuario.id,
  })

  // LGPD: ids, tipo e tamanho — nunca o texto do documento.
  logger.info('ia.sessao.anexo', { sessaoId: sessao.id, pecaId, documentoId: doc.id, chars, resumido })

  return NextResponse.json({ ok: true, documentoId: doc.id, grande, resumido, turnoId: turno?.id ?? null })
}
