// Núcleo de orquestração compartilhado pelos endpoints de geração/refino de
// peças (gerar-peca, refinamento-peca, refinar-peca, correcao-auto).
//
// NÃO contém prompts — só a "fiação" comum: status inicial, aumento do prompt
// com modelo/jurisprudência, resposta SSE, log de uso pós-stream e
// versionamento. Cada endpoint é um adaptador fino (modo: criar | refinar |
// corrigir) sobre estes helpers + o registro de prompts curados.

import { after } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/anthropic/usage'
import { formatarPeca } from '@/lib/format/formatar-peca'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

/**
 * Rede de segurança pós-stream (B2): salva o conteúdo da peça NO SERVIDOR ao fim
 * da geração, caso o cliente não tenha salvo (aba fechada/queda no meio do
 * stream deixava a peça vazia no banco). É ADITIVA — o caminho feliz continua
 * salvando pelo cliente; aqui só grava se a peça ainda estiver sem conteúdo.
 *
 * Roda em after() (após a resposta, mesmo se o cliente desconectar) e usa o
 * service_role (o contexto de cookies do request já não está disponível).
 */
export function salvarPecaPosStreamSeVazia(params: {
  getFinal: () => Promise<{ text: string }>
  pecaId: string
  atendimentoId: string
}): void {
  after(async () => {
    try {
      const { text } = await params.getFinal()
      if (!text.trim()) return

      const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )

      const { data: atual } = await admin
        .from('pecas')
        .select('conteudo_markdown')
        .eq('id', params.pecaId)
        .single()

      // Caminho feliz: o cliente já salvou — nada a fazer.
      if (atual?.conteudo_markdown) return

      await admin
        .from('pecas')
        .update({ conteudo_markdown: formatarPeca(text) })
        .eq('id', params.pecaId)
      await admin
        .from('atendimentos')
        .update({ status: 'peca_gerada' })
        .eq('id', params.atendimentoId)

      console.warn(`[motor] rede de segurança salvou peça ${params.pecaId} (cliente não salvou).`)
    } catch (e) {
      console.error('[motor] rede de segurança pós-stream falhou:', e instanceof Error ? e.message : e)
    }
  })
}

/** Status inicial da peça: colaborador cai na fila de revisão; demais, rascunho. */
export function statusInicialPeca(role: string | undefined): 'aguardando_revisao' | 'rascunho' {
  return role === 'colaborador' ? 'aguardando_revisao' : 'rascunho'
}

/**
 * Anexa ao prompt, quando presentes, o modelo padrão do escritório (como
 * referência de estrutura) e a jurisprudência encontrada. Texto idêntico ao
 * que era duplicado em gerar-peca.
 */
export function anexarModeloEJurisprudencia(
  prompt: string,
  opts: { modeloPadrao?: string | null; jurisprudenciaTexto?: string | null },
): string {
  let out = prompt
  if (opts.modeloPadrao) {
    out += `\n\n## MODELO DE REFERÊNCIA DO ESCRITÓRIO\nUse o modelo abaixo apenas como REFERÊNCIA DE ESTRUTURA (seções, ordem e tom de escrita) — NÃO copie o conteúdo dele. A apresentação visual (fonte, margens, entrelinha, recuo) é aplicada automaticamente na exportação; não tente reproduzi-la no texto. Adapte a estrutura ao caso concreto:\n\n${opts.modeloPadrao}`
  }
  if (opts.jurisprudenciaTexto) {
    out += `\n\n${opts.jurisprudenciaTexto}\n\nUse a jurisprudência acima como referência para fundamentar a peça. Cite os processos relevantes quando aplicável.`
  }
  return out
}

/**
 * Resposta SSE padrão da geração de peça. Quando há peça criada, expõe o
 * cabeçalho X-Peca-Id (consumido pelo cliente para abrir o editor).
 */
export function respostaStreamPeca(stream: ReadableStream, pecaId?: string): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  }
  if (pecaId !== undefined) {
    headers['X-Peca-Id'] = pecaId
    headers['Access-Control-Expose-Headers'] = 'X-Peca-Id'
  }
  return new Response(stream, { headers })
}

/**
 * Registra o uso de tokens após o término do stream, sem bloquear a resposta.
 * Reproduz o padrão getUsage().then(logUsage).catch(console.error).
 */
export function logUsagePosStream(params: {
  getUsage: () => Promise<{ input: number; output: number }>
  tenantId: string
  userId: string
  endpoint: string
  modelo: string
  start: number
}): void {
  params.getUsage().then(async (usage) => {
    await logUsage({
      tenantId: params.tenantId,
      userId: params.userId,
      endpoint: params.endpoint,
      modelo: params.modelo,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      latenciaMs: Date.now() - params.start,
    })
  }).catch((e) => console.error(`[logUsage] erro pós-stream (${params.endpoint}):`, e))
}

/**
 * Salva a versão atual da peça em pecas_versoes antes de sobrescrevê-la.
 * Usado por correcao-auto e refinar-peca (modo: corrigir/refinar).
 */
export async function salvarVersaoAnterior(
  supabase: SupabaseServer,
  params: { pecaId: string; versao: number; conteudoMarkdown: string | null; usuarioId: string },
): Promise<void> {
  await supabase.from('pecas_versoes').insert({
    peca_id: params.pecaId,
    versao: params.versao,
    conteudo_markdown: params.conteudoMarkdown,
    alterado_por: params.usuarioId,
  })
}
