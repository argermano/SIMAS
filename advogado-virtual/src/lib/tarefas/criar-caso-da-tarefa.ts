// Criação do CASO (atendimento) a partir de uma tarefa nascida de publicação e
// vinculada a um processo/cliente sem caso. Reúne, num só lugar, os passos que
// espelham a criação MANUAL de atendimento (mesmos campos/defaults) + a gravação
// da publicação de origem como material inicial + a re-vinculação da tarefa ao
// caso. Fica em src/lib (a rota /criar-caso só exporta o handler).
//
// Invariantes: o caso é um registro REAL e auditado (a rota audita com os ids);
// nada gera peça sozinho — a rota devolve o href do motor e o humano conduz.

import type { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { vinculoAtendimentoParaColunas } from '@/lib/atendimentos'
import { vinculoParaColunas, formatarCnj } from './vinculo'
import { detectarTipoPeca } from './acao'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'

type Db = Awaited<ReturnType<typeof createClient>>

/** Primeiro valor não-vazio (trim) de uma lista, ou null. */
function primeiro(...vs: Array<string | null | undefined>): string | null {
  for (const v of vs) {
    const s = (v ?? '').trim()
    if (s) return s
  }
  return null
}

/** Rótulo da peça a partir do título da tarefa (para compor o título do caso). */
function rotuloPecaDoTitulo(tituloTarefa: string | null | undefined): string | null {
  const tipo = detectarTipoPeca(tituloTarefa ?? '')
  if (tipo && TIPOS_PECA[tipo]) return TIPOS_PECA[tipo].nome
  return null
}

/**
 * Monta o título do caso: "<classe/tipo> — <número mascarado>". Deriva o lado
 * esquerdo da classe do processo (ou do tipo de peça do título da tarefa) e o
 * direito do apelido/número CNJ mascarado. PURO (testável). Cap 200.
 */
export function montarTituloCaso(input: {
  classe?: string | null
  apelido?: string | null
  numeroCnj?: string | null
  numeroMascara?: string | null
  tituloTarefa?: string | null
}): string {
  const esquerda = primeiro(input.classe, rotuloPecaDoTitulo(input.tituloTarefa)) ?? 'Caso'
  const numeroFmt = input.numeroCnj ? formatarCnj(input.numeroCnj) : null
  const direita = primeiro(input.apelido, numeroFmt, input.numeroMascara)
  const titulo = direita ? `${esquerda} — ${direita}` : esquerda
  return titulo.slice(0, 200).trim()
}

/** Data BR (DD/MM) a partir de YYYY-MM-DD; string vazia se não parsear. */
function diaMesBR(ymd: string | null | undefined): string {
  const m = String(ymd ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}` : ''
}

export interface CriarCasoInput {
  tenantId: string
  userId: string
  clienteId: string
  area: string
  titulo: string
  /** Processo a herdar como vínculo do atendimento (vinculo_processo_id). */
  processoId: string | null
  /** Material inicial: inteiro teor + data da publicação de origem (se houver). */
  publicacao: { data: string | null; inteiroTeor: string | null } | null
}

/**
 * Cria o atendimento (mesmos campos da criação manual), grava a publicação de
 * origem como 1º registro do diário (best-effort) e re-vincula a tarefa ao caso
 * criado (respeitando o CHECK single-reference: process_id recebe o id, as
 * demais colunas vão a null). Devolve o id do caso e se o material foi gravado.
 */
export async function criarCasoDaTarefa(
  db: Db,
  taskId: string,
  input: CriarCasoInput,
): Promise<{ casoId: string; comMaterial: boolean }> {
  // 1) Atendimento — mesmos campos/defaults da criação manual (POST /api/atendimentos):
  //    status 'caso_novo', modo_input 'texto', estagio 'caso' (é um caso, não
  //    nascimento leve). Vínculo ao processo via a coluna do tipo (as outras null).
  const inserir: Record<string, unknown> = {
    tenant_id: input.tenantId,
    cliente_id: input.clienteId,
    user_id: input.userId,
    area: input.area,
    modo_input: 'texto',
    status: 'caso_novo',
    estagio: 'caso',
    titulo: input.titulo,
  }
  if (input.processoId) {
    Object.assign(inserir, vinculoAtendimentoParaColunas({ tipo: 'processo', id: input.processoId }))
  }

  const { data: atendimento, error } = await db
    .from('atendimentos')
    .insert(inserir)
    .select('id')
    .single()
  if (error || !atendimento) {
    throw new Error(error?.message ?? 'Falha ao criar o caso')
  }
  const casoId = atendimento.id as string

  // 2) Publicação de origem como material inicial (1º registro do diário).
  //    Best-effort: o caso já existe e é o objetivo do 1-clique; se o registro
  //    falhar, logamos (sem PII) e seguimos — o material não some da auditoria
  //    da publicação, que continua vinculada à tarefa.
  let comMaterial = false
  const teor = input.publicacao?.inteiroTeor?.trim()
  if (teor) {
    const dm = diaMesBR(input.publicacao?.data ?? null)
    const cabecalho = dm
      ? `Publicação de ${dm} que originou este caso`
      : 'Publicação que originou este caso'
    const { error: errReg } = await db.from('atendimento_registros').insert({
      tenant_id: input.tenantId,
      atendimento_id: casoId,
      user_id: input.userId,
      texto: `${cabecalho}\n\n${teor}`,
    })
    if (errReg) {
      logger.error('tarefa.criar_caso.registro_falhou', { casoId, teorLen: teor.length }, errReg)
    } else {
      comMaterial = true
    }
  }

  // 3) Re-vincula a tarefa ao CASO criado (single-reference: process_id recebe o
  //    id do atendimento; cliente_id/processo_id vão a null). Escopo de tenant.
  const { error: errLink } = await db
    .from('tasks')
    .update(vinculoParaColunas({ tipo: 'atendimento', id: casoId }))
    .eq('id', taskId)
    .eq('tenant_id', input.tenantId)
  if (errLink) {
    // O caso já existe (real e auditável). A re-vinculação falhou: logamos e
    // propagamos para a rota devolver erro claro (a tarefa segue sem caso).
    logger.error('tarefa.criar_caso.revinculo_falhou', { casoId, taskId }, errLink)
    throw new Error('Caso criado, mas falha ao vincular a tarefa. Recarregue e tente novamente.')
  }

  return { casoId, comMaterial }
}
