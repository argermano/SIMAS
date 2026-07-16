import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { extrairTextoPlano, partesDoMeta, advogadoMonitorado, classificarPublicacao } from '@/lib/processos/djen'
import { prioridadeDaCategoria, type PrioridadeRelevancia } from '@/lib/processos/categorias'

// ─────────────────────────────────────────────────────────────
// GET /api/publicacoes — caixa de entrada paginada (Lote 2)
// Lista enxuta da triagem: NÃO devolve `texto` (HTML bruto dos tribunais) nem
// `meta`; o `texto` entra no SELECT só para derivar `trecho` no servidor.
// ─────────────────────────────────────────────────────────────

// Filtros de query (todos opcionais; validados com zod). `page` default 1.
// `statusIn` (lista de status separados por vírgula) e `triadaEm` (recorte por
// `triada_em` num dia SP) existem para que o clique nos tiles do topo abra
// EXATAMENTE os itens contados por /saude — tratadas de hoje é a UNIÃO de
// 'triada'+'tarefa_criada' recortada por `triada_em`, e não cabe num `status`
// único nem no recorte de `data_disponibilizacao` (de/ate).
const schemaQuery = z.object({
  status:   z.enum(['nova', 'triada', 'tarefa_criada', 'descartada']).optional(),
  statusIn: z.string().max(80).optional(),
  tribunal: z.string().max(20).optional(),
  oab:      z.string().max(20).optional(),
  tipo:     z.string().max(80).optional(),
  q:        z.string().max(200).optional(),
  de:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD)').optional(),
  ate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD)').optional(),
  triadaEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD)').optional(),
  ordenar:  z.enum(['data', 'prioridade']).optional(),
  page:     z.coerce.number().int().positive().default(1),
})

// Conjunto de status válidos p/ higienizar o `statusIn` (evita valor arbitrário
// vazar no `.in(...)`).
const STATUS_VALIDOS = new Set(['nova', 'triada', 'tarefa_criada', 'descartada'])

const PAGE_SIZE = 20

// Colunas da LISTA (payload enxuto). `texto` só p/ derivar `trecho` — nunca sai.
const COLUNAS_LISTA =
  'id, data_disponibilizacao, data_publicacao_sugerida, sigla_tribunal, tipo_documento, ' +
  'tipo_comunicacao, numero_processo, numero_mascara, orgao_julgador, status, ' +
  'oab_consultada, uf_oab, processo_id, task_id, texto, meta'

interface LinhaLista {
  id: string
  data_disponibilizacao: string
  data_publicacao_sugerida: string | null
  sigla_tribunal: string | null
  tipo_documento: string | null
  tipo_comunicacao: string | null
  numero_processo: string | null
  numero_mascara: string | null
  orgao_julgador: string | null
  status: string
  oab_consultada: string
  uf_oab: string
  processo_id: string | null
  task_id: string | null
  texto: string | null
  meta: unknown
}

// Resumo do processo vinculado exposto na LISTA (link p/ o cliente na tabela).
interface ProcessoVinculadoLista {
  id: string
  clienteId: string
  clienteNome: string | null
  ultimaSincronizacao: string | null // rótulo "Andamentos atualizados …" (059)
}

export async function GET(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  // Empty strings viram undefined (ex.: `?status=`) — o enum/regex do zod só
  // valida valores presentes de fato.
  const parsed = schemaQuery.safeParse({
    status:   searchParams.get('status')   || undefined,
    statusIn: searchParams.get('statusIn') || undefined,
    tribunal: searchParams.get('tribunal') || undefined,
    oab:      searchParams.get('oab')      || undefined,
    tipo:     searchParams.get('tipo')     || undefined,
    q:        searchParams.get('q')        || undefined,
    de:       searchParams.get('de')       || undefined,
    ate:      searchParams.get('ate')      || undefined,
    triadaEm: searchParams.get('triadaEm') || undefined,
    ordenar:  searchParams.get('ordenar')  || undefined,
    page:     searchParams.get('page')     || undefined,
  })
  if (!parsed.success) return jsonError('Filtros inválidos', 400, parsed.error.flatten())
  const { status, statusIn, tribunal, oab, tipo, q, de, ate, triadaEm, ordenar, page } = parsed.data

  const offset = (page - 1) * PAGE_SIZE
  // Prioridade é derivada (categoria → relevância), não coluna do banco: não dá
  // para ordenar/paginar por ela no SQL. Nesse modo buscamos uma janela ampla,
  // classificamos, ordenamos e paginamos EM MEMÓRIA. Cap defensivo p/ o modo
  // prioridade não virar um SELECT ilimitado (base do piloto é pequena; além do
  // teto a ordenação global degrada, mas nunca estoura). No modo padrão (data
  // desc) o banco continua paginando com range (sem custo extra).
  const porPrioridade = ordenar === 'prioridade'
  const PRIORIDADE_CAP = 500

  let query = supabase
    .from('publicacoes')
    .select(COLUNAS_LISTA, { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id) // defesa em profundidade (RLS já isola)
    .order('data_disponibilizacao', { ascending: false })
    .order('created_at', { ascending: false }) // tie-break estável p/ paginação
  // Modo prioridade: janela ampla p/ ordenar em memória; padrão: página do banco.
  query = porPrioridade
    ? query.limit(PRIORIDADE_CAP)
    : query.range(offset, offset + PAGE_SIZE - 1)

  // Status: `statusIn` (união higienizada) tem precedência sobre `status` único.
  const statusList = statusIn
    ? statusIn.split(',').map((s) => s.trim()).filter((s) => STATUS_VALIDOS.has(s))
    : []
  if (statusList.length) query = query.in('status', statusList)
  else if (status)       query = query.eq('status', status)

  if (tribunal) query = query.eq('sigla_tribunal', tribunal)
  if (oab)      query = query.eq('oab_consultada', oab)
  if (de)       query = query.gte('data_disponibilizacao', de)
  if (ate)      query = query.lte('data_disponibilizacao', ate)
  // Filtro por TIPO: ilike no tipo do documento OU no tipo da comunicação (a API
  // preenche um ou outro). Higieniza os chars estruturais do `or` do PostgREST.
  if (tipo) {
    const termoTipo = tipo.replace(/[,()*]/g, ' ').trim()
    if (termoTipo) query = query.or(`tipo_documento.ilike.*${termoTipo}*,tipo_comunicacao.ilike.*${termoTipo}*`)
  }
  // Recorte por `triada_em` num dia (janela SP [00:00, +1d 00:00) em -03:00).
  // Espelha o cálculo de /saude; o Brasil não observa horário de verão (offset fixo).
  if (triadaEm) {
    const [ano, mes, dia] = triadaEm.split('-').map(Number)
    const amanha = new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10)
    query = query
      .gte('triada_em', `${triadaEm}T00:00:00-03:00`)
      .lt('triada_em', `${amanha}T00:00:00-03:00`)
  }
  if (q) {
    // ilike em `texto` E `numero_processo`. Remove os chars ESTRUTURAIS do filtro
    // `or` do PostgREST ( , ( ) ) para o termo do usuário não quebrar/injetar a
    // expressão; `*` é o coringa nativo do `or`.
    const termo = q.replace(/[,()*]/g, ' ').trim()
    if (termo) query = query.or(`texto.ilike.*${termo}*,numero_processo.ilike.*${termo}*`)
  }

  const { data, error, count } = await query
  if (error) return jsonError(error.message, 500)

  const linhas = (data ?? []) as unknown as LinhaLista[]

  // Deriva o texto plano (reuso p/ trecho), a categoria curada e a prioridade de
  // RELEVÂNCIA (não prazo) UMA vez por linha, no servidor. `texto`/`meta` crus
  // nunca saem no payload.
  const enriquecidas = linhas.map((p) => {
    const textoPlano = extrairTextoPlano(p.texto)
    const categoria = classificarPublicacao({ tipoDocumento: p.tipo_documento ?? '', textoPlano })
    return { p, textoPlano, categoria, prioridade: prioridadeDaCategoria(categoria) }
  })

  // Ordenação por prioridade (alta→baixa). O empate mantém a data desc que o banco
  // já aplicou — Array.sort é estável, então a ordem de entrada é o tie-break.
  if (porPrioridade) {
    const rank: Record<PrioridadeRelevancia, number> = { alta: 0, media: 1, baixa: 2 }
    enriquecidas.sort((a, b) => rank[a.prioridade] - rank[b.prioridade])
  }

  // No modo prioridade paginamos em memória (a janela ampla foi ordenada acima);
  // no padrão o banco já entregou exatamente a página via range.
  const paginaAtual = porPrioridade ? enriquecidas.slice(offset, offset + PAGE_SIZE) : enriquecidas

  // Processo vinculado (id/cliente) resolvido em LOTE p/ os itens da página —
  // 1 query em `processos` + 1 em `clientes` (sem N+1). `clientes.nome` é plaintext.
  const processoIds = [...new Set(paginaAtual.map((e) => e.p.processo_id).filter((v): v is string => !!v))]
  const vinculadoPorProcesso = new Map<string, ProcessoVinculadoLista>()
  if (processoIds.length) {
    const { data: procs } = await supabase
      .from('processos')
      .select('id, cliente_id, ultima_sincronizacao')
      .eq('tenant_id', usuario.tenant_id) // defesa em profundidade (RLS já isola)
      .in('id', processoIds)
    const procsList = (procs ?? []) as { id: string; cliente_id: string; ultima_sincronizacao: string | null }[]

    const clienteIds = [...new Set(procsList.map((p) => p.cliente_id).filter(Boolean))]
    const nomePorCliente = new Map<string, string | null>()
    if (clienteIds.length) {
      const { data: clis } = await supabase
        .from('clientes')
        .select('id, nome')
        .eq('tenant_id', usuario.tenant_id)
        .in('id', clienteIds)
      for (const c of (clis ?? []) as { id: string; nome: string | null }[]) {
        nomePorCliente.set(c.id, c.nome ?? null)
      }
    }
    for (const p of procsList) {
      vinculadoPorProcesso.set(p.id, {
        id: p.id,
        clienteId: p.cliente_id,
        clienteNome: nomePorCliente.get(p.cliente_id) ?? null,
        ultimaSincronizacao: p.ultima_sincronizacao ?? null,
      })
    }
  }

  const publicacoes = paginaAtual.map(({ p, textoPlano, categoria, prioridade }) => {
    const { texto: _texto, meta, ...rest } = p
    return {
      ...rest,
      // Identidade do caso (partes) e advogado monitorado derivados server-side —
      // meta/texto NUNCA saem no payload (enxuto + seguro).
      partes: partesDoMeta(meta),
      advogado: advogadoMonitorado(meta, p.oab_consultada),
      trecho: textoPlano.slice(0, 160),
      // Hint de RELEVÂNCIA (não prazo): categoria curada + prioridade derivada.
      categoria,
      prioridade,
      processoVinculado: p.processo_id ? vinculadoPorProcesso.get(p.processo_id) ?? null : null,
    }
  })

  // No modo prioridade a paginação é sobre a JANELA em memória (teto PRIORIDADE_CAP):
  // o nº de páginas segue as linhas efetivamente carregadas, e não o `count` total,
  // senão surgem páginas fantasma vazias além do teto que prendem o usuário numa
  // lista sem controles. No modo padrão o range do banco casa com o `count`.
  const totalPaginas = porPrioridade
    ? Math.ceil(enriquecidas.length / PAGE_SIZE)
    : Math.ceil((count ?? 0) / PAGE_SIZE)

  return NextResponse.json({
    publicacoes,
    total:        count ?? 0,
    pagina:       page,
    totalPaginas,
  })
}
