// Fase 5 — classificação curada de movimentos processuais (DataJud/TPU CNJ).
// Estratégia: primeiro por código TPU (quando é estável e inequívoco), depois
// fallback por regex no nome (normalizado sem acentos). O nome é o que o DataJud
// sempre devolve, então o regex é o verdadeiro cavalo de batalha; os códigos são
// só reforço para os poucos casos que temos certeza. Ver docs/PLANO-FASE-5-OPUS.md §5.

export type CategoriaMovimento =
  | 'sentenca'
  | 'transito_julgado'
  | 'audiencia'
  | 'expedicao_alvara'
  | 'decisao_despacho'
  | 'redistribuicao'
  | 'arquivamento'
  | 'recurso'
  | 'movimentacao_comum'

/** Todas as categorias, com rótulo humano — usado na UI de Configurações (Lote 2). */
export const CATEGORIAS: Array<{ slug: CategoriaMovimento; rotulo: string; notificavelDefault: boolean }> = [
  { slug: 'sentenca', rotulo: 'Sentença / julgamento', notificavelDefault: true },
  { slug: 'transito_julgado', rotulo: 'Trânsito em julgado', notificavelDefault: true },
  { slug: 'audiencia', rotulo: 'Audiência', notificavelDefault: true },
  { slug: 'expedicao_alvara', rotulo: 'Expedição de alvará', notificavelDefault: true },
  { slug: 'recurso', rotulo: 'Recurso', notificavelDefault: true },
  { slug: 'arquivamento', rotulo: 'Arquivamento definitivo', notificavelDefault: true },
  { slug: 'decisao_despacho', rotulo: 'Decisão / despacho', notificavelDefault: false },
  { slug: 'redistribuicao', rotulo: 'Redistribuição / remessa', notificavelDefault: false },
  { slug: 'movimentacao_comum', rotulo: 'Movimentação comum', notificavelDefault: false },
]

/** Categorias notificáveis por padrão (sugestão inicial de config.processos_notificar). */
export const CATEGORIAS_NOTIFICAVEIS_DEFAULT: CategoriaMovimento[] = CATEGORIAS
  .filter((c) => c.notificavelDefault)
  .map((c) => c.slug)

/** Códigos TPU inequívocos (reforço; o nome cobre o resto por regex). */
const CODIGO_CATEGORIA: Record<number, CategoriaMovimento> = {
  848: 'transito_julgado', // Trânsito em Julgado
  246: 'arquivamento', // Definitivo (arquivamento)
}

const norm = (s: string): string =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

/**
 * Classifica um movimento em uma categoria curada, ou null se nada casar.
 * `complementos` é usado para desambiguar "Expedição de documento [Alvará]".
 */
export function classificarMovimento(input: {
  codigo?: number | null
  nome: string
  complementos?: Array<Record<string, unknown>>
}): CategoriaMovimento | null {
  const { codigo, nome } = input
  if (typeof codigo === 'number' && CODIGO_CATEGORIA[codigo]) return CODIGO_CATEGORIA[codigo]

  const n = norm(nome)
  const comp = norm(
    (input.complementos ?? [])
      .map((c) => Object.values(c).filter((v) => typeof v === 'string').join(' '))
      .join(' '),
  )
  const tudo = `${n} ${comp}`

  // Ordem importa: do mais específico/decisivo para o mais genérico.
  if (/transito\s+em\s+julgad/.test(n)) return 'transito_julgado'

  if (/\bsentenca\b|proced[êe]?ncia|improcedencia|homologa|extincao|resolucao do merito/.test(n))
    return 'sentenca'

  if (/apelacao|agravo|\bembargos\b|recurso (especial|extraordinario|inominado|de revista)|recebido o recurso|remessa.*(instancia superior|segundo grau|2\W*grau|tribunal)/.test(n))
    return 'recurso'

  if (/audiencia/.test(n)) return 'audiencia'

  // Alvará: no nome ("Alvará") ou no complemento de "Expedição de documento".
  if (/alvara/.test(tudo)) return 'expedicao_alvara'

  // Arquivamento DEFINITIVO vira encerramento; provisório é movimentação comum.
  if (/arquiv|baixa definitiva/.test(n)) {
    return /provisori/.test(n) ? 'movimentacao_comum' : 'arquivamento'
  }

  if (/redistribui|incompetencia|declinacao da competencia|remessa dos autos/.test(n))
    return 'redistribuicao'

  // "Conclusão para despacho/decisão/julgamento" é ato procedural (envio ao juiz),
  // não a decisão em si — precede o ramo de decisão para não roubar a classificação.
  if (/conclusao/.test(n)) return 'movimentacao_comum'

  if (/decisao|despacho|deferi|indeferi|mero expediente/.test(n)) return 'decisao_despacho'

  if (/conclusao|juntada|peticao|publicacao|decurso de prazo|intima|citacao|expedicao|confirmad|recebiment|distribuicao|autos/.test(n))
    return 'movimentacao_comum'

  return null
}

/** Um arquivamento definitivo sugere encerrar o processo (a UI permite reabrir). */
export function sugereEncerramento(categoria: CategoriaMovimento | null): boolean {
  return categoria === 'arquivamento'
}
