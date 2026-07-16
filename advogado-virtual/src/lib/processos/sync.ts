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
import { completionJSON } from '@/lib/anthropic/client'
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

/** Hash estável do registro bruto do movimento (dedup no sync). O índice único
 * (processo_id, raw_hash) é a garantia real de idempotência; este hash é a chave. */
export function hashMovimento(raw: unknown): string {
  return createHash('md5').update(JSON.stringify(raw)).digest('hex')
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

/** Gera resumos em linguagem natural para os movimentos novos (Haiku, em lote). */
async function gerarResumos(movs: MovimentoBruto[]): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(movs.length).fill(null)
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
      const { result } = await completionJSON<{ resumos: string[] }>({
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 1500,
        system: RESUMO_SYSTEM,
        prompt:
          `Resuma cada movimento abaixo. Devolva JSON {"resumos": [...]} com EXATAMENTE ` +
          `${slice.length} itens, na mesma ordem dos movimentos.\n\n${lista}`,
      })
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

/** Sincroniza UM processo: busca no DataJud, insere movimentos novos (delta por
 * hash), classifica, resume, atualiza a capa e — quando NÃO é o snapshot inicial —
 * dispara/enfileira avisos ao cliente conforme a config. Retorna null se a
 * consulta falhou (best-effort: fica para a próxima execução).
 *
 * `notificar` default true; o cadastro passa false. A trava real contra aviso
 * retroativo é o `baseline` (processo sem nenhum movimento ainda ⇒ 1º snapshot ⇒
 * nunca notifica), que protege mesmo se o cron pegar um cadastro cujo sync imediato falhou. */
async function syncUmProcesso(
  admin: Admin,
  proc: ProcessoRow,
  opts?: { notificar?: boolean; datajud?: { timeoutMs?: number; tentativas?: number } },
): Promise<SyncResultado | null> {
  const dados = await buscarProcessoCompletoPorNumero(
    proc.tribunal_alias,
    proc.numero_cnj,
    opts?.datajud?.timeoutMs,
    opts?.datajud?.tentativas,
  )
  if (!dados) return null

  const comHash = dados.movimentos.map((m) => ({ m, hash: hashMovimento(m.raw) }))

  const { data: existentes } = await admin
    .from('processo_movimentos')
    .select('raw_hash')
    .eq('processo_id', proc.id)
  const jaTem = new Set((existentes ?? []).map((r: { raw_hash: string }) => r.raw_hash))
  // Baseline = processo nunca sincronizado com sucesso (ultima_sincronizacao null).
  // NÃO usar a contagem de movimentos: um movimento SIMULADO (teste) inseriria uma
  // linha e faria o 1º sync real achar que já havia histórico, notificando tudo
  // retroativo. ultima_sincronizacao só é setada por um sync real bem-sucedido.
  const baseline = !proc.ultima_sincronizacao // 1º snapshot → nunca notifica

  // Novos, deduplicados também localmente (o DataJud às vezes repete um registro).
  const vistos = new Set<string>()
  const novos = comHash.filter((x) => {
    if (jaTem.has(x.hash) || vistos.has(x.hash)) return false
    vistos.add(x.hash)
    return true
  })

  const resumos = novos.length ? await gerarResumos(novos.map((x) => x.m)) : []

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
      raw_hash: x.hash,
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

  // Envio automático: para cada 'pendente' recém-inserido, faz um CLAIM atômico
  // (só envia quem conseguir mudar de 'pendente'→'aprovada') e então envia. Isso
  // impede envio duplicado sob concorrência (unique index + claim) e evita órfãos.
  let enviados = 0
  if (notif?.aviso === 'automatico' && notif.telefone) {
    for (const r of inseridos.filter((r) => r.notif_status === 'pendente' && r.notif_texto)) {
      const { data: claim } = await admin
        .from('processo_movimentos')
        .update({ notif_status: 'aprovada' })
        .eq('id', r.id)
        .eq('notif_status', 'pendente')
        .select('id')
      if (!claim || claim.length === 0) continue // outro processo já pegou
      const res = await enviarAvisoWhatsApp(notif.telefone, r.notif_texto as string)
      if (res.ok) {
        enviados++
        await admin
          .from('processo_movimentos')
          .update({ notif_status: 'enviada', notif_enviada_em: new Date().toISOString() })
          .eq('id', r.id)
        await logAudit({
          tenantId: proc.tenant_id,
          action: 'processo.notificacao_enviada',
          resourceType: 'processo',
          resourceId: proc.id,
          metadata: { movimento_id: r.id, cliente_id: proc.cliente_id },
        })
      } else {
        await admin.from('processo_movimentos').update({ notif_status: 'erro' }).eq('id', r.id)
      }
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
): Promise<SyncResultado | null> {
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
      if (r) {
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
