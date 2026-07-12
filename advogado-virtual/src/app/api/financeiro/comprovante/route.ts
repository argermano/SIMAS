import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logger } from '@/lib/logger'
import { relayFetchBinario } from '@/lib/conversas/relay'
import { apenasDigitos, mesmoTelefone } from '@/lib/conversas/telefone'
import { extrairDadosComprovante } from '@/lib/financeiro/extracao'
import { sugerirParcela, type DadosComprovante } from '@/lib/financeiro/comprovante'

// POST /api/financeiro/comprovante — lê um comprovante anexado na conversa
// (imagem via relay -> OCR Haiku -> completionJSON) e SUGERE a parcela aberta
// que melhor casa. INVARIANTE DURA: NÃO dá baixa e não grava nada — a baixa
// acontece só na confirmação humana (rota /parcelas/[id]/baixa).
// A extração (OCR + estruturação) mora em src/lib/financeiro/extracao.ts,
// compartilhada com o recebimento automático (webhook Chatwoot).
// LGPD: nunca logar texto/valores do comprovante — só ids e contagens.

const ROLES = ['admin', 'advogado', 'colaborador']

const schema = z.object({
  // O modal envia o id numérico do Chatwoot — aceita número ou string.
  conversaId: z.coerce.string().trim().min(1).max(100),
  anexoUrl: z.string().url().max(2000),
  // Sem telefone (conversa não vinculada a cliente) ainda dá para extrair os
  // dados — só não há parcela para sugerir.
  telefone: z.string().trim().min(1).max(30).nullish(),
})

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

  // 2) OCR + estruturação (lib compartilhada). Mapeia cada motivo de falha
  // para o mesmo status/mensagem de antes da extração da lib.
  const extracao = await extrairDadosComprovante({
    buffer: anexo.buffer,
    contentType: anexo.contentType ?? '',
  })
  if (!extracao.ok) {
    switch (extracao.motivo) {
      case 'tipo_nao_suportado':
        return jsonError('Tipo de anexo não suportado para leitura (esperado imagem ou PDF)', 415)
      case 'sem_texto':
        return jsonError('Não foi possível ler texto no anexo', 422)
      case 'nao_comprovante':
        return jsonError('O anexo não parece ser um comprovante de pagamento', 422)
      case 'erro_ia':
        if (extracao.fase === 'ocr') {
          logger.error('financeiro.comprovante.ocr_falha', { conversaId, tenantId: usuario.tenant_id })
          return jsonError('Erro ao ler o anexo com a IA. Tente novamente.', 502)
        }
        logger.error('financeiro.comprovante.extracao_falha', { conversaId, tenantId: usuario.tenant_id })
        return jsonError('Não foi possível extrair os dados do comprovante', 422)
    }
  }
  const dados: DadosComprovante = extracao.dados

  // 3) Casa o cliente pelo telefone da conversa (padrão do /api/conversas/contexto).
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

  // 4) Sugere a melhor parcela aberta (valor exato > ±1%; nunca dá baixa).
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
