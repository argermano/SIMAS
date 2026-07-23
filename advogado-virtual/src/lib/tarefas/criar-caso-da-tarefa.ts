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
import { encryptField } from '@/lib/encryption'
import { completionText, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { verificarCota } from '@/lib/anthropic/quota'
import { logUsage } from '@/lib/anthropic/usage'
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

/**
 * Cabeçalho SEMPRE presente no relato do caso vindo de publicação:
 * "Caso criado a partir da publicação de DD/MM no processo <nº mascarado>."
 * Degrada com elegância: sem data omite "de DD/MM"; sem número omite "no processo …".
 * PURO (testável).
 */
export function montarCabecalhoPublicacao(
  data: string | null | undefined,
  numeroMascara: string | null | undefined,
): string {
  const partes = ['Caso criado a partir da publicação']
  const dm = diaMesBR(data)
  if (dm) partes.push(`de ${dm}`)
  const num = (numeroMascara ?? '').trim()
  if (num) partes.push(`no processo ${num}`)
  return `${partes.join(' ')}.`
}

/**
 * Monta o RELATO ("Descreva o caso") a partir da publicação, por PRIORIDADE:
 *   (i)   resumoCache  — análise cacheada das sugestões da publicação (`sugestoes_ia.resumo`);
 *   (ii)  resumoIA     — resumo objetivo gerado por UMA chamada de IA (quando não há cache);
 *   (iii) inteiroTeor  — inteiro teor truncado (IA indisponível/falhou).
 * SEMPRE prefixado pelo cabeçalho (data + nº mascarado). Sem nenhum insumo ⇒ null.
 * PURO (testável): a orquestração da IA/cache é do chamador; aqui só a escolha + o cabeçalho.
 */
export function montarRelatoCaso(input: {
  publicacaoData: string | null
  numeroMascara: string | null
  resumoCache?: string | null
  resumoIA?: string | null
  inteiroTeor?: string | null
}): string | null {
  const corpo = primeiro(input.resumoCache, input.resumoIA, input.inteiroTeor)
  if (!corpo) return null
  return `${montarCabecalhoPublicacao(input.publicacaoData, input.numeroMascara)}\n\n${corpo}`
}

// ── Resumo por IA do inteiro teor (só quando NÃO há cache) ────────────────────
// LGPD: nunca logamos o teor — só tamanhos. Passa pela cota/uso da casa (endpoint
// 'resumo_caso_tarefa', log-only) e por timeout curto; qualquer falha ⇒ null (o
// chamador cai no inteiro teor truncado). Prompt mínimo, saída curta.
const RESUMO_TIMEOUT_MS = 8_000
const RESUMO_MAX_TOKENS = 400
/** Inteiro teor enviado à IA (curto) e usado como fallback (iii) truncado. */
const TEOR_MAX_CHARS = 2_000

const SYSTEM_RESUMO_CASO =
  'Você resume uma publicação/intimação de diário oficial (DJEN) para o advogado usar como PONTO DE PARTIDA de uma peça. ' +
  'Em pt-BR, escreva de 4 a 8 linhas objetivas: o que o juízo ou a parte comunicou e o que precisa ser providenciado. ' +
  'Baseie-se APENAS no texto fornecido — não invente fatos, datas ou fundamentos legais. ' +
  'Sem saudação e sem título: devolva só o resumo.'

/** Promise com corte de tempo: rejeita após `ms` (o chamador cai no fallback). */
function comTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

async function resumirInteiroTeorParaCaso(
  db: Db,
  ids: { tenantId: string; userId: string },
  teor: string,
): Promise<string | null> {
  const cota = await verificarCota(db, ids.tenantId, 'resumo_caso_tarefa')
  if (!cota.permitido) return null
  const start = Date.now()
  try {
    const { text, usage } = await comTimeout(
      completionText({
        system: SYSTEM_RESUMO_CASO,
        prompt: teor.slice(0, TEOR_MAX_CHARS),
        model: DEFAULT_MODEL,
        maxTokens: RESUMO_MAX_TOKENS,
      }),
      RESUMO_TIMEOUT_MS,
    )
    await logUsage({
      tenantId: ids.tenantId,
      userId: ids.userId,
      endpoint: 'resumo_caso_tarefa',
      modelo: DEFAULT_MODEL,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      latenciaMs: Date.now() - start,
    })
    return text.trim() || null
  } catch (err) {
    // LGPD: só o tamanho, nunca o teor.
    logger.error('tarefa.resumo_caso.ia_falha', { teorLen: teor.length }, err)
    return null
  }
}

/**
 * Resolve o RELATO do caso a partir da publicação de origem (cache > IA > inteiro
 * teor). Só chama a IA quando NÃO há cache e há inteiro teor. Sem publicação ⇒ null.
 */
async function resolverRelatoDoCaso(
  db: Db,
  ids: { tenantId: string; userId: string },
  pub: CriarCasoInput['publicacao'],
): Promise<string | null> {
  if (!pub) return null

  const numeroMascara = primeiro(
    pub.numeroMascara,
    pub.numeroCnj ? formatarCnj(pub.numeroCnj) : null,
  )
  const resumoCache = (pub.resumoCache ?? '').trim() || null
  const teor = (pub.inteiroTeor ?? '').trim()

  let resumoIA: string | null = null
  let inteiroTeor: string | null = null
  if (!resumoCache && teor) {
    resumoIA = await resumirInteiroTeorParaCaso(db, ids, teor)
    if (!resumoIA) inteiroTeor = teor.slice(0, TEOR_MAX_CHARS)
  }

  return montarRelatoCaso({
    publicacaoData: pub.data,
    numeroMascara,
    resumoCache,
    resumoIA,
    inteiroTeor,
  })
}

export interface CriarCasoInput {
  tenantId: string
  userId: string
  clienteId: string
  area: string
  titulo: string
  /** PEDIDO ESPECÍFICO do caso = título da tarefa (a ação determinada). Preenche
   * `pedidos_especificos` na CRIAÇÃO (campo vazio); nunca sobrescreve nada existente. */
  pedidoEspecifico: string | null
  /** Processo a herdar como vínculo do atendimento (vinculo_processo_id). */
  processoId: string | null
  /** Material inicial da publicação de origem (se houver): inteiro teor + data +
   * nº do processo (mascarado ou CNJ cru p/ mascarar) + resumo CACHEADO da IA. */
  publicacao: {
    data: string | null
    inteiroTeor: string | null
    numeroMascara: string | null
    numeroCnj: string | null
    resumoCache: string | null
  } | null
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
  // 0) RELATO para o gerador (cache > IA > inteiro teor), com cabeçalho. Fora do
  //    INSERT porque pode chamar a IA (timeout curto); qualquer falha ⇒ null/teor
  //    truncado — nunca bloqueia a criação do caso.
  const relato = await resolverRelatoDoCaso(
    db,
    { tenantId: input.tenantId, userId: input.userId },
    input.publicacao,
  )
  const pedido = (input.pedidoEspecifico ?? '').trim()

  // 1) Atendimento — mesmos campos/defaults da criação manual (POST /api/atendimentos):
  //    status 'caso_novo', modo_input 'texto' (abre na aba "Digitar" com o relato
  //    VISÍVEL/editável), estagio 'caso'. Vínculo ao processo via a coluna do tipo.
  //    O relato/pedido só entram na CRIAÇÃO (campos vazios): o humano segue dono do
  //    texto — daqui em diante nada aqui sobrescreve o que ele editar.
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
  // transcricao_editada é dado sensível → cifrado em repouso (o GET decifra).
  if (relato) inserir.transcricao_editada = encryptField(relato)
  if (pedido) inserir.pedidos_especificos = pedido
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
