// Diff por SEÇÃO entre duas versões de uma peça em Markdown (E9). Divide o texto
// por títulos (## / ###), pareia seções por título e classifica cada uma como
// igual / alterada / adicionada / removida. O advogado aceita ou reverte por
// seção; montarMarkdown() reconstrói o documento final. Puro e testável.

export interface Secao {
  titulo: string   // texto do heading (vazio = preâmbulo antes do 1º heading)
  nivel: number    // 0 = preâmbulo, 1..6 = nível do heading
  conteudo: string // bloco COMPLETO (linha do heading + corpo até o próximo heading)
}

export type StatusSecao = 'igual' | 'alterada' | 'adicionada' | 'removida'

export interface BlocoDiff {
  titulo: string
  status: StatusSecao
  base?: string   // conteúdo na versão ANTERIOR
  atual?: string  // conteúdo na versão ATUAL
}

export type EscolhaSecao = 'atual' | 'base' | 'remover'

/** Divide o markdown em seções por heading. Preserva o conteúdo literal. */
export function dividirSecoes(md: string): Secao[] {
  const linhas = (md ?? '').split('\n')
  const secoes: Secao[] = []
  let atual: { titulo: string; nivel: number; linhas: string[] } = { titulo: '', nivel: 0, linhas: [] }

  const fechar = () => {
    if (atual.titulo || atual.linhas.some((l) => l.trim())) {
      secoes.push({ titulo: atual.titulo, nivel: atual.nivel, conteudo: atual.linhas.join('\n') })
    }
  }

  for (const linha of linhas) {
    const m = linha.match(/^(#{1,6})\s+(.*)$/)
    if (m) {
      fechar()
      atual = { titulo: m[2].trim(), nivel: m[1].length, linhas: [linha] }
    } else {
      atual.linhas.push(linha)
    }
  }
  fechar()
  return secoes
}

const normalizar = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Compara base (versão anterior) × atual, pareando seções por título.
 * Resultado em ordem: seções de `atual`, seguidas das removidas (só em `base`).
 */
export function compararSecoes(base: string, atual: string): BlocoDiff[] {
  const sBase = dividirSecoes(base)
  const sAtual = dividirSecoes(atual)

  // Multimapa das seções base por título normalizado (fila para lidar com repetição).
  const filas = new Map<string, Secao[]>()
  for (const s of sBase) {
    const k = normalizar(s.titulo)
    if (!filas.has(k)) filas.set(k, [])
    filas.get(k)!.push(s)
  }

  const blocos: BlocoDiff[] = []
  const baseConsumidas = new Set<Secao>()

  for (const s of sAtual) {
    const fila = filas.get(normalizar(s.titulo))
    const par = fila && fila.length > 0 ? fila.shift()! : null
    if (par) {
      baseConsumidas.add(par)
      blocos.push({
        titulo: s.titulo,
        status: par.conteudo.trim() === s.conteudo.trim() ? 'igual' : 'alterada',
        base: par.conteudo,
        atual: s.conteudo,
      })
    } else {
      blocos.push({ titulo: s.titulo, status: 'adicionada', atual: s.conteudo })
    }
  }

  // Seções que existiam na base e sumiram no atual.
  for (const s of sBase) {
    if (!baseConsumidas.has(s)) {
      blocos.push({ titulo: s.titulo, status: 'removida', base: s.conteudo })
    }
  }

  return blocos
}

/** Escolha padrão por status (o que reconstrói o documento ATUAL sem mexer). */
export function escolhaPadrao(status: StatusSecao): EscolhaSecao {
  return status === 'removida' ? 'remover' : 'atual'
}

/** Reconstrói o markdown a partir dos blocos e das escolhas do usuário. */
export function montarMarkdown(blocos: BlocoDiff[], escolhas: EscolhaSecao[]): string {
  const partes: string[] = []
  blocos.forEach((b, i) => {
    const escolha = escolhas[i] ?? escolhaPadrao(b.status)
    const texto = escolha === 'base' ? b.base : escolha === 'atual' ? b.atual : undefined
    if (texto !== undefined && texto !== null) partes.push(texto)
  })
  return partes.join('\n').trim()
}
