// Camada de dados da sessão de lapidação (F0.3).
//
// As tabelas da sessão (085) têm RLS habilitada SEM policy: nem anon nem
// authenticated leem ou escrevem — só o service_role. A checagem de tenant,
// portanto, é feita AQUI, no código, e sempre pelo mesmo caminho: a peça é
// carregada com o client do USUÁRIO (RLS por tenant); tudo o mais pende dela.
//
// Regra da casa: helpers de rota vivem em src/lib (o build da Vercel rejeita
// exports extras em route.ts). Estas funções são o que as rotas da sessão
// chamam — os handlers são finos de propósito.

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import type { createClient } from '@/lib/supabase/server'
import type { SecaoPatch } from '@/lib/diff/patch-secoes'
import type { DocumentoSessao } from './montagem'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>
// Mesma instância de schema que createAdminClient(url, key) infere no call site
// (schema 'public'); ReturnType sem args cairia no genérico default (never) e
// faria .insert()/.update() aceitarem `never`. (Mesma nota do motor.ts.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseAdmin = ReturnType<typeof createAdminClient<any, 'public'>>

/** Client service_role — único que enxerga as tabelas da sessão. */
export function adminSessoes(): SupabaseAdmin {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export type StatusSessao = 'ativa' | 'aguardando_acao' | 'pausada_orcamento' | 'encerrada' | 'erro'
export type PapelTurno = 'advogado' | 'agente' | 'sistema'
export type TipoTurno = 'instrucao' | 'resposta' | 'proposta' | 'ferramenta' | 'anexo' | 'custo' | 'erro'
export type StatusProposta = 'pendente' | 'aceita' | 'parcial' | 'rejeitada' | 'expirada'

export interface PecaDaSessao {
  id: string
  atendimento_id: string
  area: string
  tipo: string
  versao: number
  conteudo_markdown: string | null
  status: string
}

export interface SessaoPeca {
  id: string
  tenant_id: string
  peca_id: string
  driver: string
  modelo: string
  effort: string | null
  status: StatusSessao
  orcamento_usd: number | null
  custo_lista_usd: number
  tokens: Record<string, unknown> | null
  versao_inicial: number | null
  criada_por: string | null
  criada_em: string
  atualizada_em: string
  encerrada_em: string | null
}

export interface TurnoPeca {
  id: string
  sessao_id: string
  numero: number
  papel: PapelTurno
  tipo: TipoTurno
  conteudo: string | null
  payload: Record<string, unknown> | null
  versao_resultante: number | null
  proposta_id: string | null
  custo_usd: number
  tokens: Record<string, unknown> | null
  criado_por: string | null
  criado_em: string
}

export interface PropostaPeca {
  id: string
  sessao_id: string
  turno_id: string | null
  versao_base: number | null
  resumo: string | null
  patch: SecaoPatch[]
  status: StatusProposta
  decisoes: Record<string, unknown> | null
  versao_resultante: number | null
  criado_em: string
}

const CAMPOS_PECA = 'id, atendimento_id, area, tipo, versao, conteudo_markdown, status'

/** Carrega a peça pelo client do USUÁRIO — é aqui que o tenant é conferido. */
export async function carregarPecaDoTenant(
  supabase: SupabaseServer,
  pecaId: string,
  tenantId: string,
): Promise<PecaDaSessao | null> {
  const { data } = await supabase
    .from('pecas')
    .select(CAMPOS_PECA)
    .eq('id', pecaId)
    .eq('tenant_id', tenantId)
    .single()
  return (data as PecaDaSessao | null) ?? null
}

/** Nomes por extenso da área e do tipo (para o cabeçalho do contexto). */
export function rotulosDaPeca(peca: { area: string; tipo: string }): { areaNome: string; tipoNome: string } {
  return {
    areaNome: AREAS[peca.area as AreaId]?.nome ?? peca.area,
    tipoNome: TIPOS_PECA[peca.tipo]?.nome ?? peca.tipo,
  }
}

/** A sessão ATIVA da peça (só pode haver uma por vez). */
export async function sessaoAtivaDaPeca(
  admin: SupabaseAdmin,
  pecaId: string,
): Promise<SessaoPeca | null> {
  const { data } = await admin
    .from('pecas_sessoes')
    .select('*')
    .eq('peca_id', pecaId)
    .eq('status', 'ativa')
    .order('criada_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as SessaoPeca | null) ?? null
}

/** Sessões da peça, mais recente primeiro (lista "retomar sessão"). */
export async function listarSessoesDaPeca(
  admin: SupabaseAdmin,
  pecaId: string,
  tenantId: string,
): Promise<SessaoPeca[]> {
  const { data } = await admin
    .from('pecas_sessoes')
    .select('*')
    .eq('peca_id', pecaId)
    .eq('tenant_id', tenantId)
    .order('criada_em', { ascending: false })
  return (data as SessaoPeca[] | null) ?? []
}

/** Uma sessão específica — sempre amarrada à peça e ao tenant já validados. */
export async function carregarSessao(
  admin: SupabaseAdmin,
  params: { sessaoId: string; pecaId: string; tenantId: string },
): Promise<SessaoPeca | null> {
  const { data } = await admin
    .from('pecas_sessoes')
    .select('*')
    .eq('id', params.sessaoId)
    .eq('peca_id', params.pecaId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle()
  return (data as SessaoPeca | null) ?? null
}

export async function listarTurnos(admin: SupabaseAdmin, sessaoId: string): Promise<TurnoPeca[]> {
  const { data } = await admin
    .from('pecas_turnos')
    .select('*')
    .eq('sessao_id', sessaoId)
    .order('numero', { ascending: true })
  return (data as TurnoPeca[] | null) ?? []
}

export async function listarPropostas(admin: SupabaseAdmin, sessaoId: string): Promise<PropostaPeca[]> {
  const { data } = await admin
    .from('pecas_propostas')
    .select('*')
    .eq('sessao_id', sessaoId)
    .order('criado_em', { ascending: true })
  return (data as PropostaPeca[] | null) ?? []
}

export async function carregarProposta(
  admin: SupabaseAdmin,
  params: { propostaId: string; sessaoId: string },
): Promise<PropostaPeca | null> {
  const { data } = await admin
    .from('pecas_propostas')
    .select('*')
    .eq('id', params.propostaId)
    .eq('sessao_id', params.sessaoId)
    .maybeSingle()
  return (data as PropostaPeca | null) ?? null
}

/** Próximo número de turno da sessão (UNIQUE (sessao_id, numero) no banco). */
export async function proximoNumeroTurno(admin: SupabaseAdmin, sessaoId: string): Promise<number> {
  const { data } = await admin
    .from('pecas_turnos')
    .select('numero')
    .eq('sessao_id', sessaoId)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle()
  return ((data?.numero as number | undefined) ?? -1) + 1
}

export interface NovoTurno {
  sessaoId: string
  papel: PapelTurno
  tipo: TipoTurno
  conteudo?: string | null
  payload?: Record<string, unknown> | null
  versaoResultante?: number | null
  propostaId?: string | null
  custoUsd?: number
  tokens?: Record<string, unknown> | null
  criadoPor?: string | null
  /** Número explícito (quando quem chama já o reservou). */
  numero?: number
}

/**
 * Insere um turno resolvendo o número por conta própria. Em caso de corrida
 * (dois turnos no mesmo instante), o UNIQUE (sessao_id, numero) rejeita e a
 * função tenta de novo com o número seguinte — três vezes, o suficiente para
 * um painel com um advogado e uma rodada por vez.
 */
export async function inserirTurno(admin: SupabaseAdmin, turno: NovoTurno): Promise<TurnoPeca | null> {
  let numero = turno.numero ?? (await proximoNumeroTurno(admin, turno.sessaoId))

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { data, error } = await admin
      .from('pecas_turnos')
      .insert({
        sessao_id: turno.sessaoId,
        numero,
        papel: turno.papel,
        tipo: turno.tipo,
        conteudo: turno.conteudo ?? null,
        payload: turno.payload ?? null,
        versao_resultante: turno.versaoResultante ?? null,
        proposta_id: turno.propostaId ?? null,
        custo_usd: turno.custoUsd ?? 0,
        tokens: turno.tokens ?? {},
        criado_por: turno.criadoPor ?? null,
      })
      .select('*')
      .single()

    if (!error) return data as TurnoPeca
    // 23505 = unique_violation: alguém pegou o número; tenta o próximo.
    if (error.code !== '23505') return null
    numero = await proximoNumeroTurno(admin, turno.sessaoId)
  }
  return null
}

/** Marca a sessão como tocada (usado em toda escrita). */
export async function tocarSessao(
  admin: SupabaseAdmin,
  sessaoId: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await admin
    .from('pecas_sessoes')
    .update({ ...patch, atualizada_em: new Date().toISOString() })
    .eq('id', sessaoId)
}

/**
 * Documentos que a sessão enxerga: os do dossiê do caso (já triados por
 * relevância pelo contexto) MAIS os anexados nesta sessão — que entram sempre,
 * mesmo que a triagem os tivesse descartado (o advogado anexou por um motivo).
 * Ordem determinística por id: o bloco é prefixo cacheado, não pode variar.
 *
 * ARTEFATOS DA IA FICAM DE FORA (origem='gerado', 086): a planilha que o próprio
 * agente acabou de escrever já está na conversa dele; reinjetá-la no contexto
 * custaria tokens e, pior, invalidaria o cache do dossiê a cada rodada que
 * gerasse arquivo. Quem precisa dela é o advogado, no dossiê.
 */
export async function documentosDaSessao(
  admin: SupabaseAdmin,
  params: {
    sessaoId: string
    tenantId: string
    /** Ids vindos da triagem do contexto do caso. */
    idsDoContexto: string[]
  },
): Promise<DocumentoSessao[]> {
  const { data: anexos } = await admin
    .from('pecas_sessoes_anexos')
    .select('documento_id')
    .eq('sessao_id', params.sessaoId)
    .neq('origem', 'gerado')

  const idsAnexados = new Set(((anexos ?? []) as Array<{ documento_id: string }>).map((a) => a.documento_id))
  const ids = [...new Set([...params.idsDoContexto, ...idsAnexados])]
  if (ids.length === 0) return []

  const { data } = await admin
    .from('documentos')
    .select('id, file_name, tipo, texto_extraido, resumo_ia')
    .in('id', ids)
    .eq('tenant_id', params.tenantId)

  const docs = ((data ?? []) as Array<{
    id: string; file_name: string; tipo: string; texto_extraido: string | null; resumo_ia: string | null
  }>).map((d) => ({
    id: d.id,
    file_name: d.file_name,
    tipo: d.tipo,
    texto_extraido: d.texto_extraido,
    resumo_ia: d.resumo_ia,
    anexado: idsAnexados.has(d.id),
  }))

  return docs.sort((a, b) => a.id.localeCompare(b.id))
}
