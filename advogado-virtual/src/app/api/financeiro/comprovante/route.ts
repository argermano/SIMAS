import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logger } from '@/lib/logger'
import { relayFetchBinario } from '@/lib/conversas/relay'
import { apenasDigitos, mesmoTelefone } from '@/lib/conversas/telefone'
import { extractTextFromImage, extractTextFromPdf, completionJSON } from '@/lib/anthropic/client'
import { dadosComprovanteSchema, sugerirParcela, type DadosComprovante } from '@/lib/financeiro/comprovante'

// POST /api/financeiro/comprovante — lê um comprovante anexado na conversa
// (imagem via relay -> OCR Haiku -> completionJSON) e SUGERE a parcela aberta
// que melhor casa. INVARIANTE DURA: NÃO dá baixa e não grava nada — a baixa
// acontece só na confirmação humana (rota /parcelas/[id]/baixa).
// LGPD: nunca logar texto/valores do comprovante — só ids e contagens.

const ROLES = ['admin', 'advogado', 'colaborador']

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type MediaType = (typeof MEDIA_TYPES)[number]

const schema = z.object({
  // O modal envia o id numérico do Chatwoot — aceita número ou string.
  conversaId: z.coerce.string().trim().min(1).max(100),
  anexoUrl: z.string().url().max(2000),
  // Sem telefone (conversa não vinculada a cliente) ainda dá para extrair os
  // dados — só não há parcela para sugerir.
  telefone: z.string().trim().min(1).max(30).nullish(),
})

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

export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, user, usuario } = auth

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { conversaId, anexoUrl } = parsed.data
  const telefone = parsed.data.telefone && apenasDigitos(parsed.data.telefone) ? parsed.data.telefone : null

  // 1) Bytes do anexo via relay (server-only; segredos nunca chegam ao browser).
  // O relay identifica o agente pelo X-Simas-User-Email — mesma guarda da rota
  // irmã /api/conversas/anexos (header vazio geraria erro confuso ou busca anônima).
  if (!user.email) return jsonError('E-mail do usuário ausente na sessão', 400)
  const anexo = await relayFetchBinario('/attachments', {
    email: user.email,
    query: { url: anexoUrl },
  })
  if (anexo.status < 200 || anexo.status >= 300 || !anexo.buffer) {
    // Repassa o status do relay (ex.: 404 ATTACHMENTS_DISABLED, 502, 503).
    return jsonError('Não foi possível obter o anexo da conversa', anexo.status >= 400 ? anexo.status : 502)
  }

  const contentType = (anexo.contentType ?? '').split(';')[0].trim().toLowerCase()

  // 2) OCR (Haiku) — imagem ou PDF.
  let textoOCR: string
  try {
    if (contentType === 'application/pdf') {
      textoOCR = await extractTextFromPdf({ pdfBase64: anexo.buffer.toString('base64') })
    } else if ((MEDIA_TYPES as readonly string[]).includes(contentType)) {
      textoOCR = await extractTextFromImage({
        imageBase64: anexo.buffer.toString('base64'),
        mediaType: contentType as MediaType,
      })
    } else {
      return jsonError('Tipo de anexo não suportado para leitura (esperado imagem ou PDF)', 415)
    }
  } catch (err) {
    logger.error('financeiro.comprovante.ocr_falha', { conversaId, tenantId: usuario.tenant_id }, err)
    return jsonError('Erro ao ler o anexo com a IA. Tente novamente.', 502)
  }
  if (!textoOCR.trim()) {
    return jsonError('Não foi possível ler texto no anexo', 422)
  }

  // 3) Estruturação em JSON validado (zod).
  let dados: DadosComprovante
  try {
    const { result } = await completionJSON({
      system: SYSTEM_EXTRACAO,
      prompt: `Texto OCR do anexo:\n\n${textoOCR}`,
      maxTokens: 1024,
      schema: respostaIASchema,
    })
    if ('naoComprovante' in result) {
      return jsonError('O anexo não parece ser um comprovante de pagamento', 422)
    }
    dados = result
  } catch (err) {
    logger.error('financeiro.comprovante.extracao_falha', { conversaId, tenantId: usuario.tenant_id }, err)
    return jsonError('Não foi possível extrair os dados do comprovante', 422)
  }

  // 4) Casa o cliente pelo telefone da conversa (padrão do /api/conversas/contexto).
  let cliente: { id: string; nome: string | null; telefone: string | null } | null = null
  if (telefone) {
    const { data: clientes, error: erroClientes } = await supabase
      .from('clientes')
      .select('id, nome, telefone')
      .eq('tenant_id', usuario.tenant_id)
      .is('deleted_at', null)
      .not('telefone', 'is', null)
      .order('created_at', { ascending: true })
    if (erroClientes) return jsonError(erroClientes.message, 500)
    cliente = (clientes ?? []).find((c) => mesmoTelefone(c.telefone, telefone)) ?? null
  }

  if (!cliente) {
    return NextResponse.json({ dados, cliente: null, sugestao: null, alternativas: [] })
  }

  // 5) Sugere a melhor parcela aberta (valor exato > ±1%; nunca dá baixa).
  const { data: abertas, error: erroParcelas } = await supabase
    .from('parcelas')
    .select('id, descricao, valor_centavos, vencimento')
    .eq('tenant_id', usuario.tenant_id)
    .eq('cliente_id', cliente.id)
    .eq('status', 'aberta')
    .order('vencimento', { ascending: true })
  if (erroParcelas) return jsonError(erroParcelas.message, 500)

  const lista = abertas ?? []
  const sugestao = sugerirParcela(dados, lista)
  const alternativas = lista.filter((p) => p.id !== sugestao?.id)

  logger.info('financeiro.comprovante.lido', {
    conversaId,
    tenantId: usuario.tenant_id,
    clienteId: cliente.id,
    temSugestao: !!sugestao,
    abertas: lista.length,
  })

  return NextResponse.json({
    dados,
    cliente: { id: cliente.id, nome: cliente.nome },
    sugestao,
    alternativas,
  })
}
