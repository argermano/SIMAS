// A proposta da sessão vista pela TELA (F0.4) — puro, sem React.
//
// Duas traduções acontecem aqui, e as duas precisam ser exatas:
//
// 1. PRÉVIA — o `ComparadorSecoes` compara dois textos, não conhece patch. Para
//    reaproveitá-lo, a UI monta o "atual" aplicando o patch localmente com a
//    MESMA função pura que o servidor usa (`aplicarPatchSecoes`). O que o
//    advogado vê no diff é, portanto, o que o `decidir.ts` vai recalcular do
//    outro lado — nunca uma aproximação.
//
// 2. DECISÕES — o comparador devolve escolhas por TÍTULO DA SEÇÃO NA TELA; o
//    endpoint de decisão espera o título do ITEM DO PATCH. Em `inserir_apos`
//    esses dois títulos são diferentes (um é a âncora, o outro é a seção nova),
//    e confundi-los aplicaria a seção errada.

import {
  aplicarPatchSecoes,
  PatchSecaoError,
  type SecaoPatch,
} from '@/lib/diff/patch-secoes'
import { dividirSecoes, normalizarTitulo, type EscolhaSecao, type StatusSecao } from '@/lib/diff/secoes'

export type PreviaProposta =
  | { ok: true; markdown: string; ignoradas: number }
  | { ok: false; erro: string; titulo?: string; disponiveis?: string[] }

/**
 * Texto da peça com o patch aplicado, para alimentar o lado "atual" do diff.
 * Título inexistente (a peça mudou por baixo) não derruba a tela: vira um
 * resultado de erro com o que o advogado precisa saber.
 */
export function previaDaProposta(base: string, patch: SecaoPatch[]): PreviaProposta {
  try {
    const { markdown, ignoradas } = aplicarPatchSecoes(base ?? '', patch ?? [])
    return { ok: true, markdown, ignoradas }
  } catch (e) {
    if (e instanceof PatchSecaoError) {
      return { ok: false, erro: e.message, titulo: e.titulo, disponiveis: e.disponiveis }
    }
    return { ok: false, erro: e instanceof Error ? e.message : 'Não foi possível montar a prévia da proposta.' }
  }
}

/**
 * Título com que a operação APARECE no diff: o alvo em substituir/remover, e o
 * heading do bloco novo nas inserções (é ele que surge como seção "nova").
 * Bloco novo sem heading cai no preâmbulo (título vazio) — mesmo critério do
 * `dividirSecoes`.
 */
export function tituloNoDiff(item: SecaoPatch): string {
  if (item.acao === 'substituir' || item.acao === 'remover') return item.titulo
  const primeira = dividirSecoes(item.conteudo_markdown ?? '')[0]
  return primeira?.titulo ?? ''
}

/** Uma linha do comparador, do jeito que a UI a devolve. */
export interface EscolhaDiff {
  titulo: string
  status: StatusSecao
  escolha: EscolhaSecao
}

export type Decisao = 'aceitar' | 'rejeitar'

/**
 * Escolhas do comparador → decisões por seção do endpoint.
 *
 * "Aceitar" é sempre a escolha que mantém o estado PROPOSTO: em `remover` isso
 * é `remover` (a seção some), nas demais é `atual` (o texto novo fica). Uma
 * operação que não apareceu no diff (no-op — a peça já estava assim) conta como
 * aceita: rejeitá-la em silêncio faria a proposta constar como recusada sem
 * que o advogado tenha recusado nada.
 */
export function decisoesDaProposta(
  patch: SecaoPatch[],
  escolhas: EscolhaDiff[],
): Array<{ titulo: string; decisao: Decisao }> {
  const porTitulo = new Map<string, EscolhaDiff>()
  for (const e of escolhas) {
    const chave = normalizarTitulo(e.titulo)
    if (!porTitulo.has(chave)) porTitulo.set(chave, e)
  }

  return (patch ?? []).map((item) => {
    const bloco = porTitulo.get(normalizarTitulo(tituloNoDiff(item)))
    if (!bloco) return { titulo: item.titulo, decisao: 'aceitar' as Decisao }
    const esperada: EscolhaSecao = item.acao === 'remover' ? 'remover' : 'atual'
    return { titulo: item.titulo, decisao: bloco.escolha === esperada ? 'aceitar' : 'rejeitar' }
  })
}

/** Rótulo curto da operação, para a lista de seções do card. */
export function rotuloAcao(acao: SecaoPatch['acao']): string {
  switch (acao) {
    case 'substituir':
      return 'Reescreve'
    case 'inserir_apos':
      return 'Insere depois de'
    case 'inserir_inicio':
      return 'Insere no início'
    case 'remover':
      return 'Remove'
  }
}
