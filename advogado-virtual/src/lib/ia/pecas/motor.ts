// Núcleo de orquestração compartilhado pelos endpoints de geração/refino de
// peças (gerar-peca, refinamento-peca, refinar-peca, correcao-auto).
//
// NÃO contém prompts — só a "fiação" comum: status inicial, aumento do prompt
// com modelo/jurisprudência, resposta SSE, log de uso pós-stream e
// versionamento. Cada endpoint é um adaptador fino (modo: criar | refinar |
// corrigir) sobre estes helpers + o registro de prompts curados.

import { after } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/anthropic/usage'
import { formatarPeca } from '@/lib/format/formatar-peca'
import { logger } from '@/lib/logger'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>
// Mesma instância de schema que createAdminClient(url, key) infere no call site
// (schema 'public'); ReturnType sem args cairia no genérico default (never) e
// faria .update() aceitar `never`.
type SupabaseAdmin = ReturnType<typeof createAdminClient<any, 'public'>>

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
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    try {
      const { text } = await params.getFinal()
      if (!text.trim()) return

      const { data: atual } = await admin
        .from('pecas')
        .select('conteudo_markdown')
        .eq('id', params.pecaId)
        .single()

      // Caminho feliz: o cliente já salvou — nada a fazer.
      if (atual?.conteudo_markdown) return

      // Última linha de defesa: um blip transitório no banco não pode custar a
      // peça, então persiste com 1 retry (o builder do supabase-js não lança
      // sozinho — o helper surfa o error do PostgREST para o retry/catch verem).
      await gravarPecaComRetry(admin, {
        pecaId: params.pecaId,
        atendimentoId: params.atendimentoId,
        conteudoMarkdown: formatarPeca(text),
      })

      logger.warn('ia.pecas.rede_seguranca.salvou', {
        pecaId: params.pecaId,
        atendimentoId: params.atendimentoId,
      })
    } catch (e) {
      // Falha do fallback do fallback: o usuário já recebeu "sucesso" e a peça
      // se perderia em silêncio. Alerta estruturado + Sentry (perda de trabalho,
      // não ruído) e marca a peça como recuperável para a UI oferecer regerar.
      // LGPD: só ids no contexto — nunca o texto da peça, nome ou telefone.
      logger.error('ia.pecas.rede_seguranca.falha', {
        pecaId: params.pecaId,
        atendimentoId: params.atendimentoId,
      }, e)
      Sentry.captureException(
        e instanceof Error ? e : new Error('rede de segurança pós-stream de peça falhou'),
        {
          tags: { area: 'ia_pecas', efeito: 'rede_seguranca_pos_stream' },
          extra: { pecaId: params.pecaId, atendimentoId: params.atendimentoId },
        },
      )
      // Marca best-effort do estado recuperável (072). Se ISTO também falhar,
      // não há mais o que fazer além de logar — não relança em after().
      const { error: errMarca } = await admin
        .from('pecas')
        .update({ rede_seguranca_erro_at: new Date().toISOString() })
        .eq('id', params.pecaId)
      if (errMarca) {
        logger.error('ia.pecas.rede_seguranca.marca_falha', { pecaId: params.pecaId }, errMarca)
      }
    }
  })
}

/**
 * Normaliza a falha de um UPDATE como Error de verdade: o `error` do supabase-js
 * (sem .throwOnError()) é objeto simples, não instância de Error — sem isto,
 * logger/Sentry veriam só "[object Object]" e um Error genérico, perdendo a causa.
 * LGPD: carrega só tabela + status HTTP + código PostgREST/PG (classificadores),
 * nunca `message`/`details`, que podem ecoar valores da linha.
 */
function erroPersistencia(tabela: 'pecas' | 'atendimentos', status: number, code: string): Error {
  const err = new Error(`persistência da rede de segurança falhou (${tabela}, status=${status}, code=${code || '?'})`)
  err.name = 'RedeSegurancaPersistError'
  return err
}

/**
 * Grava o conteúdo da peça e marca o atendimento como `peca_gerada`, checando o
 * `error` de cada UPDATE (o query builder do supabase-js NÃO lança por conta
 * própria) e refazendo AMBOS os UPDATEs uma vez em caso de falha — os dois são
 * idempotentes, então repetir é seguro. Lança se a segunda tentativa também
 * falhar: quem chama decide o alerta.
 */
async function gravarPecaComRetry(
  admin: SupabaseAdmin,
  params: { pecaId: string; atendimentoId: string; conteudoMarkdown: string },
): Promise<void> {
  const gravar = async () => {
    const up = await admin
      .from('pecas')
      .update({ conteudo_markdown: params.conteudoMarkdown })
      .eq('id', params.pecaId)
    if (up.error) throw erroPersistencia('pecas', up.status, up.error.code)
    const upAtend = await admin
      .from('atendimentos')
      .update({ status: 'peca_gerada' })
      .eq('id', params.atendimentoId)
    if (upAtend.error) throw erroPersistencia('atendimentos', upAtend.status, upAtend.error.code)
  }
  try {
    await gravar()
  } catch {
    logger.warn('ia.pecas.rede_seguranca.retry', { pecaId: params.pecaId })
    await gravar()
  }
}

// A revisão automática NÃO roda mais no after() da geração — isso adicionava um
// 2º processamento de IA ao orçamento de tempo da função e, no plano grátis da
// Vercel (teto de 60s), empurrava a geração para o timeout, cortando a peça pela
// metade. Agora a revisão é disparada DESACOPLADA, pelo editor, numa chamada
// separada a /api/ia/validar-peca (modo auto). Ver EditorPecaClient.

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
    out += `\n\n${opts.jurisprudenciaTexto}\n\nUse os dados acima APENAS como estatística de litigiosidade do tema — jamais como fundamentação citável. NÃO cite os números de processo do DataJud como precedente e NÃO invente ementas a partir deles. Qualquer jurisprudência (súmula, acórdão, ementa) que você mencionar de conhecimento próprio DEVE vir marcada com [VERIFICAR], para conferência humana — nunca apresente como confirmada uma decisão que não foi fornecida no material do caso.`
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
