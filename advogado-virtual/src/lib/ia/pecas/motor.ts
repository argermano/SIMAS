// Núcleo de orquestração compartilhado pelos endpoints de geração/refino de
// peças (gerar-peca, refinamento-peca, refinar-peca, correcao-auto).
//
// NÃO contém prompts próprios — só a "fiação" comum: status inicial, aumento do
// prompt com modelo/jurisprudência, resposta SSE, log de uso pós-stream,
// versionamento e a COMPOSIÇÃO dos modos (montarPromptDoModo). Cada endpoint é
// um adaptador fino (modo: criar | refinar | corrigir) sobre estes helpers + o
// contexto do caso (./contexto.ts) + o registro de prompts curados.

import { after } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/anthropic/usage'
import { formatarPeca } from '@/lib/format/formatar-peca'
import { logger } from '@/lib/logger'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { SYSTEM_MODO_REFINAR, buildPromptModoRefinar } from '@/lib/prompts/pecas/_shared/modo-refinar'
import { SYSTEM_MODO_CORRIGIR, buildPromptModoCorrigir } from '@/lib/prompts/pecas/_shared/modo-corrigir'
import type { ContextoPeca } from './contexto'
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
  /**
   * Refino da MESMA peça (modo 'refinar'): aqui a peça JÁ tem conteúdo, então a
   * rede não pode olhar só "está vazia?" — ela cobre exclusivamente o ABANDONO.
   * Só grava se o conteúdo no banco continuar sendo EXATAMENTE o de antes do
   * stream; se o cliente já salvou (fluxo normal, com a guarda anti-encolhimento
   * da camada C), não encosta na peça.
   */
  refino?: { conteudoAnterior: string | null; versaoAnterior: number }
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

      if (params.refino) {
        // Refino: o cliente já persistiu o texto novo → nada a fazer. Comparar o
        // conteúdo (e não só "não vazio") é o que impede sobrescrever em silêncio
        // uma edição do advogado feita durante o stream.
        if ((atual?.conteudo_markdown ?? '') !== (params.refino.conteudoAnterior ?? '')) return
      } else if (atual?.conteudo_markdown) {
        // Geração: caminho feliz — o cliente já salvou.
        return
      }

      // Última linha de defesa: um blip transitório no banco não pode custar a
      // peça, então persiste com 1 retry (o builder do supabase-js não lança
      // sozinho — o helper surfa o error do PostgREST para o retry/catch verem).
      await gravarPecaComRetry(admin, {
        pecaId: params.pecaId,
        atendimentoId: params.atendimentoId,
        conteudoMarkdown: formatarPeca(text),
        // No refino a peça sobrevive à rodada: a versão anterior já foi
        // arquivada em pecas_versoes antes do stream, então aqui só avança o nº.
        novaVersao: params.refino ? params.refino.versaoAnterior + 1 : undefined,
        // ...e o caso NÃO volta para 'peca_gerada': refinar uma peça de um
        // atendimento finalizado não pode reabrir o caso pelas costas.
        marcarAtendimento: !params.refino,
      })

      logger.warn('ia.pecas.rede_seguranca.salvou', {
        pecaId: params.pecaId,
        atendimentoId: params.atendimentoId,
        modo: params.refino ? 'refino' : 'criacao',
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
  params: {
    pecaId: string
    atendimentoId: string
    conteudoMarkdown: string
    novaVersao?: number
    /** Marca o atendimento como 'peca_gerada' (só na criação — ver refino). */
    marcarAtendimento?: boolean
  },
): Promise<void> {
  const gravar = async () => {
    const patch: Record<string, unknown> = { conteudo_markdown: params.conteudoMarkdown }
    if (params.novaVersao !== undefined) patch.versao = params.novaVersao
    const up = await admin
      .from('pecas')
      .update(patch)
      .eq('id', params.pecaId)
    if (up.error) throw erroPersistencia('pecas', up.status, up.error.code)
    if (params.marcarAtendimento === false) return
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
  // As parcelas de cache são opcionais: só chegam preenchidas quando a chamada
  // pediu `cache` no client (rodadas 2+ da sessão de lapidação).
  getUsage: () => Promise<{ input: number; output: number; cacheRead?: number; cacheWrite?: number }>
  tenantId: string
  userId: string
  endpoint: string
  modelo: string
  start: number
  sessaoId?: string | null
  turnoId?: string | null
}): void {
  params.getUsage().then(async (usage) => {
    await logUsage({
      tenantId: params.tenantId,
      userId: params.userId,
      endpoint: params.endpoint,
      modelo: params.modelo,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      tokensCacheRead: usage.cacheRead,
      tokensCacheWrite: usage.cacheWrite,
      sessaoId: params.sessaoId,
      turnoId: params.turnoId,
      latenciaMs: Date.now() - params.start,
    })
  }).catch((e) => console.error(`[logUsage] erro pós-stream (${params.endpoint}):`, e))
}

/** De onde veio a versão arquivada (coluna `origem` da migration 085). */
export type OrigemVersao = 'manual' | 'sessao' | 'correcao' | 'refino'

/**
 * Salva a versão atual da peça em pecas_versoes antes de sobrescrevê-la.
 * Usado pelo refino (modo 'refinar') e pela aplicação de proposta da sessão de
 * lapidação (origem='sessao'), que registram também a ORIGEM e a INSTRUÇÃO do
 * advogado — o rastro do "porquê" daquela versão (085).
 *
 * Nunca duplica: se aquele número de versão já está arquivado (o refino grava a
 * linha antes do stream), a chamada é no-op — cada versão tem UMA linha, e a
 * que já existe é a que carrega o "porquê". Mesma regra do salvar-peca.
 */
export async function salvarVersaoAnterior(
  supabase: SupabaseServer,
  params: {
    pecaId: string
    versao: number
    conteudoMarkdown: string | null
    usuarioId: string
    origem?: OrigemVersao
    instrucao?: string | null
    /** Sessão de lapidação que originou a versão (origem='sessao'). */
    sessaoId?: string | null
    /** Turno da sessão que originou a versão. */
    turnoId?: string | null
  },
): Promise<void> {
  const { data: jaArquivada } = await supabase
    .from('pecas_versoes')
    .select('id')
    .eq('peca_id', params.pecaId)
    .eq('versao', params.versao)
    .limit(1)
    .maybeSingle()
  if (jaArquivada) return

  await supabase.from('pecas_versoes').insert({
    peca_id: params.pecaId,
    versao: params.versao,
    conteudo_markdown: params.conteudoMarkdown,
    alterado_por: params.usuarioId,
    origem: params.origem ?? 'manual',
    instrucao: params.instrucao ?? null,
    sessao_id: params.sessaoId ?? null,
    turno_id: params.turnoId ?? null,
  })
}

// ─── Modos do motor único (F0.2) ────────────────────────────────────────────

/**
 * Os três modos do motor de peças. TODOS usam o mesmo contexto do caso
 * (montarContextoPeca) e mudam apenas a composição do prompt:
 *  • 'criar'    — redige a peça do zero (prompt curado da área/tipo + modelo do
 *                 escritório + jurisprudência + fundamentação verificada).
 *  • 'refinar'  — reescreve uma peça existente sob a instrução do advogado.
 *  • 'corrigir' — aplica uma das correções automáticas do editor.
 */
export type ModoMotor = 'criar' | 'refinar' | 'corrigir'

/** Entradas específicas do modo (o contexto do caso vem no ContextoPeca). */
export interface EntradaModo {
  /** refinar/corrigir: conteúdo atual da peça. */
  pecaAtual?: string
  /** refinar: instrução do advogado para esta rodada. */
  instrucao?: string
  /** corrigir: remover_citacao | completar_item | ajustar_pedido. */
  tipoCorrecao?: string
}

/**
 * Compõe o par (system, prompt) do modo. É PURA — nenhum acesso a banco ou
 * rede — justamente para os snapshots poderem travar o texto byte a byte.
 *
 * O modo 'criar' reproduz EXATAMENTE o que a rota gerar-peca fazia inline:
 * promptBase + modelo padrão + jurisprudência + fundamentação verificada.
 * O modo 'corrigir' não usa contexto do caso (a correção só olha a peça).
 */
export function montarPromptDoModo(
  modo: ModoMotor,
  ctx: ContextoPeca | null,
  entrada: EntradaModo = {},
): { system: string; prompt: string } {
  if (modo === 'corrigir') {
    return {
      system: SYSTEM_MODO_CORRIGIR,
      prompt: buildPromptModoCorrigir(entrada.pecaAtual ?? '', entrada.tipoCorrecao ?? ''),
    }
  }

  if (!ctx) throw new Error(`montarPromptDoModo('${modo}') exige o contexto do caso`)

  if (modo === 'refinar') {
    // Quando existe prompt curado para (área, tipo), ele entra ANTES do bloco de
    // refino: a persona/estrutura da área continua valendo, o modo só acrescenta
    // "reescreva preservando o padrão do advogado". Sem curado (ex.: peça colada
    // de fora, tipo 'refinamento'), o system é só o do modo.
    return {
      system: ctx.meta.curado ? `${ctx.system}\n\n${SYSTEM_MODO_REFINAR}` : SYSTEM_MODO_REFINAR,
      prompt: buildPromptModoRefinar({
        areaNome: AREAS[ctx.meta.area as AreaId]?.nome ?? ctx.meta.area,
        pecaAtual: entrada.pecaAtual ?? '',
        documentos: ctx.documentosContexto,
        instrucoes: entrada.instrucao,
      }),
    }
  }

  return {
    system: ctx.system,
    prompt:
      anexarModeloEJurisprudencia(ctx.promptBase, {
        modeloPadrao: ctx.meta.modeloPadrao,
        jurisprudenciaTexto: ctx.meta.jurisprudenciaTexto,
      }) + ctx.meta.blocoFundamentacao,
  }
}
