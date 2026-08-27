// DECISÃO da proposta: o único ponto do Motor v3 em que a sessão toca na peça.
//
// "A IA propõe, o advogado aplica" (§4 do plano) só é verdade se existir um
// lugar — um só — onde a proposta vira versão. É este arquivo. A rodada
// (rodada.ts) nunca grava `pecas.conteudo_markdown`; ela cria propostas
// PENDENTES. Aqui, com o aceite explícito e seção por seção, o texto muda.
//
// Três proteções, todas herdadas do que já existia e todas com escape por
// `forcar` (o advogado é quem manda, mas nunca por acidente):
//   1. CONCORRÊNCIA — a peça mudou desde que a proposta foi calculada
//      (`versao_base` ≠ `pecas.versao`): 409 { pecaMudou: true }.
//   2. ENCOLHIMENTO — o resultado é bem menor que o texto salvo
//      (encolhimentoPerigoso, camada C): 409 { code: 'CONTEUDO_MENOR' }.
//   3. TÍTULO INEXISTENTE — o patch cita uma seção que não está mais lá:
//      PatchSecaoError (409), com a lista de seções disponíveis.

import { aplicarPatchSecoes, descreverPatch, PatchSecaoError, type SecaoPatch } from '@/lib/diff/patch-secoes'
import { normalizarTitulo } from '@/lib/diff/secoes'
import { encolhimentoPerigoso } from '@/lib/ia/pecas/guarda-encolhimento'
import { salvarVersaoAnterior } from '@/lib/ia/pecas/motor'
import { calcularTaxaEdicao } from '@/lib/telemetria/taxa-edicao'
import { logger } from '@/lib/logger'
import {
  inserirTurno,
  tocarSessao,
  type PecaDaSessao,
  type PropostaPeca,
  type SessaoPeca,
  type StatusProposta,
  type SupabaseAdmin,
} from './sessoes'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export type Decisao = 'aceitar' | 'rejeitar'

/** Decisão do advogado sobre UMA seção da proposta. */
export interface DecisaoSecao {
  titulo: string
  decisao: Decisao
}

export interface EntradaDecisao {
  decisoes?: DecisaoSecao[]
  aceitarTudo?: boolean
  rejeitarTudo?: boolean
  /** Confirma por cima dos avisos (peça mudou / conteúdo menor). */
  forcar?: boolean
}

/** Falha esperada da decisão — vira resposta HTTP, não 500. */
export class DecisaoError extends Error {
  constructor(message: string, readonly status: number, readonly detalhes?: Record<string, unknown>) {
    super(message)
    this.name = 'DecisaoError'
  }
}

/**
 * Resolve, para cada item do patch, se ele foi aceito. O casamento é por
 * TÍTULO normalizado (mesma chave do diff): o advogado decide sobre a seção que
 * ele viu na tela, não sobre o índice de um array. Itens sem decisão explícita
 * ficam REJEITADOS — silêncio nunca aplica texto na peça de ninguém.
 */
export function separarDecisoes(
  patch: SecaoPatch[],
  entrada: EntradaDecisao,
): { aceitas: SecaoPatch[]; rejeitadas: SecaoPatch[]; mapa: Record<string, Decisao> } {
  const mapa: Record<string, Decisao> = {}

  if (entrada.aceitarTudo) {
    for (const p of patch) mapa[p.titulo] = 'aceitar'
  } else if (entrada.rejeitarTudo) {
    for (const p of patch) mapa[p.titulo] = 'rejeitar'
  } else {
    const porTitulo = new Map<string, Decisao>()
    for (const d of entrada.decisoes ?? []) porTitulo.set(normalizarTitulo(d.titulo), d.decisao)
    for (const p of patch) mapa[p.titulo] = porTitulo.get(normalizarTitulo(p.titulo)) ?? 'rejeitar'
  }

  const aceitas = patch.filter((p) => mapa[p.titulo] === 'aceitar')
  const rejeitadas = patch.filter((p) => mapa[p.titulo] !== 'aceitar')
  return { aceitas, rejeitadas, mapa }
}

/** Status final da proposta a partir do que foi aceito. */
export function statusDaProposta(total: number, aceitas: number): StatusProposta {
  if (aceitas === 0) return 'rejeitada'
  return aceitas === total ? 'aceita' : 'parcial'
}

export interface ResultadoDecisao {
  status: StatusProposta
  aceitas: number
  rejeitadas: number
  /** Nova versão da peça (null quando nada foi aceito). */
  versao: number | null
  /** Operações que já estavam aplicadas (reenvio) — não geram versão nova. */
  ignoradas: number
}

/**
 * Aplica a decisão do advogado. Salva a versão anterior em `pecas_versoes` com
 * origem='sessao' + a instrução do turno que gerou a proposta (o rastro do
 * porquê), grava o texto novo e fecha a proposta.
 */
export async function decidirProposta(params: {
  supabase: SupabaseServer
  admin: SupabaseAdmin
  tenantId: string
  usuarioId: string
  peca: PecaDaSessao
  sessao: SessaoPeca
  proposta: PropostaPeca
  entrada: EntradaDecisao
}): Promise<ResultadoDecisao> {
  const { admin, peca, proposta, entrada } = params

  if (proposta.status !== 'pendente') {
    throw new DecisaoError(`Esta proposta já foi ${proposta.status}.`, 409, { status: proposta.status })
  }

  const patch = Array.isArray(proposta.patch) ? proposta.patch : []
  const { aceitas, rejeitadas, mapa } = separarDecisoes(patch, entrada)

  // 1. A peça mudou desde que a proposta foi calculada? (§13 do plano)
  const versaoAtual = peca.versao ?? 1
  if (proposta.versao_base != null && proposta.versao_base !== versaoAtual && !entrada.forcar) {
    throw new DecisaoError(
      'A peça foi alterada depois que esta proposta foi gerada. Revise o texto atual antes de aplicar.',
      409,
      { pecaMudou: true, versaoBase: proposta.versao_base, versaoAtual },
    )
  }

  // Rejeitar tudo não toca na peça — fecha a proposta e registra a decisão.
  if (aceitas.length === 0) {
    await fecharProposta(params, { status: 'rejeitada', mapa, versaoResultante: null })
    return { status: 'rejeitada', aceitas: 0, rejeitadas: rejeitadas.length, versao: null, ignoradas: 0 }
  }

  const conteudoAtual = peca.conteudo_markdown ?? ''

  // 3. Título inexistente levanta PatchSecaoError (409) — deixamos subir.
  const { markdown, aplicadas, ignoradas } = aplicarPatchSecoes(conteudoAtual, aceitas)

  if (aplicadas === 0) {
    // Tudo já estava aplicado (reenvio/duplo clique): fecha sem versão nova.
    await fecharProposta(params, { status: statusDaProposta(patch.length, aceitas.length), mapa, versaoResultante: versaoAtual })
    return {
      status: statusDaProposta(patch.length, aceitas.length),
      aceitas: aceitas.length,
      rejeitadas: rejeitadas.length,
      versao: versaoAtual,
      ignoradas,
    }
  }

  // 2. Guarda anti-encolhimento (camada C).
  if (!entrada.forcar && encolhimentoPerigoso(conteudoAtual, markdown)) {
    throw new DecisaoError('O texto resultante é bem menor que a peça salva.', 409, {
      code: 'CONTEUDO_MENOR',
      atual: conteudoAtual.length,
      novo: markdown.length,
    })
  }

  // Instrução que originou a proposta: o turno do advogado imediatamente
  // anterior ao turno do agente. É o "porquê" que fica gravado na versão.
  const instrucao = await instrucaoDaProposta(admin, proposta)

  // As escritas na PEÇA vão pelo client do usuário (RLS por tenant): quem grava
  // o documento do escritório é o advogado autenticado, não o service_role. E
  // pelo MESMO caminho do salvar-peca (salvarVersaoAnterior), que não duplica a
  // linha de versão e carrega origem + instrução.
  await salvarVersaoAnterior(params.supabase, {
    pecaId: peca.id,
    versao: versaoAtual,
    conteudoMarkdown: conteudoAtual,
    usuarioId: params.usuarioId,
    origem: 'sessao',
    instrucao,
    sessaoId: params.sessao.id,
    turnoId: proposta.turno_id,
  })

  const novaVersao = versaoAtual + 1
  const { error: erroPeca } = await params.supabase
    .from('pecas')
    .update({ conteudo_markdown: markdown, versao: novaVersao, updated_at: new Date().toISOString() })
    .eq('id', peca.id)
    .eq('tenant_id', params.tenantId)
  if (erroPeca) throw new DecisaoError('Não foi possível salvar a peça.', 500)

  // Telemetria de edição (best-effort, igual ao salvar-peca).
  try {
    const { data: base } = await params.supabase
      .from('pecas_versoes')
      .select('conteudo_markdown')
      .eq('peca_id', peca.id)
      .order('versao', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (base?.conteudo_markdown) {
      await params.supabase
        .from('pecas')
        .update({ taxa_edicao: calcularTaxaEdicao(base.conteudo_markdown as string, markdown) })
        .eq('id', peca.id)
        .eq('tenant_id', params.tenantId)
    }
  } catch {
    // telemetria nunca derruba a aplicação da proposta
  }

  const status = statusDaProposta(patch.length, aceitas.length)
  await fecharProposta(params, { status, mapa, versaoResultante: novaVersao })

  // LGPD: ids e contagens — nada do texto da peça nem da instrução.
  logger.info('ia.sessao.proposta_decidida', {
    sessaoId: params.sessao.id,
    pecaId: peca.id,
    propostaId: proposta.id,
    status,
    aceitas: aceitas.length,
    rejeitadas: rejeitadas.length,
    versao: novaVersao,
  })

  return { status, aceitas: aceitas.length, rejeitadas: rejeitadas.length, versao: novaVersao, ignoradas }
}

/** Instrução do advogado que originou a proposta (turno anterior ao do agente). */
async function instrucaoDaProposta(admin: SupabaseAdmin, proposta: PropostaPeca): Promise<string | null> {
  if (!proposta.turno_id) return null
  const { data: turnoAgente } = await admin
    .from('pecas_turnos')
    .select('numero, sessao_id')
    .eq('id', proposta.turno_id)
    .maybeSingle()
  if (!turnoAgente) return null

  const { data } = await admin
    .from('pecas_turnos')
    .select('conteudo')
    .eq('sessao_id', turnoAgente.sessao_id)
    .eq('papel', 'advogado')
    .lt('numero', turnoAgente.numero)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.conteudo as string | null) ?? null
}

/** Fecha a proposta e registra a decisão como turno de sistema. */
async function fecharProposta(
  params: {
    admin: SupabaseAdmin
    usuarioId: string
    sessao: SessaoPeca
    proposta: PropostaPeca
  },
  resultado: { status: StatusProposta; mapa: Record<string, Decisao>; versaoResultante: number | null },
): Promise<void> {
  const { admin, proposta } = params

  await admin
    .from('pecas_propostas')
    .update({
      status: resultado.status,
      decisoes: resultado.mapa,
      versao_resultante: resultado.versaoResultante,
      decidido_por: params.usuarioId,
      decidido_at: new Date().toISOString(),
    })
    .eq('id', proposta.id)

  if (proposta.turno_id && resultado.versaoResultante != null) {
    await admin
      .from('pecas_turnos')
      .update({ versao_resultante: resultado.versaoResultante })
      .eq('id', proposta.turno_id)
  }

  const patch = Array.isArray(proposta.patch) ? proposta.patch : []
  const aceitas = patch.filter((p) => resultado.mapa[p.titulo] === 'aceitar')
  const rejeitadas = patch.filter((p) => resultado.mapa[p.titulo] !== 'aceitar')

  // O turno de decisão entra no HISTÓRICO da conversa (payload.blocos): na
  // rodada seguinte o agente sabe o que foi aceito e o que foi recusado — e
  // para de reoferecer o que o advogado já disse que não quer.
  const linhas = [
    resultado.versaoResultante != null
      ? `O advogado aplicou ${aceitas.length} de ${patch.length} seção(ões) desta proposta. A peça está agora na versão ${resultado.versaoResultante}.`
      : `O advogado rejeitou a proposta (${patch.length} seção(ões)). A peça não mudou.`,
  ]
  if (aceitas.length) linhas.push('Aceitas:', descreverPatch(aceitas))
  if (rejeitadas.length) linhas.push('Rejeitadas (não reofereça sem um motivo novo):', descreverPatch(rejeitadas))
  const texto = linhas.join('\n')

  await inserirTurno(admin, {
    sessaoId: params.sessao.id,
    papel: 'sistema',
    tipo: 'proposta',
    conteudo: texto,
    payload: { blocos: [texto], decisoes: resultado.mapa, status: resultado.status },
    versaoResultante: resultado.versaoResultante,
    propostaId: proposta.id,
    criadoPor: params.usuarioId,
  })

  await tocarSessao(admin, params.sessao.id)
}

export { PatchSecaoError }
