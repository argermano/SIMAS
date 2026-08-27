// Montagem da RODADA da sessão de lapidação (F0.3) — pura e testável.
//
// A rodada é UMA chamada multi-turno. A ordem das mensagens não é estética: é o
// que faz o cache de prompt funcionar (§6.5 do plano). A API casa o cache por
// PREFIXO, então o que é estável vem primeiro e o que muda a cada rodada vem
// depois do último breakpoint:
//
//   system            → curado + modo refinar + sessão   (breakpoint de cache)
//   messages[0] user  → CONTEXTO DO CASO: qualificação + dossiê + anexos
//                       (breakpoint de cache — é o bloco caro, ~dezenas de
//                        milhares de tokens, e não muda dentro da sessão)
//   messages[1..n]    → histórico da conversa (cresce, mas só no fim)
//   messages[último]  → PEÇA ATUAL + instrução desta rodada
//
// Por que a PEÇA fica no fim, e não no prefixo estável: ela muda toda vez que o
// advogado aceita uma proposta. No prefixo, cada aceite invalidaria o cache do
// dossiê inteiro; no fim, o aceite custa só o reenvio da peça — e, de quebra, o
// agente sempre enxerga o texto VERDADEIRO da peça, nunca uma cópia velha
// presa no histórico.

import { MAX_PROMPT_CHARS, type MensagemIA } from '@/lib/anthropic/client'
import { formatarQualificacao, MAX_CHARS_POR_DOC } from '@/lib/prompts/pecas/_shared/qualificacao'
import { dividirSecoes } from '@/lib/diff/secoes'
import type { ContextoPeca } from '@/lib/ia/pecas/contexto'

/** Documento do dossiê/anexo como a sessão o enxerga. */
export interface DocumentoSessao {
  id: string
  file_name: string
  tipo: string
  texto_extraido: string | null
  /** Resumo Haiku (documentos > MAX_CHARS_POR_DOC). Ver src/lib/documentos/resumir.ts. */
  resumo_ia?: string | null
  /** Anexado pelo advogado NESTA sessão (aparece com destaque no bloco). */
  anexado?: boolean
}

/** Turno já persistido, no formato mínimo que a remontagem do histórico usa. */
export interface TurnoHistorico {
  papel: 'advogado' | 'agente' | 'sistema'
  /**
   * Blocos de texto gravados em `pecas_turnos.payload.blocos` — a forma
   * canônica de reproduzir a rodada no histórico. Turnos sem blocos (o turno 0
   * de abertura, os turnos de custo) não entram na conversa.
   */
  blocos?: string[] | null
}

/** Um documento entra inteiro ou como resumo? */
export function documentoGrande(doc: DocumentoSessao): boolean {
  return (doc.texto_extraido ?? '').length > MAX_CHARS_POR_DOC
}

/**
 * Bloco de documentos da sessão. Documento pequeno entra INTEIRO; documento
 * grande entra pelo `resumo_ia` com o aviso de que a íntegra existe — é o que
 * substitui o "estourou o limite de 100 arquivos" do claude.ai por algo que o
 * advogado controla (ele pede o trecho que faltar).
 */
export function blocoDocumentosSessao(documentos: DocumentoSessao[]): string {
  if (documentos.length === 0) return 'Nenhum documento no dossiê deste caso.'

  return documentos
    .map((d) => {
      const texto = (d.texto_extraido ?? '').trim()
      const marca = d.anexado ? ' — ANEXADO PELO ADVOGADO NESTA SESSÃO' : ''
      const cabecalho = `- ${d.file_name} (${d.tipo})${marca}:`
      if (!texto) return `${cabecalho}\nsem texto extraído`
      if (!documentoGrande(d)) return `${cabecalho}\n${texto}`

      const resumo = (d.resumo_ia ?? '').trim()
      const corpo = resumo
        ? `RESUMO (documento com ${texto.length.toLocaleString('pt-BR')} caracteres — íntegra disponível; peça os trechos que precisar):\n${resumo}`
        : `${texto.slice(0, MAX_CHARS_POR_DOC)}\n[...documento truncado em ${MAX_CHARS_POR_DOC.toLocaleString('pt-BR')} caracteres — íntegra disponível; peça os trechos que precisar]`
      return `${cabecalho}\n${corpo}`
    })
    .join('\n\n')
}

/**
 * Primeiro turno `user`: o CONTEXTO DO CASO. É o bloco que recebe o breakpoint
 * de cache, então precisa ser determinístico — sem data, sem contador, sem
 * ordem variável (os documentos chegam ordenados por quem chama).
 */
export function montarPrefixoContexto(params: {
  ctx: ContextoPeca | null
  documentos: DocumentoSessao[]
  areaNome: string
  tipoNome: string
}): string {
  const partes: string[] = [
    '# MATERIAL DO CASO (referência estável desta sessão)',
    '',
    `Peça em trabalho: ${params.tipoNome} — ${params.areaNome}.`,
    '',
    '## QUALIFICAÇÃO DAS PARTES',
    params.ctx ? formatarQualificacao(params.ctx.meta.qualificacao) : 'Não disponível.',
    '',
    '## DOCUMENTOS DO CASO',
    blocoDocumentosSessao(params.documentos),
  ]

  if (params.ctx?.meta.blocoFundamentacao) {
    partes.push('', params.ctx.meta.blocoFundamentacao.trim())
  }

  partes.push(
    '',
    'Aguarde a instrução do advogado. Nas rodadas seguintes, a versão ATUAL da peça vem junto com a instrução — trabalhe sempre sobre ela, nunca sobre uma versão anterior desta conversa.',
  )

  return partes.join('\n')
}

/** Rótulo do papel no histórico (turnos de sistema entram como nota do sistema). */
const PREFIXO_SISTEMA = '[registro do sistema] '

/**
 * Reconstrói a conversa a partir dos turnos persistidos. Papel 'agente' vira
 * `assistant`; 'advogado' e 'sistema' viram `user` (o segundo com prefixo, para
 * o modelo distinguir a nota de sistema de uma fala do advogado). Turnos
 * consecutivos do mesmo papel são permitidos pela API — não há normalização
 * artificial aqui, que só embaralharia a ordem real dos fatos.
 */
export function historicoParaMensagens(turnos: TurnoHistorico[]): MensagemIA[] {
  const msgs: MensagemIA[] = []
  for (const t of turnos) {
    const blocos = (t.blocos ?? []).filter((b) => typeof b === 'string' && b.trim())
    if (blocos.length === 0) continue
    const texto = blocos.join('\n\n')
    msgs.push({
      role: t.papel === 'agente' ? 'assistant' : 'user',
      content: t.papel === 'sistema' ? `${PREFIXO_SISTEMA}${texto}` : texto,
    })
  }
  return msgs
}

/** Último turno `user`: a peça de verdade + a instrução da rodada. */
export function montarTurnoDaRodada(params: {
  pecaAtual: string
  versao: number
  instrucao: string
}): string {
  const titulos = dividirSecoes(params.pecaAtual)
    .filter((s) => s.titulo)
    .map((s) => `- ${s.titulo}`)

  return [
    `## PEÇA ATUAL (versão ${params.versao}) — é sobre ESTE texto que você trabalha`,
    params.pecaAtual,
    '',
    '### Títulos das seções da peça',
    titulos.length ? titulos.join('\n') : '(a peça ainda não tem seções com título)',
    'Use EXATAMENTE um destes títulos no campo `titulo` de cada operação da proposta.',
    '',
    '## INSTRUÇÃO DO ADVOGADO (esta rodada)',
    params.instrucao.trim(),
  ].join('\n')
}

/** Tamanho em caracteres de uma conversa (mesma conta do teto do client). */
export function tamanhoMensagens(messages: MensagemIA[]): number {
  let total = 0
  for (const m of messages) {
    if (typeof m.content === 'string') { total += m.content.length; continue }
    for (const bloco of m.content) if (bloco.type === 'text') total += bloco.text.length
  }
  return total
}

/** Quantas trocas recentes o corte local sempre preserva. */
export const MIN_HISTORICO_PRESERVADO = 4

export interface RodadaMontada {
  /** Conversa completa (contexto + histórico + rodada) — o que a API recebe. */
  messages: MensagemIA[]
  /** Só o histórico, JÁ compactado — é o que vai para o driver. */
  historico: MensagemIA[]
  /** Mensagens antigas do histórico descartadas para caber no teto. */
  cortadas: number
  /** Caracteres totais (system + mensagens) — base da estimativa de custo. */
  chars: number
}

/**
 * Monta as mensagens da rodada e, se necessário, COMPACTA LOCALMENTE o
 * histórico para caber em MAX_PROMPT_CHARS: descarta as mensagens mais antigas
 * (preservando as últimas MIN_HISTORICO_PRESERVADO) até caber. O contexto do
 * caso e a rodada atual nunca são cortados — se nem assim couber, quem chama
 * recebe `chars` acima do teto e o client responde 413 com a mensagem certa
 * (reduzir documentos), que é a verdade do que aconteceu.
 *
 * TODO (melhoria futura): trocar o corte local pela compaction server-side da
 * API (beta `compact-2026-01-12`), que resume em vez de descartar — §6.6 do
 * plano. Exige preservar `response.content` (blocos de compaction) no histórico.
 */
export function montarRodada(params: {
  system: string
  prefixoContexto: string
  historico: MensagemIA[]
  turnoAtual: string
  teto?: number
}): RodadaMontada {
  const teto = params.teto ?? MAX_PROMPT_CHARS
  const fixas = {
    inicio: { role: 'user', content: params.prefixoContexto } as MensagemIA,
    fim: { role: 'user', content: params.turnoAtual } as MensagemIA,
  }

  let historico = [...params.historico]
  let cortadas = 0

  const montar = () => [fixas.inicio, ...historico, fixas.fim]
  const total = () => params.system.length + tamanhoMensagens(montar())

  while (total() > teto && historico.length > MIN_HISTORICO_PRESERVADO) {
    historico = historico.slice(1)
    cortadas++
  }

  const messages = montar()
  return {
    messages,
    historico,
    cortadas,
    chars: params.system.length + tamanhoMensagens(messages),
  }
}
