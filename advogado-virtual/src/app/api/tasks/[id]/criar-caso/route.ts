import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { ehAreaValida, nomeArea } from '@/lib/tarefas/area-inferida'
import { coletarSinaisCaso, resolverAreaDoCaso } from '@/lib/tarefas/area-inferida-servidor'
import { montarTituloCaso, criarCasoDaTarefa } from '@/lib/tarefas/criar-caso-da-tarefa'
import { construirHref } from '@/lib/tarefas/acao'

export const maxDuration = 30

// Área opcional: escolha explícita do usuário (tem precedência sobre a inferência).
// Validada contra os ids reais de AREAS via superRefine para uma mensagem clara.
const schema = z.object({
  area: z
    .string()
    .optional()
    .refine((v) => v == null || ehAreaValida(v), { message: 'Área inválida' }),
})

// Vínculo único (processo/cliente) + a origem (publicação) + o processo (classe/
// órgão/assuntos p/ inferir a área e compor o título). process_id = CASO: se
// estiver preenchido, a tarefa JÁ tem caso e a rota recusa.
const SELECT = `
  id, description, origin_reference, process_id, cliente_id, processo_id,
  processo:processos!processo_id(id, classe, orgao_julgador, assuntos, apelido, numero_cnj, cliente_id, clientes(id, nome)),
  cliente:clientes!cliente_id(id, nome)
`

function um<T>(rel: T | T[] | null | undefined): T | null {
  return (Array.isArray(rel) ? rel[0] : rel) ?? null
}

/**
 * POST /api/tasks/[id]/criar-caso — dá 1 clique da tarefa (nascida de publicação,
 * vinculada a processo/cliente SEM caso) ao motor de peças: infere a área pelos
 * dados (escolha do usuário > regra > IA), cria o CASO pré-preenchido com os
 * mesmos campos da criação manual, grava a publicação de origem como material
 * inicial, re-vincula a tarefa ao caso e devolve a URL do motor. Nada gera peça
 * sozinho — o humano conduz o motor.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const areaEscolhida = ehAreaValida(parsed.data.area) ? parsed.data.area : null

  const { data: task, error } = await supabase
    .from('tasks')
    .select(SELECT)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()

  if (error) return jsonError(error.message, 500)
  if (!task) return jsonError('Tarefa não encontrada', 404)

  // JÁ tem caso (atendimento) → nada a criar (evita duplicar o caso).
  if (task.process_id) return jsonError('Esta tarefa já está ligada a um caso.', 409)

  const processo = um(task.processo as unknown)
  const proc = processo as
    | { id: string; classe: string | null; orgao_julgador: string | null; assuntos: unknown; apelido: string | null; numero_cnj: string | null; cliente_id: string | null; clientes?: unknown }
    | null
  const processoId = (task.processo_id as string | null) ?? null

  // Precisa de processo OU cliente vinculado para nascer o caso.
  if (!processoId && !task.cliente_id) {
    return jsonError('Vincule um cliente ou processo à tarefa antes de criar o caso.', 400)
  }

  // Cliente do caso: o vínculo direto tem prioridade; senão o cliente do processo.
  const cliDireto = um(task.cliente as unknown) as { id: string; nome: string | null } | null
  const cliProc = um(proc?.clientes) as { id: string; nome: string | null } | null
  const clienteId = (task.cliente_id as string | null) ?? proc?.cliente_id ?? cliProc?.id ?? null
  const clienteNome = cliDireto?.nome ?? cliProc?.nome ?? null
  if (!clienteId) {
    return jsonError('Não há cliente vinculado ao processo para abrir o caso.', 400)
  }

  const titulo = (task.description as string | null) ?? ''

  // Sinais (processo + publicação de origem) → resolve a área por precedência.
  const sinais = await coletarSinaisCaso(supabase, usuario.tenant_id, {
    processoId,
    originReference: (task.origin_reference as string | null) ?? null,
  })
  const { area, confianca, via } = await resolverAreaDoCaso(supabase, usuario, sinais, areaEscolhida)

  // Título do caso: "<classe/tipo> — <número mascarado>".
  const tituloCaso = montarTituloCaso({
    classe: proc?.classe ?? sinais.classe,
    apelido: proc?.apelido ?? null,
    numeroCnj: proc?.numero_cnj ?? null,
    numeroMascara: sinais.numeroMascara,
    tituloTarefa: titulo,
  })

  let casoId: string
  try {
    const res = await criarCasoDaTarefa(supabase, id, {
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      clienteId,
      area,
      titulo: tituloCaso,
      // Pedido específico = título da tarefa (a ação determinada pela publicação).
      pedidoEspecifico: titulo,
      processoId,
      publicacao: {
        data: sinais.publicacaoData,
        inteiroTeor: sinais.inteiroTeor,
        numeroMascara: sinais.numeroMascara,
        numeroCnj: proc?.numero_cnj ?? null,
        resumoCache: sinais.sugestoesResumo,
      },
    })
    casoId = res.casoId

    // Auditoria: só ids/contagens (LGPD). Registra a via da área p/ telemetria.
    await logAudit({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      action: 'tarefa.caso_criado',
      resourceType: 'atendimento',
      resourceId: casoId,
      metadata: { taskId: id, area, via, confianca, comMaterial: res.comMaterial },
    })
  } catch (err) {
    logger.error('tarefa.criar_caso.falha', { taskId: id }, err)
    return jsonError(err instanceof Error ? err.message : 'Falha ao criar o caso', 500)
  }

  // URL do motor de peças (mesma lógica da rota /acao — tipo detectado do título).
  const hrefMotor = construirHref('peca', {
    titulo,
    dueDate: null,
    atendimentoId: casoId,
    area,
    clienteId,
    clienteNome,
    processoId,
  })

  return NextResponse.json({ casoId, area, areaNome: nomeArea(area), hrefMotor })
}
