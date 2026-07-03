/**
 * Serviço de consulta à API Pública DataJud (CNJ)
 * Docs: https://datajud-wiki.cnj.jus.br/api-publica/
 *
 * A API usa Elasticsearch. Cada tribunal tem um endpoint:
 * POST https://api-publica.datajud.cnj.jus.br/api_publica_{alias}/_search
 */

const DATAJUD_BASE = 'https://api-publica.datajud.cnj.jus.br'
// A API pública do DataJud usa uma chave pública compartilhada (documentada pelo CNJ).
// Mesmo assim, mantida em env var para permitir rotação sem deploy e evitar hardcode.
// Fallback para a chave pública oficial do CNJ caso a env não esteja definida.
const DATAJUD_API_KEY =
  process.env.DATAJUD_API_KEY ??
  'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=='

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
 * Formata os resultados do DataJud para inclusão no prompt da IA — como
 * ESTATÍSTICA de volume processual, NÃO como jurisprudência.
 *
 * O DataJud é uma base de METADADOS de acompanhamento processual do CNJ: ele
 * devolve número, classe, assunto, órgão e movimentações — mas NÃO a ementa, o
 * relator, a tese ou o resultado do julgamento. Apresentar esses números como
 * "jurisprudência consultada" e mandar o modelo citá-los induzia à alucinação
 * (número real vestido de ementa inventada, ou processo citado "a favor" que na
 * verdade foi julgado improcedente). Por isso o dado entra apenas como medida
 * de litigiosidade do tema, explicitamente não citável como precedente.
 */
export function formatarParaPrompt(resultados: ResultadoJurisprudencia[]): string {
  if (resultados.length === 0) return ''

  const total = resultados.length

  // Volume por tribunal (ex.: "TRF4 (3), TRF1 (2)")
  const porTribunal = new Map<string, number>()
  for (const r of resultados) {
    if (r.tribunal) porTribunal.set(r.tribunal, (porTribunal.get(r.tribunal) ?? 0) + 1)
  }
  const tribunaisLinha = [...porTribunal.entries()]
    .map(([t, n]) => `${t} (${n})`)
    .join(', ')

  // Assuntos distintos predominantes (metadado de classificação do CNJ)
  const assuntos = [...new Set(resultados.flatMap((r) => r.assuntos))].filter(Boolean).slice(0, 8)

  return [
    '=== ESTATÍSTICA PROCESSUAL (DataJud/CNJ) — NÃO É JURISPRUDÊNCIA ===',
    '',
    `Localizados ${total} processo(s) sobre o tema nos tribunais consultados${tribunaisLinha ? `: ${tribunaisLinha}` : ''}.`,
    assuntos.length ? `Assuntos predominantes (classificação CNJ): ${assuntos.join('; ')}.` : '',
    '',
    'NATUREZA DESTE DADO: levantamento de VOLUME processual (metadado de',
    'acompanhamento). NÃO contém ementas, teses nem resultados de julgamento.',
    'Serve apenas para dimensionar que o tema é litigado. NÃO cite estes',
    'processos como precedente e NÃO construa ementas a partir deles.',
    '=== FIM DA ESTATÍSTICA ===',
  ].filter(Boolean).join('\n')
}
