// Webhook message_created do Chatwoot → staging de comprovante (SERVER-ONLY).
// O Chatwoot NÃO assina o payload: a autenticação é por token na query string.
// Ele manda TUDO (toda mensagem); o normal é ignorar rápido com 200 e só
// processar mensagens de ENTRADA com anexo imagem/PDF. O trabalho pesado (baixar
// anexo + extração IA) roda em background via after(), depois da resposta.
// INVARIANTE DURA: nunca dá baixa — só pré-organiza para conferência humana.
// LGPD: nunca logar payload/content — no máximo logger.debug com evento e contagem.

import { NextRequest, NextResponse, after } from 'next/server'
import crypto from 'node:crypto'
import { logger } from '@/lib/logger'
import { processarAnexoRecebido } from '@/lib/financeiro/recebimento'

export const runtime = 'nodejs' // Buffer/relay/IA exigem runtime Node (não Edge)
export const maxDuration = 60 // after() (baixa + extração IA) roda dentro desta janela

// Máx. de anexos processados por mensagem — trava contra abuso (mensagem com dezenas de imagens).
const MAX_ANEXOS = 3

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function strOuVazio(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// Comparação em tempo constante (mesmo padrão do webhook d4sign). O early-return
// no mismatch de tamanho vaza só o COMPRIMENTO do token — irrelevante para um
// segredo aleatório; timingSafeEqual exige buffers de tamanho igual.
function tokenValido(fornecido: string, esperado: string): boolean {
  const a = Buffer.from(fornecido)
  const b = Buffer.from(esperado)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// POST /api/webhooks/chatwoot?token=...  (público — chamado pelo Chatwoot)
export async function POST(req: NextRequest) {
  // Sem token provisionado a feature está desligada (fail-closed).
  const esperado = process.env.CHATWOOT_WEBHOOK_TOKEN
  if (!esperado) {
    return NextResponse.json({ error: 'Desabilitado' }, { status: 503 })
  }

  const fornecido = req.nextUrl.searchParams.get('token') ?? ''
  if (!tokenValido(fornecido, esperado)) {
    // Sem detalhes: não distinguir "token errado" de "ausente".
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Parse defensivo: o payload do Chatwoot varia entre versões — nada de zod estrito.
  let payload: Record<string, unknown>
  try {
    const bruto = await req.json()
    if (!isRecord(bruto)) return NextResponse.json({ ok: true })
    payload = bruto
  } catch {
    return NextResponse.json({ ok: true }) // corpo inválido — ignora rápido
  }

  const evento = payload.event
  if (evento !== 'message_created') return NextResponse.json({ ok: true })

  // Só ENTRADA: 'incoming' (string) ou 0 (enum numérico do Chatwoot).
  const tipo = payload.message_type
  if (tipo !== 'incoming' && tipo !== 0) return NextResponse.json({ ok: true })

  // Nota privada nunca é comprovante do cliente.
  if (payload.private === true) return NextResponse.json({ ok: true })

  const attachments = Array.isArray(payload.attachments) ? payload.attachments : []
  if (attachments.length === 0) return NextResponse.json({ ok: true })

  // Telefone do remetente: conversation.meta.sender.phone_number (fallback sender.phone_number).
  const conversation = isRecord(payload.conversation) ? payload.conversation : {}
  const meta = isRecord(conversation.meta) ? conversation.meta : {}
  const metaSender = isRecord(meta.sender) ? meta.sender : {}
  const sender = isRecord(payload.sender) ? payload.sender : {}
  const telefone = strOuVazio(metaSender.phone_number) || strOuVazio(sender.phone_number)
  if (!telefone) return NextResponse.json({ ok: true }) // sem telefone não há como casar cliente

  // id da mensagem é a chave de dedup do recebimento — sem ele, ignora.
  const idMensagem = payload.id
  if (idMensagem == null) return NextResponse.json({ ok: true })
  const mensagemId = String(idMensagem)
  const conversaId = String(conversation.display_id ?? conversation.id ?? '')

  // Só anexos de arquivo (file_type 'image' ou 'file') com data_url utilizável.
  const relevantes = attachments
    .filter(isRecord)
    .filter((a) => (a.file_type === 'image' || a.file_type === 'file') && strOuVazio(a.data_url))
    .slice(0, MAX_ANEXOS)
  if (relevantes.length === 0) return NextResponse.json({ ok: true })

  const total = relevantes.length
  logger.debug('chatwoot.webhook.recebido', { event: evento, anexos: total })

  // Responde 200 já; a baixa + extração IA rodam depois da resposta (after()).
  // processarAnexoRecebido NUNCA lança (engole erros e loga só ids) — webhook não 500a.
  after(async () => {
    for (let i = 0; i < relevantes.length; i++) {
      const anexoUrl = strOuVazio(relevantes[i].data_url)
      // Sufixo -N só com mais de um anexo, mantendo mensagemId estável no caso comum.
      const idAnexo = total > 1 ? `${mensagemId}-${i + 1}` : mensagemId
      await processarAnexoRecebido({
        telefone,
        anexoUrl,
        mensagemId: idAnexo,
        conversaId,
        contentTypeHint: null,
      })
    }
  })

  return NextResponse.json({ ok: true })
}
