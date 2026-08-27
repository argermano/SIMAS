// Aplicação de um PATCH POR SEÇÃO sobre o Markdown de uma peça (F0.3).
//
// É o outro lado do diff de src/lib/diff/secoes.ts: lá comparamos duas versões
// inteiras; aqui recebemos a PROPOSTA do agente — uma lista de operações por
// título de seção — e devolvemos o Markdown resultante. Puro, síncrono e sem
// dependências: é ele quem transforma "a IA propôs" em "o advogado aceitou".
//
// Invariante do plano (§4): a sessão NUNCA grava a peça. Quem chama esta função
// é o endpoint de decisão da proposta, já com as seções ACEITAS pelo advogado.
//
// Fidelidade: as seções NÃO tocadas saem byte a byte como entraram. Só a emenda
// (a "costura") entre um bloco novo e o vizinho é normalizada para uma linha em
// branco — o suficiente para o Markdown continuar bem formado.

import { dividirSecoes, normalizarTitulo, type Secao } from './secoes'

/** Operações que o agente pode propor sobre uma seção. */
export type AcaoSecao = 'substituir' | 'inserir_apos' | 'remover' | 'inserir_inicio'

export const ACOES_SECAO: readonly AcaoSecao[] = [
  'substituir',
  'inserir_apos',
  'remover',
  'inserir_inicio',
] as const

/** Uma operação da proposta. */
export interface SecaoPatch {
  /**
   * Título da seção ALVO (substituir/remover) ou da seção ÂNCORA
   * (inserir_apos). Em `inserir_inicio` é ignorado — o bloco vai para o topo.
   */
  titulo: string
  acao: AcaoSecao
  /** Markdown do bloco novo (com o próprio heading). Vazio em `remover`. */
  conteudo_markdown?: string
  /** Por que o agente propôs isso (exibido ao advogado). */
  motivo?: string
}

/** Título citado pela proposta que não existe na peça. */
export class PatchSecaoError extends Error {
  status = 409
  constructor(
    readonly titulo: string,
    readonly acao: AcaoSecao,
    readonly disponiveis: string[],
  ) {
    super(
      `Seção "${titulo}" não encontrada na peça para a ação "${acao}". ` +
        `Seções disponíveis: ${disponiveis.length ? disponiveis.map((t) => `"${t}"`).join(', ') : '(nenhuma)'}.`,
    )
    this.name = 'PatchSecaoError'
  }
}

/** Bloco do documento em construção: original (intocado) ou novo (do patch). */
interface Bloco {
  tipo: 'original' | 'novo'
  texto: string
}

/**
 * Junta os blocos preservando os originais byte a byte. A separação padrão é
 * '\n' (é o que reconstrói exatamente o texto que `dividirSecoes` recebeu);
 * quando um dos lados da emenda é um bloco NOVO, garante uma linha em branco.
 */
function montar(blocos: Bloco[]): string {
  if (blocos.length === 0) return ''
  let out = blocos[0].texto
  for (let i = 1; i < blocos.length; i++) {
    const costura = blocos[i].tipo === 'novo' || blocos[i - 1].tipo === 'novo'
    if (!costura) {
      out += `\n${blocos[i].texto}`
      continue
    }
    out = out.replace(/[ \t]+$/, '')
    if (!out.endsWith('\n')) out += '\n'
    if (!out.endsWith('\n\n')) out += '\n'
    out += blocos[i].texto
  }
  return out.trimEnd()
}

/** Índice da seção cujo título casa (normalizado). -1 quando não existe. */
function acharSecao(secoes: Secao[], titulo: string): number {
  const alvo = normalizarTitulo(titulo)
  if (!alvo) return -1
  return secoes.findIndex((s) => normalizarTitulo(s.titulo) === alvo)
}

/**
 * O bloco novo JÁ está no começo desta sequência? É o teste de idempotência das
 * inserções: reenviar a mesma proposta vira no-op em vez de duplicar a seção.
 * Compara o texto remontado (e não só o 1º bloco) porque um bloco novo pode
 * trazer mais de um heading e, ao ser redividido, virar várias seções.
 */
function jaAplicado(blocos: Bloco[], novo: string): boolean {
  if (blocos.length === 0) return false
  return montar(blocos).trimStart().startsWith(novo)
}

/** Resultado da aplicação (o texto + o que efetivamente mudou). */
export interface ResultadoPatch {
  markdown: string
  /** Ações que alteraram o texto. */
  aplicadas: number
  /** Ações que já estavam aplicadas (reenvio da mesma proposta). */
  ignoradas: number
}

/**
 * Aplica as operações NA ORDEM sobre `baseMarkdown`.
 *
 * IDEMPOTÊNCIA: `substituir` reescreve a mesma seção com o mesmo texto; as duas
 * inserções conferem antes se o bloco idêntico já está na posição e viram no-op.
 * Assim, reenviar a mesma proposta (retry de rede, duplo clique) não duplica
 * seções. `remover` é a exceção deliberada: a segunda tentativa não encontra a
 * seção e levanta PatchSecaoError — sinal honesto de que a peça já mudou.
 *
 * Título inexistente → PatchSecaoError com a lista de títulos disponíveis.
 */
export function aplicarPatchSecoes(baseMarkdown: string, patch: SecaoPatch[]): ResultadoPatch {
  // Depois de CADA operação o texto é remontado e redividido: assim a lista de
  // blocos é sempre exatamente a lista de seções do documento corrente (um bloco
  // novo pode conter mais de um heading) e os índices nunca desalinham. Blocos
  // já montados voltam como 'original' — remontar só com originais reproduz o
  // texto byte a byte, então nada é reformatado duas vezes.
  const redividir = (texto: string): Bloco[] =>
    dividirSecoes(texto).map((s) => ({ tipo: 'original' as const, texto: s.conteudo }))

  let secoes: Bloco[] = redividir(baseMarkdown ?? '')
  let aplicadas = 0
  let ignoradas = 0

  const titulos = (): Secao[] => dividirSecoes(montar(secoes))
  const titulosDisponiveis = () => titulos().map((s) => s.titulo).filter(Boolean)

  /** Aplica a mutação e renormaliza a lista de blocos. */
  const aplicar = (proximos: Bloco[]) => {
    secoes = redividir(montar(proximos))
    aplicadas++
  }

  for (const item of patch) {
    const novo = (item.conteudo_markdown ?? '').trim()

    if (item.acao === 'inserir_inicio') {
      if (!novo) { ignoradas++; continue }
      if (jaAplicado(secoes, novo)) { ignoradas++; continue }
      aplicar([{ tipo: 'novo', texto: novo }, ...secoes])
      continue
    }

    const idx = acharSecao(titulos(), item.titulo)
    if (idx === -1) throw new PatchSecaoError(item.titulo, item.acao, titulosDisponiveis())

    if (item.acao === 'remover') {
      aplicar(secoes.filter((_, i) => i !== idx))
      continue
    }

    if (item.acao === 'substituir') {
      if (!novo) { ignoradas++; continue }
      if (secoes[idx].texto.trim() === novo) { ignoradas++; continue }
      aplicar(secoes.map((b, i) => (i === idx ? { tipo: 'novo' as const, texto: novo } : b)))
      continue
    }

    // inserir_apos: `titulo` é a seção ÂNCORA; o bloco novo traz o próprio heading.
    if (!novo) { ignoradas++; continue }
    if (jaAplicado(secoes.slice(idx + 1), novo)) { ignoradas++; continue }
    aplicar([...secoes.slice(0, idx + 1), { tipo: 'novo', texto: novo }, ...secoes.slice(idx + 1)])
  }

  return { markdown: montar(secoes), aplicadas, ignoradas }
}

/**
 * Resumo legível de uma proposta (uma linha por seção) — usado no histórico da
 * conversa e no turno de decisão. Não expõe o conteúdo, só a operação.
 */
export function descreverPatch(patch: SecaoPatch[]): string {
  const rotulo: Record<AcaoSecao, string> = {
    substituir: 'substituir',
    inserir_apos: 'inserir depois de',
    remover: 'remover',
    inserir_inicio: 'inserir no início',
  }
  return patch
    .map((p) => `- ${rotulo[p.acao]} "${p.titulo}"${p.motivo ? ` — ${p.motivo}` : ''}`)
    .join('\n')
}
