import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { extrairTextoPlano } from '@/lib/processos/djen'

// ─────────────────────────────────────────────────────────────
// GET /api/publicacoes — caixa de entrada paginada (Lote 2)
// Lista enxuta da triagem: NÃO devolve `texto` (HTML bruto dos tribunais) nem
// `meta`; o `texto` entra no SELECT só para derivar `trecho` no servidor.
// ─────────────────────────────────────────────────────────────

// Filtros de query (todos opcionais; validados com zod). `page` default 1.
const schemaQuery = z.object({
  status:   z.enum(['nova', 'triada', 'tarefa_criada', 'descartada']).optional(),
  tribunal: z.string().max(20).optional(),
  oab:      z.string().max(20).optional(),
  q:        z.string().max(200).optional(),
  de:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD)').optional(),
  ate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD)').optional(),
  page:     z.coerce.number().int().positive().default(1),
})

const PAGE_SIZE = 20

// Colunas da LISTA (payload enxuto). `texto` só p/ derivar `trecho` — nunca sai.
const COLUNAS_LISTA =
  'id, data_disponibilizacao, data_publicacao_sugerida, sigla_tribunal, tipo_documento, ' +
  'tipo_comunicacao, numero_processo, numero_mascara, orgao_julgador, status, ' +
  'oab_consultada, uf_oab, processo_id, task_id, texto'

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
    tribunal: searchParams.get('tribunal') || undefined,
    oab:      searchParams.get('oab')      || undefined,
    q:        searchParams.get('q')        || undefined,
    de:       searchParams.get('de')       || undefined,
    ate:      searchParams.get('ate')      || undefined,
    page:     searchParams.get('page')     || undefined,
  })
  if (!parsed.success) return jsonError('Filtros inválidos', 400, parsed.error.flatten())
  const { status, tribunal, oab, q, de, ate, page } = parsed.data

  const offset = (page - 1) * PAGE_SIZE

  let query = supabase
    .from('publicacoes')
    .select(COLUNAS_LISTA, { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id) // defesa em profundidade (RLS já isola)
    .order('data_disponibilizacao', { ascending: false })
    .order('created_at', { ascending: false }) // tie-break estável p/ paginação
    .range(offset, offset + PAGE_SIZE - 1)

  if (status)   query = query.eq('status', status)
  if (tribunal) query = query.eq('sigla_tribunal', tribunal)
  if (oab)      query = query.eq('oab_consultada', oab)
  if (de)       query = query.gte('data_disponibilizacao', de)
  if (ate)      query = query.lte('data_disponibilizacao', ate)
  if (q) {
    // ilike em `texto` E `numero_processo`. Remove os chars ESTRUTURAIS do filtro
    // `or` do PostgREST ( , ( ) ) para o termo do usuário não quebrar/injetar a
    // expressão; `*` é o coringa nativo do `or`.
    const termo = q.replace(/[,()*]/g, ' ').trim()
    if (termo) query = query.or(`texto.ilike.*${termo}*,numero_processo.ilike.*${termo}*`)
  }

  const { data, error, count } = await query
  if (error) return jsonError(error.message, 500)

  const publicacoes = ((data ?? []) as unknown as LinhaLista[]).map((p) => {
    const { texto, ...rest } = p
    return { ...rest, trecho: extrairTextoPlano(texto).slice(0, 220) }
  })

  return NextResponse.json({
    publicacoes,
    total:        count ?? 0,
    pagina:       page,
    totalPaginas: Math.ceil((count ?? 0) / PAGE_SIZE),
  })
}
