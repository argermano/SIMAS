import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { createClient } from '@/lib/supabase/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logger } from '@/lib/logger'
import { completionJSON } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { extrairTextoPlano } from '@/lib/processos/djen'
import {
  SYSTEM_SUGESTOES,
  SUGESTOES_VERSAO,
  buildPromptSugestoes,
  cacheAtual,
  sanitizarSugestoes,
  type SugestoesIA,
} from '@/lib/publicacoes/sugestoes-prompt'

// Leitura jurídica pontual (sob demanda) — modelo capaz por qualidade de leitura,
// custo controlado pelo cache (1 geração por publicação) e ausência de lote/cron.
const MODELO_SUGESTOES = 'claude-sonnet-5'
const MAX_TOKENS = 3000
const MIN_TEXTO = 40

export const maxDuration = 60

const schema = z.object({
  // Força UMA re-geração (ignora e sobrescreve o cache). Default: usa o cache.
  regerar: z.boolean().optional(),
})

const VAZIAS: SugestoesIA = { v: SUGESTOES_VERSAO, trechos: [], tarefas: [], resumo: '' }

/**
 * POST /api/publicacoes/[id]/sugerir — sugestões de IA para o tratamento
 * (admin/advogado). Devolve o CACHE (`sugestoes_ia`) se já existir; com
 * `{ regerar: true }` força uma re-geração. Gera via IA sobre o TEXTO PLANO do
 * inteiro teor; valida server-side (citações substring + data SUGERIDA por
 * formato/janela + fundamento) e persiste. LGPD: nunca loga o texto — só ids/contagens.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate

  const { id } = await params

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { regerar } = parsed.data

  const { data: pub } = await supabase
    .from('publicacoes')
    .select('id, texto, data_disponibilizacao, data_publicacao_sugerida, sugestoes_ia, sugestoes_geradas_em')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id) // defesa em profundidade (RLS já isola)
    .single()

  if (!pub) return jsonError('Publicação não encontrada.', 404)

  const row = pub as {
    id: string
    texto: string | null
    data_disponibilizacao: string | null
    data_publicacao_sugerida: string | null
    sugestoes_ia: SugestoesIA | null
    sugestoes_geradas_em: string | null
  }

  // Cache: 1 geração por publicação — mas SÓ se casar com a versão atual do payload
  // (caches v1, sem data sugerida, contam como ausentes e regeneram). `regerar` força.
  if (cacheAtual(row.sugestoes_ia) && !regerar) {
    return NextResponse.json({
      sugestoes: row.sugestoes_ia,
      geradasEm: row.sugestoes_geradas_em,
      cache: true,
    })
  }

  const textoPlano = extrairTextoPlano(row.texto)

  // Texto insuficiente: persiste sugestões vazias (evita re-chamar o modelo).
  if (textoPlano.length < MIN_TEXTO) {
    return await persistir(supabase, usuario.tenant_id, id, VAZIAS)
  }

  const start = Date.now()
  let sugestoes: SugestoesIA
  try {
    const { result, usage } = await completionJSON<unknown>({
      system: SYSTEM_SUGESTOES,
      prompt: buildPromptSugestoes(textoPlano, {
        dataDisponibilizacao: row.data_disponibilizacao,
        dataPublicacaoSugerida: row.data_publicacao_sugerida,
      }),
      model: MODELO_SUGESTOES,
      maxTokens: MAX_TOKENS,
    })
    // Validação server-side: descarta citações que não casam (indexOf); a data de
    // prazo é SUGESTÃO (valida formato/janela, exige fundamento) e nunca vira tarefa
    // sem confirmação humana no painel.
    sugestoes = sanitizarSugestoes(result, textoPlano)
    await logUsage({
      tenantId: usuario.tenant_id, userId: usuario.id, endpoint: 'publicacao_sugestoes',
      modelo: MODELO_SUGESTOES, tokensInput: usage.input, tokensOutput: usage.output,
      latenciaMs: Date.now() - start,
    })
  } catch (err) {
    // LGPD: só id/contagens, nunca o texto da publicação.
    logger.error('publicacao.sugerir.falha', { publicacaoId: id }, err)
    return jsonError('Não foi possível gerar as sugestões agora. Tente novamente.', 502)
  }

  return await persistir(supabase, usuario.tenant_id, id, sugestoes)
}

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

/** Grava o cache (best-effort no persist: a resposta segue mesmo se o update falhar). */
async function persistir(
  supabase: SupabaseServer,
  tenantId: string,
  id: string,
  sugestoes: SugestoesIA,
): Promise<NextResponse> {
  const geradasEm = new Date().toISOString()
  const { error } = await supabase
    .from('publicacoes')
    .update({ sugestoes_ia: sugestoes, sugestoes_geradas_em: geradasEm })
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) {
    // O cache não gravou; a UI ainda recebe as sugestões desta rodada.
    logger.error('publicacao.sugerir.cache_falha', { publicacaoId: id }, error)
  }
  return NextResponse.json({ sugestoes, geradasEm, cache: false })
}
