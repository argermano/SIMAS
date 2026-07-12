// Extração compartilhada de comprovante de pagamento (SERVER-ONLY).
// OCR (Haiku Vision/PDF) → estruturação JSON validada (zod). Antes vivia
// inline na rota POST /api/financeiro/comprovante; foi extraída para ser
// reusada pelo recebimento automático (webhook Chatwoot → staging).
// INVARIANTE: a IA APENAS extrai/sugere — nunca dá baixa.
// LGPD: nunca logar texto/valores do comprovante — só ids e contagens.

import { z } from 'zod'
import { extractTextFromImage, extractTextFromPdf, completionJSON } from '@/lib/anthropic/client'
import { dadosComprovanteSchema, type DadosComprovante } from '@/lib/financeiro/comprovante'

// Tipos de mídia aceitos para leitura (imagens que o Haiku Vision entende + PDF).
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type MediaType = (typeof MEDIA_TYPES)[number]

// A IA pode sinalizar que a imagem não é um comprovante.
const respostaIASchema = z.union([
  z.object({ naoComprovante: z.literal(true) }),
  dadosComprovanteSchema,
])

const SYSTEM_EXTRACAO = `Você extrai dados estruturados de comprovantes de pagamento brasileiros (Pix, TED, transferência, boleto) a partir do texto OCR fornecido.

Retorne um JSON com:
- "valorCentavos": inteiro — o valor PAGO convertido para CENTAVOS (ex.: R$ 1.234,56 → 123456)
- "dataISO": string "yyyy-mm-dd" — a data em que o pagamento foi realizado
- "pagadorNome": string (opcional) — nome de quem pagou
- "banco": string (opcional) — instituição do pagador
- "endToEndId": string (opcional) — identificador E2E do Pix (começa com "E"), se houver

Se o texto claramente NÃO for um comprovante de pagamento, retorne exatamente: {"naoComprovante": true}`

// Motivos de falha. 'erro_ia' carrega a FASE para a rota reproduzir os status
// de hoje (ocr → 502, extração → 422); os demais motivos bastam por si.
export type ResultadoExtracao =
  | { ok: true; dados: DadosComprovante }
  | { ok: false; motivo: 'tipo_nao_suportado' }
  | { ok: false; motivo: 'sem_texto' }
  | { ok: false; motivo: 'nao_comprovante' }
  | { ok: false; motivo: 'erro_ia'; fase: 'ocr' | 'extracao' }

/**
 * Lê um comprovante (bytes + contentType) e devolve os dados estruturados.
 * Não conhece parcelas/tenant/telefone — só OCR + estruturação. Nunca loga
 * conteúdo. Quem chama decide o que fazer com cada motivo de falha.
 */
export async function extrairDadosComprovante(input: {
  buffer: Buffer
  contentType: string
}): Promise<ResultadoExtracao> {
  const contentType = (input.contentType ?? '').split(';')[0].trim().toLowerCase()

  // 1) OCR (Haiku) — imagem ou PDF.
  let textoOCR: string
  try {
    if (contentType === 'application/pdf') {
      textoOCR = await extractTextFromPdf({ pdfBase64: input.buffer.toString('base64') })
    } else if ((MEDIA_TYPES as readonly string[]).includes(contentType)) {
      textoOCR = await extractTextFromImage({
        imageBase64: input.buffer.toString('base64'),
        mediaType: contentType as MediaType,
      })
    } else {
      return { ok: false, motivo: 'tipo_nao_suportado' }
    }
  } catch {
    return { ok: false, motivo: 'erro_ia', fase: 'ocr' }
  }
  if (!textoOCR.trim()) {
    return { ok: false, motivo: 'sem_texto' }
  }

  // 2) Estruturação em JSON validado (zod).
  try {
    const { result } = await completionJSON({
      system: SYSTEM_EXTRACAO,
      prompt: `Texto OCR do anexo:\n\n${textoOCR}`,
      maxTokens: 1024,
      schema: respostaIASchema,
    })
    if ('naoComprovante' in result) {
      return { ok: false, motivo: 'nao_comprovante' }
    }
    return { ok: true, dados: result }
  } catch {
    return { ok: false, motivo: 'erro_ia', fase: 'extracao' }
  }
}
