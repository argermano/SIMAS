// Fase 5 — sincronização de processos com o DataJud.
// Delta por hash do movimento (idempotente pelo índice único), classificação de
// categoria e resumo em linguagem natural (1x, no primeiro sync do movimento).
// NÃO envia notificação — isso é o Lote 2 (fila/automático). Aqui todo movimento
// novo entra com notif_status='nao_aplicavel'. Ver docs/PLANO-FASE-5-OPUS.md §4.

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarProcessoCompletoPorNumero, type MovimentoBruto } from '@/lib/jurisprudencia/datajud'
import { classificarMovimento, sugereEncerramento, categoriasNotificaveis } from './categorias'
import { montarTextoAviso, enviarAvisoWhatsApp } from './notificar'
import { reivindicarEEnviarAviso } from './aviso-movimentacao'
import { completionJSON } from '@/lib/anthropic/client'
import { verificarCota } from '@/lib/anthropic/quota'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { criarTarefaAutomatica } from '@/lib/financeiro/gancho-contrato'

type Admin = SupabaseClient

interface ProcessoRow {
  id: string
  tenant_id: string
  cliente_id: string
  numero_cnj: string
  tribunal_alias: string
  situacao: string
  apelido: string | null
  ultima_sincronizacao: string | null
}

/** Formata 20 dígitos → NNNNNNN-DD.AAAA.J.TR.OOOO (rótulo do processo no aviso). */
function formatarCNJProc(d: string): string {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length !== 20) return d
  return `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16, 20)}`
}

/** Hash do registro bruto do movimento — LEGADO. Sensível à ordem das chaves e à
 * presença de campos (é md5 do JSON cru do DataJud). Mantido para: (a) o dedup do
 * DJEN, que hasheia {djen: it.id} (chave única estável — não sofre do problema);
 * (b) o movimento SIMULADO; (c) casar linhas gravadas ANTES do hash canônico
 * (transição sem reimportação). NÃO usar como chave nova de dedup do DataJud —
 * ver hashMovimentoCanonico. */
export function hashMovimento(raw: unknown): string {
  return createHash('md5').update(JSON.stringify(raw)).digest('hex')
}

/** Serialização canônica: ordena as chaves recursivamente. Torna o hash IMUNE à
 * ordem em que o Elasticsearch do tribunal emite os campos e à ordem que o JSONB
 * do Postgres devolve (nenhum dos dois preserva ordem de chaves). */
function canonicalizar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalizar)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalizar(o[k])
        return acc
      }, {})
  }
  return v
}

/** Hash ESTÁVEL do movimento por PROJEÇÃO canônica (codigo + nome + dataHora +
 * complementos), e não pelo objeto CRU do DataJud. O legado hashMovimento(m.raw)
 * é sensível à ordem das chaves e à ADIÇÃO de campos pelo Elasticsearch: um bump de
 * schema do CNJ reidrataria TODOS os hashes → cada movimento existente pareceria
 * "novo" → duplicata em massa na base (1.314 processos) + reaviso retroativo à
 * carteira. Esta projeção só olha os campos estáveis; campos novos são ignorados.
 * `dataHora` é normalizada a epoch para casar com a coluna `data_hora`
 * (TIMESTAMPTZ) relida do banco no recompute (ver syncUmProcesso). Exportado p/ teste. */
export function hashMovimentoCanonico(p: {
  codigo: number | null
  nome: string | null
  dataHora: string | null
  complementos: unknown
}): string {
  const t = p.dataHora ? new Date(p.dataHora).getTime() : NaN
  const proj = {
    codigo: p.codigo ?? null,
    nome: p.nome ?? '',
    data: Number.isNaN(t) ? null : t,
    complementos: canonicalizar(p.complementos ?? []),
  }
  return createHash('md5').update(JSON.stringify(proj)).digest('hex')
}

const RESUMO_SYSTEM =
  'Você resume movimentações processuais para um cliente leigo de um escritório de advocacia. ' +
  'Para CADA movimento escreva UMA frase curta, factual e em português claro, sem jargão jurídico, ' +
  'sem opinião, sem valores e sem estratégia. Exemplos: "Trânsito em Julgado" → "A decisão se tornou ' +
  'definitiva — não cabe mais recurso."; "Conclusão para despacho" → "O processo foi enviado ao juiz ' +
  'para uma decisão."; "Juntada de Petição" → "Um documento foi anexado ao processo."'

const complementoTexto = (c: Array<Record<string, unknown>> | undefined): string =>
  (c ?? [])
    .map((x) => Object.values(x).filter((v) => typeof v === 'string').join(' '))
    .filter(Boolean)
    .join('; ')

/** Item mínimo para resumir um movimento (nome técnico + complementos brutos). */
export interface ResumoItem {
  nome: string
  complementos?: Array<Record<string, unknown>>
}

// Preço do Haiku por 1K tokens — espelha PRECOS_1K de anthropic/usage.ts (os
// resumos de cron rodam SEMPRE em Haiku). Duplicado aqui de propósito: logUsage
// insere via cliente anon (RLS) e exige usuário logado, inexistente no cron.
const PRECO_HAIKU_1K = { input: 0.001, output: 0.005 }
const MODELO_RESUMO = 'claude-haiku-4-5-20251001'

/** Contexto p/ instrumentar a IA dos CRONS (sem usuário logado). `admin` é o
 * cliente service_role (loga em api_usage_log e checa cota bypassando a RLS);
 * `tenantId` é conhecido no loop. Ver AUDITORIA-2026-07-21 §21. */
export interface UsoIaCron {
  admin: Admin
  tenantId: string
  endpoint: string // ex.: 'resumo_movimento' | 'resumo_publicacao'
}

/** Cota do tenant para o resumo de cron. ADVISÓRIA: o cron nunca deve derrubar o
 * sync factual, então fail-open em erro; só retorna false quando o tenant estourou
 * um limite REAL (categoria de cron não tem limite hoje → sempre permite, mas a
 * máquina fica pronta se um teto for definido em LIMITES_PLANO). */
export async function cotaPermiteResumo(ctx: UsoIaCron): Promise<boolean> {
  try {
    return (await verificarCota(ctx.admin, ctx.tenantId, ctx.endpoint)).permitido
  } catch {
    return true
  }
}

/** Registra o uso de IA do cron no api_usage_log via service_role, com user_id
 * NULL (uso de sistema — ver migration 074). Nunca lança: log impreciso não pode
 * derrubar o sync. */
export async function registrarUsoIaCron(
  ctx: UsoIaCron,
  usage: { input: number; output: number },
  latenciaMs: number,
): Promise<void> {
  try {
    const custo = (usage.input / 1000) * PRECO_HAIKU_1K.input + (usage.output / 1000) * PRECO_HAIKU_1K.output
    const { error } = await ctx.admin.from('api_usage_log').insert({
      tenant_id: ctx.tenantId,
      user_id: null,
      endpoint: ctx.endpoint,
      modelo: MODELO_RESUMO,
      tokens_input: usage.input,
      tokens_output: usage.output,
      custo_estimado: custo,
      latencia_ms: latenciaMs,
    })
    if (error) logger.error('processos.uso_ia_cron', { tenant: ctx.tenantId, endpoint: ctx.endpoint }, error)
  } catch (err) {
    logger.error('processos.uso_ia_cron.excecao', { endpoint: ctx.endpoint }, err as Error)
  }
}

/** Gera resumos em linguagem natural para os movimentos (Haiku, em lotes de 30).
 * Best-effort por chunk: falha de rede deixa aquele item com null (não derruba os
 * demais). Exportada para reuso pelo cron de reparo (movimentos sem resumo_ia).
 * `ctx` (opcional) instrumenta o uso quando roda num cron: registra o custo em
 * api_usage_log e respeita a cota do tenant (se estourada, pula os resumos —
 * NUNCA quebra o sync factual). Sem `ctx` (ex.: reparo cross-tenant) nada muda. */
export async function gerarResumos(movs: ResumoItem[], ctx?: UsoIaCron): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(movs.length).fill(null)
  if (movs.length === 0) return out
  if (ctx && !(await cotaPermiteResumo(ctx))) return out // cota estourada → pula (factual segue)
  const CHUNK = 30
  for (let i = 0; i < movs.length; i += CHUNK) {
    const slice = movs.slice(i, i + CHUNK)
    const lista = slice
      .map((m, j) => {
        const comp = complementoTexto(m.complementos)
        return `${j + 1}. ${m.nome}${comp ? ` (${comp})` : ''}`
      })
      .join('\n')
    try {
      const t0 = Date.now()
      const { result, usage } = await completionJSON<{ resumos: string[] }>({
        model: MODELO_RESUMO,
        maxTokens: 1500,
        system: RESUMO_SYSTEM,
        prompt:
          `Resuma cada movimento abaixo. Devolva JSON {"resumos": [...]} com EXATAMENTE ` +
          `${slice.length} itens, na mesma ordem dos movimentos.\n\n${lista}`,
      })
      if (ctx) await registrarUsoIaCron(ctx, usage, Date.now() - t0)
      const rs = Array.isArray(result?.resumos) ? result.resumos : []
      for (let j = 0; j < slice.length; j++) {
        if (typeof rs[j] === 'string' && rs[j].trim()) out[i + j] = rs[j].trim()
      }
    } catch (err) {
      // Best-effort: sem resumo o movimento ainda é armazenado (resumo_ia null).
      logger.error('processos.sync.resumos', { chunk: i, total: movs.length }, err as Error)
    }
  }
  return out
}

interface SyncResultado {
  novos: number
  encerrou: boolean
  pendentes: number // avisos enfileirados p/ aprovação (modo fila)
  enviados: number // avisos enviados na hora (modo automático)
}

/** Desfecho de um sync: SyncResultado (ok), 'nao_encontrado' (consulta OK, mas o
 * tribunal ainda não indexou o processo — não é falha) ou null (DataJud oscilou). */
export type SyncOutcome = SyncResultado | 'nao_encontrado' | null

/** Sincroniza UM processo: busca no DataJud, insere movimentos novos (delta por
 * hash), classifica, resume, atualiza a capa e — quando NÃO é o snapshot inicial —
 * dispara/enfileira avisos ao cliente conforme a config. Retorna 'nao_encontrado'
 * se o tribunal ainda não indexou o processo (não toca em capa/movimentos/sync) ou
 * null se a consulta ao DataJud falhou (best-effort: fica para a próxima execução).
 *
 * `notificar` default true; o cadastro passa false. A trava real contra aviso
 * retroativo é o `baseline` (processo sem nenhum movimento ainda ⇒ 1º snapshot ⇒
 * nunca notifica), que protege mesmo se o cron pegar um cadastro cujo sync imediato falhou. */
async function syncUmProcesso(
  admin: Admin,
  proc: ProcessoRow,
  opts?: { notificar?: boolean; datajud?: { timeoutMs?: number; tentativas?: number } },
): Promise<SyncOutcome> {
  const dados = await buscarProcessoCompletoPorNumero(
    proc.tribunal_alias,
    proc.numero_cnj,
    opts?.datajud?.timeoutMs,
    opts?.datajud?.tentativas,
  )
  // Não indexado ainda (0 hits): não seta ultima_sincronizacao nem mexe em movimentos.
  if (dados === 'nao_encontrado') return 'nao_encontrado'
  if (!dados) return null

  // Dedup por PROJEÇÃO canônica (imune à ordem de chaves e a campos novos do ES),
  // com o hash LEGADO como desempate — ver hashMovimentoCanonico e
  // AUDITORIA-2026-07-21 §6. Cada movimento carrega os dois hashes: o legado (casa
  // linhas gravadas ANTES desta mudança) e o canônico (gravado daqui pra frente).
  // Transição SEM reimportação: enquanto o schema do DataJud não mudar, as linhas
  // antigas casam pelo legado; se mudar, casam pelo canônico RECOMPUTADO das
  // próprias colunas já gravadas (abaixo) — sem backfill nem rajada de duplicatas.
  const comHash = dados.movimentos.map((m) => ({
    m,
    hashLegado: hashMovimento(m.raw),
    hashCanon: hashMovimentoCanonico({ codigo: m.codigo, nome: m.nome, dataHora: m.dataHora, complementos: m.complementos }),
  }))

  const { data: existentes } = await admin
    .from('processo_movimentos')
    .select('raw_hash, codigo, nome, data_hora, complementos')
    .eq('processo_id', proc.id)
  // Para cada linha existente entram no set: o raw_hash gravado (legado OU canônico)
  // E o canônico recomputado das colunas — este casa a linha antiga mesmo que o
  // DataJud reordene/adicione campos, sem depender do raw_hash gravado.
  const jaTem = new Set<string>()
  for (const r of (existentes ?? []) as Array<{
    raw_hash: string; codigo: number | null; nome: string | null; data_hora: string | null; complementos: unknown
  }>) {
    jaTem.add(r.raw_hash)
    jaTem.add(hashMovimentoCanonico({ codigo: r.codigo, nome: r.nome, dataHora: r.data_hora, complementos: r.complementos }))
  }
  // Baseline = processo nunca sincronizado com sucesso (ultima_sincronizacao null).
  // NÃO usar a contagem de movimentos: um movimento SIMULADO (teste) inseriria uma
  // linha e faria o 1º sync real achar que já havia histórico, notificando tudo
  // retroativo. ultima_sincronizacao só é setada por um sync real bem-sucedido.
  const baseline = !proc.ultima_sincronizacao // 1º snapshot → nunca notifica

  // Novos, deduplicados também localmente (o DataJud às vezes repete um registro).
  const vistos = new Set<string>()
  const novos = comHash.filter((x) => {
    if (jaTem.has(x.hashLegado) || jaTem.has(x.hashCanon) || vistos.has(x.hashCanon)) return false
    vistos.add(x.hashCanon)
    return true
  })

  const resumos = novos.length
    ? await gerarResumos(novos.map((x) => x.m), { admin, tenantId: proc.tenant_id, endpoint: 'resumo_movimento' })
    : []

  // Contexto de notificação — só carrega se pode notificar (evita I/O à toa).
  const podeNotificar = novos.length > 0 && !baseline && opts?.notificar !== false
  let notif: {
    aviso: 'fila' | 'automatico'
    telefone: string | null
    clienteNome: string | null
    escritorioNome: string | null
    notificaveis: Set<string>
  } | null = null
  if (podeNotificar) {
    const [{ data: cli }, { data: ten }] = await Promise.all([
      admin.from('clientes').select('nome, telefone, aviso_movimentacao').eq('id', proc.cliente_id).single(),
      admin.from('tenants').select('nome, config').eq('id', proc.tenant_id).single(),
    ])
    const aviso = cli?.aviso_movimentacao
    if (aviso === 'fila' || aviso === 'automatico') {
      notif = {
        aviso,
        telefone: (cli?.telefone as string) ?? null,
        clienteNome: (cli?.nome as string) ?? null,
        escritorioNome: (ten?.nome as string) ?? null,
        notificaveis: categoriasNotificaveis(ten?.config) as Set<string>,
      }
    }
  }

  const rotulo = proc.apelido || formatarCNJProc(proc.numero_cnj)

  let encerrou = false
  const linhas = novos.map((x, i) => {
    const categoria = classificarMovimento({ codigo: x.m.codigo, nome: x.m.nome, complementos: x.m.complementos })
    if (sugereEncerramento(categoria)) encerrou = true

    // Notificáveis entram como 'pendente' (fila E automático). O automático é
    // enviado logo abaixo via CLAIM atômico (pendente→aprovada). Se o envio
    // morrer no meio, o movimento permanece 'pendente' → recuperável na fila
    // (nunca fica órfão preso em 'aprovada').
    let notif_status = 'nao_aplicavel'
    let notif_texto: string | null = null
    if (notif && categoria && notif.notificaveis.has(categoria)) {
      notif_texto = montarTextoAviso({
        clienteNome: notif.clienteNome,
        resumo: resumos[i] ?? null,
        nomeTecnico: x.m.nome,
        rotuloProcesso: rotulo,
        escritorioNome: notif.escritorioNome,
      })
      notif_status = 'pendente'
    }
    return {
      processo_id: proc.id,
      codigo: x.m.codigo,
      nome: x.m.nome,
      data_hora: x.m.dataHora,
      complementos: x.m.complementos,
      raw: x.m.raw,
      raw_hash: x.hashCanon, // grava o canônico (estável); dedup futuro converge nele
      resumo_ia: resumos[i] ?? null,
      categoria,
      notif_status,
      notif_texto,
    }
  })

  let inseridos: Array<{ id: string; notif_status: string; notif_texto: string | null; categoria: string | null }> = []
  if (linhas.length) {
    const { data, error } = await admin
      .from('processo_movimentos')
      .upsert(linhas, { onConflict: 'processo_id,raw_hash', ignoreDuplicates: true })
      .select('id, notif_status, notif_texto, categoria')
    if (error) {
      logger.error('processos.sync.insert', { processo: proc.id }, error)
      return null
    }
    inseridos = data ?? []
  }

  // Envio automático: claim atômico (pendente→aprovada) + envio, deduplicado por
  // concorrência. Lógica compartilhada com o caminho DJEN em reivindicarEEnviarAviso
  // (fonte única — ver AUDITORIA-2026-07-21 §18).
  let enviados = 0
  if (notif?.aviso === 'automatico' && notif.telefone) {
    for (const r of inseridos.filter((r) => r.notif_status === 'pendente' && r.notif_texto)) {
      const desfecho = await reivindicarEEnviarAviso(admin, {
        movimentoId: r.id,
        telefone: notif.telefone,
        texto: r.notif_texto as string,
        tenantId: proc.tenant_id,
        processoId: proc.id,
        clienteId: proc.cliente_id,
        origem: 'datajud',
      })
      if (desfecho === 'enviado') enviados++
    }
  }
  // GANCHO FINANCEIRO (L1): alvará expedido em processo cujo cliente tem contrato
  // com percentual de êxito > 0 → tarefa automática "avaliar cobrança de êxito".
  // Best-effort (nunca derruba o sync) e com dedup por origin_reference
  // `exito:<movimentoId>`. NÃO mexe no fluxo de notificação acima. No snapshot
  // inicial (baseline) não cria tarefa — alvará histórico não é acionável agora,
  // mesma lógica que impede aviso retroativo.
  const alvaras = baseline ? [] : inseridos.filter((r) => r.categoria === 'expedicao_alvara')
  if (alvaras.length > 0) {
    try {
      // Só contrato VIGENTE (assinado, ou exportado no fluxo antigo) — rascunho
      // abandonado com percentual preenchido não pode sugerir cobrança de êxito.
      const { data: contratos } = await admin
        .from('contratos_honorarios')
        .select('percentual_exito')
        .eq('tenant_id', proc.tenant_id)
        .eq('cliente_id', proc.cliente_id)
        .in('status', ['assinado', 'exportado'])
        .gt('percentual_exito', 0)
        .limit(1)
      const pct = contratos?.[0]?.percentual_exito
      if (pct != null) {
        for (const r of alvaras) {
          await criarTarefaAutomatica(admin, {
            tenantId: proc.tenant_id,
            description: `Alvará expedido — avaliar cobrança de êxito (${Number(pct)}%) — processo ${rotulo}`,
            originReference: `exito:${r.id}`,
            processId: proc.id,
            priority: 'alta',
          })
        }
      }
    } catch (err) {
      logger.error('processos.sync.gancho_exito', { processo: proc.id }, err as Error)
    }
  }

  // Telemetria: notificáveis inseridos (todos entram 'pendente') menos os que o
  // automático enviou = os que ficaram na fila. (Objetos locais não refletem o
  // UPDATE no banco, então derivamos do contador de enviados.)
  const notificaveis = inseridos.filter((r) => r.notif_status === 'pendente').length
  const pendentes = Math.max(0, notificaveis - enviados)

  const patch: Record<string, unknown> = {
    classe: dados.classe || null,
    orgao_julgador: dados.orgaoJulgador || null,
    assuntos: dados.assuntos,
    grau: dados.grau || null,
    data_ajuizamento: dados.dataAjuizamento,
    datajud_atualizado_em: dados.dataHoraUltimaAtualizacao,
    dados_capa: dados.dadosCapa,
    ultima_sincronizacao: new Date().toISOString(),
    sync_pendente: false, // limpa a fila durável (059) em QUALQUER via: cron, botão, vínculo
  }
  if (encerrou && proc.situacao !== 'encerrado') patch.situacao = 'encerrado'
  const { error: upErr } = await admin.from('processos').update(patch).eq('id', proc.id)
  if (upErr) logger.error('processos.sync.capa', { processo: proc.id }, upErr)

  return { novos: linhas.length, encerrou, pendentes, enviados }
}

const COLS = 'id, tenant_id, cliente_id, numero_cnj, tribunal_alias, situacao, apelido, ultima_sincronizacao'

/** Sync de UM processo por id. No cadastro passe `notificar:false` (snapshot
 * histórico — nunca notifica retroativo); numa ressincronização manual, `true`. */
export async function sincronizarProcessoPorId(
  admin: Admin,
  processoId: string,
  opts?: { notificar?: boolean; datajud?: { timeoutMs?: number; tentativas?: number } },
): Promise<SyncOutcome> {
  const { data: proc } = await admin.from('processos').select(COLS).eq('id', processoId).single()
  if (!proc) return null
  return syncUmProcesso(admin, proc as ProcessoRow, opts)
}

/** Sync SOB DEMANDA dos processos de um cliente (chamado quando o próprio cliente
 * pergunta o andamento pelo WhatsApp). Só re-sincroniza os que estão "velhos"
 * (ultima_sincronizacao > maxIdadeMs), com budget CURTO no DataJud para não travar
 * o bot, e SEM notificar (o cliente já recebe a resposta na conversa). Best-effort:
 * se o DataJud não responder a tempo, a consulta segue com o dado armazenado. */
export async function sincronizarProcessosDoClienteSeVelho(
  admin: Admin,
  clienteId: string,
  opts?: { maxIdadeMs?: number; maxProcessos?: number; timeoutMs?: number },
): Promise<void> {
  const maxIdade = opts?.maxIdadeMs ?? 6 * 60 * 60 * 1000 // 6h
  const corte = Date.now() - maxIdade
  const { data: procs } = await admin
    .from('processos')
    .select('id, ultima_sincronizacao')
    .eq('cliente_id', clienteId)
    .eq('situacao', 'ativo')
    .limit(20)

  const velhos = (procs ?? [])
    .filter((p: { ultima_sincronizacao: string | null }) =>
      !p.ultima_sincronizacao || new Date(p.ultima_sincronizacao).getTime() < corte)
    .slice(0, opts?.maxProcessos ?? 5)
    .map((p: { id: string }) => p.id)
  if (velhos.length === 0) return

  // Paralelo com budget curto (timeout ~5s, 1 tentativa) → cabe na janela do bot.
  await Promise.all(
    velhos.map((id) =>
      sincronizarProcessoPorId(admin, id, {
        notificar: false,
        datajud: { timeoutMs: opts?.timeoutMs ?? 5000, tentativas: 1 },
      }).catch(() => null),
    ),
  )
}

/** Insere um movimento SIMULADO e roda o fluxo de aviso (teste on-demand do dono).
 * Não altera a capa nem encerra o processo. Usa exatamente o mesmo template/decisão
 * de notificação do sync real, para o teste refletir o comportamento de produção. */
export async function simularMovimento(
  admin: Admin,
  processoId: string,
  input?: { nome?: string; categoria?: string; resumo?: string },
): Promise<{ ok: boolean; notif_status: string; enviado: boolean; motivo?: string }> {
  const { data: proc } = await admin.from('processos').select(COLS).eq('id', processoId).single()
  if (!proc) return { ok: false, notif_status: 'nao_aplicavel', enviado: false, motivo: 'Processo não encontrado' }
  const p = proc as ProcessoRow

  const nome = input?.nome?.trim() || 'Sentença (movimento de TESTE)'
  const categoria = input?.categoria || classificarMovimento({ nome }) || 'sentenca'
  const resumo = input?.resumo?.trim() || 'Foi proferida uma decisão no seu processo (este é um movimento de teste).'
  const nowIso = new Date().toISOString()
  const raw = { _simulado: true, nome, dataHora: nowIso }
  const raw_hash = hashMovimento(raw) // baseado em "agora" → sempre único

  const [{ data: cli }, { data: ten }] = await Promise.all([
    admin.from('clientes').select('nome, telefone, aviso_movimentacao').eq('id', p.cliente_id).single(),
    admin.from('tenants').select('nome, config').eq('id', p.tenant_id).single(),
  ])
  const aviso = cli?.aviso_movimentacao as string | undefined
  const notificaveis = categoriasNotificaveis(ten?.config) as Set<string>
  const rotulo = p.apelido || formatarCNJProc(p.numero_cnj)

  let notif_status = 'nao_aplicavel'
  let notif_texto: string | null = null
  let motivo: string | undefined
  if (aviso !== 'fila' && aviso !== 'automatico') {
    motivo = 'Avisos desligados para este cliente — ative "Fila" ou "Automático" para testar.'
  } else if (!notificaveis.has(categoria)) {
    motivo = `A categoria "${categoria}" não está marcada como notificável nas Configurações.`
  } else {
    notif_texto = montarTextoAviso({
      clienteNome: cli?.nome ?? null,
      resumo,
      nomeTecnico: nome,
      rotuloProcesso: rotulo,
      escritorioNome: (ten?.nome as string) ?? null,
    })
    notif_status = aviso === 'automatico' && cli?.telefone ? 'aprovada' : 'pendente'
    if (aviso === 'automatico' && !cli?.telefone) motivo = 'Cliente sem telefone no cadastro — caiu na fila em vez de enviar.'
  }

  const { data: ins, error } = await admin
    .from('processo_movimentos')
    .insert({
      processo_id: p.id, codigo: null, nome, data_hora: nowIso,
      complementos: [], raw, raw_hash, resumo_ia: resumo, categoria, notif_status, notif_texto,
    })
    .select('id')
    .single()
  if (error || !ins) return { ok: false, notif_status, enviado: false, motivo: error?.message }

  let enviado = false
  if (notif_status === 'aprovada' && notif_texto && cli?.telefone) {
    const res = await enviarAvisoWhatsApp(cli.telefone as string, notif_texto)
    if (res.ok) {
      enviado = true
      notif_status = 'enviada'
      await admin.from('processo_movimentos').update({ notif_status, notif_enviada_em: new Date().toISOString() }).eq('id', ins.id)
      await logAudit({
        tenantId: p.tenant_id, action: 'processo.notificacao_enviada',
        resourceType: 'processo', resourceId: p.id, metadata: { movimento_id: ins.id, simulado: true },
      })
    } else {
      notif_status = 'erro'
      motivo = 'Falha ao enviar pelo WhatsApp (confira PROCESSOS_NOTIFY_URL/TOKEN e o ai-attendant).'
      await admin.from('processo_movimentos').update({ notif_status }).eq('id', ins.id)
    }
  }
  return { ok: true, notif_status, enviado, motivo }
}

/** Sync em lote (cron): processos ativos, mais desatualizados primeiro,
 * concorrência ≤ 3 e teto de tempo — o que não couber fica para a próxima. */
export async function sincronizarProcessos(
  admin: Admin,
  opts?: { deadlineMs?: number; max?: number; somentePendentes?: boolean },
): Promise<{ processos: number; novosMovimentos: number; consultados: number; pendentes: number; enviados: number }> {
  const deadline = Date.now() + (opts?.deadlineMs ?? 45_000)
  const max = opts?.max ?? 60

  // Arquitetura on-demand: o cron sincroniza processos de clientes VIP (aviso
  // proativo ligado, aviso_movimentacao != 'desligado') OU marcados na fila
  // durável sync_pendente (059 — publicação do DJEN casada = sinal de atividade).
  // Os demais só são sincronizados no cadastro, no botão de refresh, ou quando o
  // próprio cliente pergunta pelo WhatsApp. Isso limita o polling no DataJud público.
  //
  // `somentePendentes` (drain pós-DJEN): NÃO re-inclui os VIPs — eles já foram
  // sincronizados na 1ª passada deste mesmo cron; reconsultá-los aqui só DOBRARIA o
  // polling no DataJud (o dedup não traria nada novo). O drain existe só p/ escoar a
  // fila 059 que o DJEN acabou de marcar. Nesse modo nem buscamos os VIPs.
  const vipIds = opts?.somentePendentes
    ? []
    : ((await admin
        .from('clientes')
        .select('id')
        .neq('aviso_movimentacao', 'desligado')
        .is('deleted_at', null)).data ?? []).map((c: { id: string }) => c.id)

  let query = admin
    .from('processos')
    .select(COLS)
    .eq('situacao', 'ativo')
  // União VIP + fila de pendentes. COM VIPs: or(sync_pendente OU cliente_id in);
  // os UUIDs vão CITADOS para não quebrarem a expressão do or() do PostgREST. SEM
  // VIPs (ou somentePendentes): só a fila de pendentes — evita o `in.()` vazio (que
  // o PostgREST rejeita) e mantém o drain focado na 059.
  if (vipIds.length > 0) {
    const lista = vipIds.map((id: string) => `"${id}"`).join(',')
    query = query.or(`sync_pendente.is.true,cliente_id.in.(${lista})`)
  } else {
    query = query.eq('sync_pendente', true)
  }

  const { data: pend, error } = await query
    .order('ultima_sincronizacao', { ascending: true, nullsFirst: true })
    .limit(max)
  if (error) {
    logger.error('processos.sync.listar', {}, error)
    return { processos: 0, novosMovimentos: 0, consultados: 0, pendentes: 0, enviados: 0 }
  }

  const fila = (pend ?? []) as ProcessoRow[]
  let processos = 0
  let novosMovimentos = 0
  let consultados = 0
  let pendentes = 0
  let enviados = 0
  let idx = 0

  const worker = async () => {
    while (idx < fila.length && Date.now() < deadline) {
      const proc = fila[idx++]
      consultados++
      const r = await syncUmProcesso(admin, proc, { notificar: true })
      // 'nao_encontrado' e null são falhas leves: NÃO limpam sync_pendente (fica na
      // fila durável 059 para o retry diário). Só o sucesso contabiliza/atualiza.
      if (r && r !== 'nao_encontrado') {
        processos++
        novosMovimentos += r.novos
        pendentes += r.pendentes
        enviados += r.enviados
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, fila.length) }, worker))

  logger.info('processos.sync', { processos, consultados, novosMovimentos, pendentes, enviados })
  return { processos, novosMovimentos, consultados, pendentes, enviados }
}
