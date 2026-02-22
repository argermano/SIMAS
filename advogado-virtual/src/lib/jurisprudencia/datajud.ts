/**
 * Serviço de consulta à API Pública DataJud (CNJ)
 * Docs: https://datajud-wiki.cnj.jus.br/api-publica/
 *
 * A API usa Elasticsearch. Cada tribunal tem um endpoint:
 * POST https://api-publica.datajud.cnj.jus.br/api_publica_{alias}/_search
 */

const DATAJUD_BASE = 'https://api-publica.datajud.cnj.jus.br'
const DATAJUD_API_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=='

export interface ResultadoJurisprudencia {
  tribunal: string
  numeroProcesso: string
  classe: string
  assuntos: string[]
  orgaoJulgador: string
  dataAjuizamento: string
  ultimaAtualizacao: string
  grau: string
  movimentos: Array<{ nome: string; data: string }>
}

export interface BuscaJurisprudenciaParams {
  termos: string
  tribunais: string[]
  limite?: number
}

/**
 * Busca processos relevantes na API DataJud para múltiplos tribunais
 */
export async function buscarJurisprudencia({
  termos,
  tribunais,
  limite = 5,
}: BuscaJurisprudenciaParams): Promise<ResultadoJurisprudencia[]> {
  const resultados: ResultadoJurisprudencia[] = []

  // Busca em paralelo em todos os tribunais selecionados
  const promessas = tribunais.map(async (alias) => {
    try {
      const dados = await consultarTribunal(alias, termos, limite)
      return dados
    } catch {
      // Se um tribunal falhar, ignora e continua com os outros
      return []
    }
  })

  const lotes = await Promise.all(promessas)
  for (const lote of lotes) {
    resultados.push(...lote)
  }

  // Ordena por data mais recente
  resultados.sort((a, b) =>
    new Date(b.ultimaAtualizacao).getTime() - new Date(a.ultimaAtualizacao).getTime()
  )

  return resultados.slice(0, limite * tribunais.length)
}

/**
 * Consulta um tribunal específico na API DataJud
 */
async function consultarTribunal(
  alias: string,
  termos: string,
  limite: number,
): Promise<ResultadoJurisprudencia[]> {
  const url = `${DATAJUD_BASE}/api_publica_${alias}/_search`

  // Query Elasticsearch: busca por termos nos assuntos e movimentos
  const body = {
    size: limite,
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query: termos,
              fields: [
                'assuntos.nome^3',
                'classe.nome^2',
                'movimentos.nome',
                'orgaoJulgador.nome',
              ],
              type: 'best_fields',
              fuzziness: 'AUTO',
            },
          },
        ],
      },
    },
    sort: [
      { dataAjuizamento: { order: 'desc' } },
    ],
    _source: [
      'numeroProcesso',
      'classe',
      'assuntos',
      'orgaoJulgador',
      'dataAjuizamento',
      'dataHoraUltimaAtualizacao',
      'grau',
      'movimentos',
    ],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `APIKey ${DATAJUD_API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    return []
  }

  const data = await res.json()
  const hits = data.hits?.hits ?? []

  return hits.map((hit: Record<string, unknown>) => {
    const src = hit._source as Record<string, unknown>
    const assuntos = (src.assuntos as Array<{ nome?: string }>) ?? []
    const movimentos = (src.movimentos as Array<{ nome?: string; dataHora?: string }>) ?? []
    const orgao = (src.orgaoJulgador as { nome?: string }) ?? {}
    const classe = (src.classe as { nome?: string }) ?? {}

    return {
      tribunal: alias.toUpperCase(),
      numeroProcesso: (src.numeroProcesso as string) ?? '',
      classe: classe.nome ?? '',
      assuntos: assuntos.map((a) => a.nome ?? '').filter(Boolean),
      orgaoJulgador: orgao.nome ?? '',
      dataAjuizamento: (src.dataAjuizamento as string)?.substring(0, 10) ?? '',
      ultimaAtualizacao: (src.dataHoraUltimaAtualizacao as string)?.substring(0, 10) ?? '',
      grau: (src.grau as string) ?? '',
      movimentos: movimentos
        .filter((m) => m.nome)
        .slice(-5)
        .map((m) => ({
          nome: m.nome ?? '',
          data: m.dataHora?.substring(0, 10) ?? '',
        })),
    }
  })
}

/**
 * Formata resultados de jurisprudência para inclusão no prompt da IA
 */
export function formatarParaPrompt(resultados: ResultadoJurisprudencia[]): string {
  if (resultados.length === 0) return ''

  const linhas = resultados.map((r, i) => {
    const assuntos = r.assuntos.join(', ')
    const ultimoMovimento = r.movimentos.at(-1)
    return [
      `[${i + 1}] ${r.tribunal} — Processo ${r.numeroProcesso}`,
      `    Classe: ${r.classe}`,
      `    Órgão julgador: ${r.orgaoJulgador}`,
      `    Assuntos: ${assuntos}`,
      `    Data ajuizamento: ${r.dataAjuizamento}`,
      ultimoMovimento ? `    Último movimento: ${ultimoMovimento.nome} (${ultimoMovimento.data})` : '',
    ].filter(Boolean).join('\n')
  })

  return [
    '=== JURISPRUDÊNCIA CONSULTADA (DataJud/CNJ) ===',
    '',
    ...linhas,
    '',
    '=== FIM DA JURISPRUDÊNCIA ===',
  ].join('\n')
}
