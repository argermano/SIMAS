/**
 * Serviço de consulta à API Pública DataJud (CNJ)
 * Docs: https://datajud-wiki.cnj.jus.br/api-publica/
 *
 * A API usa Elasticsearch. Cada tribunal tem um endpoint:
 * POST https://api-publica.datajud.cnj.jus.br/api_publica_{alias}/_search
 */

import { logger } from '@/lib/logger'

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
 * Confirma a EXISTÊNCIA de um processo pelo número exato no índice DataJud do
 * tribunal (alias derivado do próprio nº CNJ). Best-effort: retorna o total de
 * ocorrências, ou null em erro/timeout (o DataJud é lento e limitado — nunca
 * bloqueia a validação). Usa `size:0` (só a contagem) para ser leve.
 *
 * @returns nº de ocorrências (0 = não localizado), ou null (inconclusivo).
 */
export async function contarProcessoExato(
  alias: string,
  numeroLimpo: string,
  timeoutMs = 12000,
): Promise<number | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${DATAJUD_BASE}/api_publica_${alias}/_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `APIKey ${DATAJUD_API_KEY}`,
      },
      body: JSON.stringify({
        size: 0,
        track_total_hits: true,
        query: { term: { numeroProcesso: numeroLimpo } },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    const total = data?.hits?.total?.value
    return typeof total === 'number' ? total : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Busca UM processo pelo número exato e devolve seus metadados (classe, órgão,
 * assuntos, movimentos) — para a capa do caso (E2). Best-effort: null em
 * erro/timeout ou se não localizado. O alias do índice é derivado do próprio nº.
 */
export async function buscarProcessoPorNumero(
  alias: string,
  numeroLimpo: string,
  timeoutMs = 12000,
): Promise<ResultadoJurisprudencia | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${DATAJUD_BASE}/api_publica_${alias}/_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `APIKey ${DATAJUD_API_KEY}`,
      },
      body: JSON.stringify({
        size: 1,
        query: { term: { numeroProcesso: numeroLimpo } },
        _source: ['numeroProcesso', 'classe', 'assuntos', 'orgaoJulgador', 'dataAjuizamento', 'dataHoraUltimaAtualizacao', 'grau', 'movimentos'],
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    const hit = data.hits?.hits?.[0]
    if (!hit) return null
    const src = hit._source as Record<string, unknown>
    const assuntos = (src.assuntos as Array<{ nome?: string }>) ?? []
    const movimentos = (src.movimentos as Array<{ nome?: string; dataHora?: string }>) ?? []
    const orgao = (src.orgaoJulgador as { nome?: string }) ?? {}
    const classe = (src.classe as { nome?: string }) ?? {}
    return {
      tribunal: alias.toUpperCase(),
      numeroProcesso: (src.numeroProcesso as string) ?? numeroLimpo,
      classe: classe.nome ?? '',
      assuntos: assuntos.map((a) => a.nome ?? '').filter(Boolean),
      orgaoJulgador: orgao.nome ?? '',
      dataAjuizamento: (src.dataAjuizamento as string)?.substring(0, 10) ?? '',
      ultimaAtualizacao: (src.dataHoraUltimaAtualizacao as string)?.substring(0, 10) ?? '',
      grau: (src.grau as string) ?? '',
      movimentos: movimentos
        .filter((m) => m.nome)
        .slice(-5)
        .map((m) => ({ nome: m.nome ?? '', data: m.dataHora?.substring(0, 10) ?? '' })),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ── Fase 5: consulta completa (capa + TODOS os movimentos brutos) ───────── */

/** DataJud usa dois formatos de data: ISO ("2026-03-11T…") e compacto
 * ("20250730161039" = AAAAMMDDHHmmss). Normaliza ambos para ISO (ou null). */
export function datajudDataParaISO(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  if (v.includes('-') || v.includes('T')) return v
  const d = v.replace(/\D/g, '')
  if (d.length < 8) return null
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` +
    (d.length >= 14 ? `T${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}` : '')
  return iso
}

export interface MovimentoBruto {
  codigo: number | null
  nome: string
  dataHora: string | null // ISO original do DataJud
  complementos: Array<Record<string, unknown>>
  raw: Record<string, unknown> // íntegra do registro do movimento
}

export interface ProcessoCompleto {
  tribunal: string
  numeroProcesso: string
  classe: string
  orgaoJulgador: string
  assuntos: string[]
  grau: string
  dataAjuizamento: string | null // ISO
  dataHoraUltimaAtualizacao: string | null // ISO
  dadosCapa: Record<string, unknown> // _source bruto (sem o array de movimentos)
  movimentos: MovimentoBruto[] // todos, ordenados por dataHora asc
}

/** Resultado da consulta completa, distinguindo os três desfechos:
 *  - ProcessoCompleto  → encontrado;
 *  - 'nao_encontrado'  → consulta OK, porém ZERO hits (processo novo ainda não
 *    indexado neste tribunal — não é falha, o retry diário resolve);
 *  - null              → falha de rede/5xx/timeout após as tentativas (inconclusivo). */
export type ResultadoProcessoCompleto = ProcessoCompleto | 'nao_encontrado' | null

/**
 * Busca UM processo pelo número e devolve a capa + TODOS os movimentos brutos
 * (para armazenar a íntegra — Fase 5). Best-effort: null em erro/timeout ou não
 * localizado. Separada de buscarProcessoPorNumero (E2) para não alterar aquele contrato.
 */
/** Uma tentativa de fetch. `retry:true` = falha transitória (rejeição do ES,
 * timeout, rede, 5xx/429) → vale re-tentar. `retry:false` sem src = 0 hits
 * (definitivo). */
async function fetchProcessoRaw(
  alias: string,
  numeroLimpo: string,
  timeoutMs: number,
): Promise<{ retry: boolean; src?: Record<string, unknown> }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${DATAJUD_BASE}/api_publica_${alias}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `APIKey ${DATAJUD_API_KEY}` },
      body: JSON.stringify({ size: 1, query: { term: { numeroProcesso: numeroLimpo } } }),
      signal: ctrl.signal,
    })
    if (!res.ok) return { retry: true } // 429/503/5xx: sobrecarga → re-tenta
    const data = await res.json()
    // O DataJud às vezes responde 200 com { error: es_rejected_execution_exception }.
    if (data && data.error) return { retry: true }
    const hit = data.hits?.hits?.[0]
    if (!hit) return { retry: false } // 0 hits: número não está neste índice (definitivo)
    return { retry: false, src: hit._source as Record<string, unknown> }
  } catch {
    return { retry: true } // timeout/rede
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Busca UM processo pelo número e devolve a capa + TODOS os movimentos brutos
 * (para armazenar a íntegra — Fase 5). A API pública do DataJud oscila (rejeita
 * consultas por sobrecarga), então re-tenta com backoff nas falhas transitórias.
 * Distingue os desfechos: ProcessoCompleto (achou), 'nao_encontrado' (consulta OK
 * com 0 hits — processo novo ainda não indexado) ou null (falha após as tentativas).
 * Separada de buscarProcessoPorNumero (E2) para não alterar aquele contrato.
 */
export async function buscarProcessoCompletoPorNumero(
  alias: string,
  numeroLimpo: string,
  timeoutMs = 12000,
  tentativas = 3,
): Promise<ResultadoProcessoCompleto> {
  let src: Record<string, unknown> | undefined
  let respondeu = false // consulta autoritativa (achou OU 0 hits), não só falha transitória
  for (let i = 0; i < tentativas; i++) {
    const r = await fetchProcessoRaw(alias, numeroLimpo, timeoutMs)
    if (!r.retry) {
      src = r.src
      respondeu = true
      break // resposta autoritativa (achou ou 0 hits)
    }
    if (i < tentativas - 1) await sleep(700 * (i + 1)) // backoff 0.7s, 1.4s
  }
  // 0 hits definitivo (consulta respondeu) → não indexado; falhou tudo → inconclusivo.
  if (!src) return respondeu ? 'nao_encontrado' : null

  // Contrato do DataJud: distinguir 'movimentos' AUSENTE/renomeado (anomalia de
  // contrato) de array presente e vazio (zero movimentos de verdade). Um hit sem
  // a chave 'movimentos' colapsando em [] seria reportado como sync bem-sucedido
  // com 0 novos → congelamento silencioso da timeline (e, se o campo voltar, uma
  // rajada de "novos" antigos). Tratamos ausência/tipo inesperado como falha
  // TRANSITÓRIA (null): não zera/apaga nada, o retry diário reconsulta. Array []
  // presente passa direto como zero legítimo. LGPD: só código/contagem do
  // envelope — nunca o conteúdo (pode conter dados pessoais).
  const movsRaw = src.movimentos
  if (!Array.isArray(movsRaw)) {
    logger.error('datajud.contrato.movimentos_ausente', {
      alias,
      presente: movsRaw !== undefined,
      tipo: typeof movsRaw,
      campos: Object.keys(src).length,
    })
    return null
  }
  const rawMovs = movsRaw as Array<Record<string, unknown>>
  const assuntos = (src.assuntos as Array<{ nome?: string }>) ?? []
  const orgao = (src.orgaoJulgador as { nome?: string }) ?? {}
  const classe = (src.classe as { nome?: string }) ?? {}
  const { movimentos: _omit, ...capaSemMovs } = src

  const movimentos: MovimentoBruto[] = rawMovs
    .map((m) => ({
      codigo: typeof m.codigo === 'number' ? (m.codigo as number) : Number(m.codigo) || null,
      nome: (m.nome as string) ?? '',
      dataHora: datajudDataParaISO(m.dataHora),
      complementos: (m.complementosTabelados as Array<Record<string, unknown>>) ?? [],
      raw: m,
    }))
    .filter((m) => m.nome)
    .sort((a, b) => (a.dataHora ?? '').localeCompare(b.dataHora ?? ''))

  return {
    tribunal: alias.toUpperCase(),
    numeroProcesso: (src.numeroProcesso as string) ?? numeroLimpo,
    classe: classe.nome ?? '',
    orgaoJulgador: orgao.nome ?? '',
    assuntos: assuntos.map((a) => a.nome ?? '').filter(Boolean),
    grau: (src.grau as string) ?? '',
    dataAjuizamento: datajudDataParaISO(src.dataAjuizamento),
    dataHoraUltimaAtualizacao: datajudDataParaISO(src.dataHoraUltimaAtualizacao),
    dadosCapa: capaSemMovs,
    movimentos,
  }
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
