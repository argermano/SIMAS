import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logger } from '@/lib/logger'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { verificarCota } from '@/lib/anthropic/quota'
import { logUsage } from '@/lib/anthropic/usage'
import {
  classificarAcaoTarefa,
  contextoAlvoDaTask,
  construirHref,
  tituloNaoTrivial,
  ACAO_META,
  type AcaoTarefa,
  type AcaoConcreta,
} from '@/lib/tarefas/acao'

export const maxDuration = 30

// Vínculo único (cliente | caso | processo) + campos p/ montar o alvo. Mesmos
// joins do embed da lista de tarefas, reduzidos ao necessário.
const SELECT = `
  id, description, due_date, completed_at, origin_reference,
  process_id, cliente_id, processo_id,
  atendimentos(id, area, clientes(id, nome)),
  cliente:clientes!cliente_id(id, nome),
  processo:processos!processo_id(id, clientes(id, nome))
`

// Timeout curto da 1 chamada de IA de desempate (a classificação é trivial;
// preferimos cair no fallback a segurar o clique do usuário).
const IA_TIMEOUT_MS = 8_000
const IA_MAX_TOKENS = 20

const SYSTEM_CLASSIFICADOR = `Você classifica UMA tarefa de escritório de advocacia em exatamente UMA categoria, pela INTENÇÃO do título:
- "peca": produzir uma peça jurídica (petição, recurso, apelação, contrarrazões, contestação, réplica, embargos, manifestação, emenda, alegações finais...).
- "agendamento": marcar/realizar um contato ou compromisso (ligação, reunião, atendimento, entrevista, agendar algo).
- "documento": lidar com arquivos/documentos (juntar, escanear, digitalizar, anexar, reunir comprovantes/documentação).
- "processo": ato ou verificação processual (protocolar, retirar, conferir, verificar, acompanhar, diligência).
Responda só com {"acao":"peca|agendamento|documento|processo"}.`

const schemaIA = z.object({ acao: z.enum(['peca', 'agendamento', 'documento', 'processo']) })

/** Promise com corte de tempo: rejeita após `ms` (o alvo de fallback assume). */
function comTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

type AuthUsuario = { id: string; tenant_id: string }
type SupabaseServer = Extract<Awaited<ReturnType<typeof getAuthContext>>, { ok: true }>['supabase']

/**
 * Desempate por IA quando a regex não decidiu. Passa pela cota/uso da casa,
 * envia SÓ o título (LGPD) e cai em 'processo' em qualquer falha/timeout — a IA
 * apenas PREPARA o alvo, nunca conclui a tarefa.
 */
async function classificarComIA(
  supabase: SupabaseServer,
  usuario: AuthUsuario,
  titulo: string,
): Promise<AcaoConcreta> {
  const cota = await verificarCota(supabase, usuario.tenant_id, 'classificar_tarefa')
  if (!cota.permitido) return 'processo'

  const start = Date.now()
  try {
    const { result, usage } = await comTimeout(
      completionJSON<{ acao: AcaoConcreta }>({
        system: SYSTEM_CLASSIFICADOR,
        prompt: `Título da tarefa: "${titulo.slice(0, 300)}"`,
        model: DEFAULT_MODEL,
        maxTokens: IA_MAX_TOKENS,
        schema: schemaIA,
      }),
      IA_TIMEOUT_MS,
    )
    await logUsage({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      endpoint: 'classificar_tarefa',
      modelo: DEFAULT_MODEL,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      latenciaMs: Date.now() - start,
    })
    return result.acao
  } catch (err) {
    // LGPD: só o tamanho do título nos logs, nunca o conteúdo.
    logger.error('tarefa.acao.ia_falha', { tituloLen: titulo.length }, err)
    return 'processo'
  }
}

/**
 * POST /api/tasks/[id]/acao — classifica a tarefa e devolve o alvo pré-resolvido
 * do botão "Resolver" (ação + rótulo + URL com ids). A decisão vem na resposta
 * (o cliente cacheia); nada é persistido. A IA só entra como desempate quando a
 * regex não decide e o título é não-trivial.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: task, error } = await supabase
    .from('tasks')
    .select(SELECT)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()

  if (error) return jsonError(error.message, 500)
  if (!task) return jsonError('Tarefa não encontrada', 404)

  const titulo = (task.description as string | null) ?? ''

  let acao: AcaoTarefa = classificarAcaoTarefa(titulo)
  let via: 'regex' | 'ia' = 'regex'

  if (acao === 'indefinido') {
    if (tituloNaoTrivial(titulo)) {
      acao = await classificarComIA(supabase, usuario, titulo)
      via = 'ia'
    } else {
      acao = 'processo' // fallback determinístico p/ títulos triviais
    }
  }

  const ctx = contextoAlvoDaTask(task)
  const href = construirHref(acao, ctx)
  const meta = ACAO_META[acao]

  return NextResponse.json({
    acao,
    rotulo: meta.rotulo,
    icone: meta.icone,
    href,
    via,
    concluida: !!task.completed_at,
  })
}
