import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { relayFetch } from '@/lib/conversas/relay'
import { mesmoTelefone } from '@/lib/conversas/telefone'
import { TAMANHO_PAGINA_CONVERSAS } from '@/lib/conversas/lista-infinita'
import { janelaDiaSaoPaulo } from '@/lib/tarefas/aviso-diario'
import { conversaChave } from './normalizar'

/**
 * MEDIDOR DE PARIDADE — Etapa 0 do plano Conversas Próprias
 * (docs/PLANO-CONVERSAS-PROPRIAS-OPUS.md §Etapa 0.3).
 *
 * Compara, por conversa e por DIA CIVIL de São Paulo, quantas mensagens o NOSSO
 * acervo (conversa_mensagens, migration 082) tem contra quantas o CHATWOOT tem
 * — via o MESMO relay que a tela /conversas usa. O resultado vai para
 * `conversa_gaps` (PK tenant+dia+chave) e é a RÉGUA que dirá quando a Etapa 4
 * (aposentar o Chatwoot) fica segura.
 *
 * INVARIANTES:
 *  • SÓ CONTAGENS. Nunca conteúdo de mensagem — nem no banco (conversa_gaps só
 *    tem inteiros + um código curto em `detalhe`), nem em log (nem telefone,
 *    nem jid: são PII).
 *  • NUNCA LANÇA. Roda de carona na folga de um cron; qualquer erro vira log +
 *    contador. Erro do relay numa conversa → pula aquela conversa com
 *    detalhe 'relay_erro' (a linha fica visível, mas não conta como divergência:
 *    "não medido" ≠ "perdeu mensagem").
 *  • É SÓ LEITURA do acervo e do Chatwoot — não corrige, não posta, não apaga.
 *
 * DIA MEDIDO: o último dia civil COMPLETO de America/Sao_Paulo (o de 24h atrás).
 * O cron roda às 11h UTC = 8h de SP; medir "hoje" às 8h compararia quase nada e
 * daria uma régua inútil. Medir o dia fechado é justo dos dois lados (nenhuma
 * mensagem está "a caminho") e a PK (tenant, dia, chave) faz a re-execução ser
 * um upsert idempotente.
 */

// Identidade de serviço para o relay (ele identifica o solicitante pelo header
// X-Simas-User-Email e a LEITURA usa o token admin do Chatwoot — não depende de
// agente conectado). Mesmo padrão do módulo financeiro (RELAY_EMAIL_SERVICO).
const RELAY_EMAIL_MEDIDOR = 'medidor@simas.app'

/** Teto de conversas por rodada (custo do relay é o gargalo, não o banco). */
export const TETO_CONVERSAS = 40
/** Páginas da varredura da lista do Chatwoot, por status. 4 × 25 = 100/status. */
const MAX_PAGINAS_LISTA = 4
/** Páginas de mensagens por conversa do Chatwoot (~20 por página). */
const MAX_PAGINAS_MENSAGENS = 6
/** Erros seguidos do relay que abortam a rodada (protege o relay/Chatwoot). */
const MAX_ERROS_RELAY_SEGUIDOS = 3
/** Folga exigida antes de CHAMAR o relay: o cliente tem timeout de 8s. Sem isto
 *  uma chamada iniciada na borda estouraria o maxDuration da função. */
const FOLGA_CHAMADA_RELAY_MS = 8_500
const DIA_MS = 86_400_000

/* ── Helpers PUROS (sem I/O — é o que o teste unitário exercita) ─────────── */

export interface JanelaMedida {
  /** Data civil de SP (YYYY-MM-DD) — a coluna `dia` de conversa_gaps. */
  dia: string
  inicioISO: string
  fimISO: string
  inicioMs: number
  fimMs: number
}

/**
 * Janela do último dia civil COMPLETO de São Paulo em relação a `agora`.
 * Deriva de janelaDiaSaoPaulo (fonte única do fuso, imune a DST) aplicada ao
 * instante de 24h atrás — que cai SEMPRE no dia civil anterior, a qualquer hora.
 */
export function janelaMedida(agora: Date): JanelaMedida {
  const j = janelaDiaSaoPaulo(new Date(agora.getTime() - DIA_MS))
  return {
    dia: j.dia,
    inicioISO: j.inicioISO,
    fimISO: j.fimISO,
    inicioMs: Date.parse(j.inicioISO),
    fimMs: Date.parse(j.fimISO),
  }
}

/**
 * Corte de "conversa com atividade recente" para escolher as candidatas:
 * últimas 24h, ESTENDIDO até o início do dia medido. Sem a extensão, uma
 * conversa que só falou na madrugada do dia medido ficaria de fora da régua
 * (o cron roda às 8h de SP → 24h atrás é 8h do dia medido).
 * Como o dia medido é justamente o que CONTÉM o instante de 24h atrás, na
 * prática o corte é sempre o início desse dia; o Math.min é a garantia
 * explícita de que o corte nunca fica DEPOIS das 24h pedidas pelo plano.
 */
export function desdeCandidatas(agora: Date, janela: JanelaMedida): string {
  return new Date(Math.min(agora.getTime() - DIA_MS, janela.inicioMs)).toISOString()
}

/** Conversa de grupo? (o jid de grupo do WhatsApp termina em '@g.us'). */
export function ehGrupoJid(jid: string): boolean {
  return jid.trim().toLowerCase().endsWith('@g.us')
}

/**
 * Telefone dentro de um jid individual ('5547999998888@s.whatsapp.net' →
 * '5547999998888'). Grupo, '@lid' (identificador opaco novo do WhatsApp) e
 * qualquer coisa sem dígitos suficientes → null: sem telefone não há como achar
 * o correspondente no Chatwoot.
 */
export function telefoneDoJid(jid: string): string | null {
  const bruto = (jid ?? '').trim().toLowerCase()
  if (!bruto || ehGrupoJid(bruto)) return null
  const dominio = bruto.split('@')[1] ?? ''
  if (dominio && dominio !== 's.whatsapp.net' && dominio !== 'c.us') return null
  // Sufixo de dispositivo ('...:12@s.whatsapp.net') não faz parte do número.
  const local = (bruto.split('@')[0] ?? '').split(':')[0]
  const digitos = local.replace(/\D/g, '')
  return digitos.length >= 10 ? digitos : null
}

/** Instância da Evolution → nome da inbox do Chatwoot (como o relay devolve). */
export function inboxDaInstancia(instancia: string): 'DF' | 'SC' | null {
  if (instancia === 'whatsapp-df') return 'DF'
  if (instancia === 'whatsapp-sc') return 'SC'
  return null
}

/** Conversa do Chatwoot, reduzida ao que o medidor precisa. */
export interface ConversaChatwootLeve {
  id: number
  telefone: string | null
  inbox: string | null
  /** Timestamp (ms) da última mensagem conhecida; 0 quando o relay não informa. */
  ultimaMensagemMs: number
}

/** Mensagem do Chatwoot, reduzida ao que o medidor precisa. */
export interface MensagemChatwootLeve {
  id: number
  timestampMs: number
  direcao: string
  privada: boolean
}

/**
 * Epoch do relay → ms. O contrato do relay é em SEGUNDOS (ver
 * src/lib/conversas/tipos.ts); valores já em ms (>= 1e12) são aceitos como tal.
 * Lixo → 0 (nunca NaN, que envenenaria comparações).
 */
export function msDoTimestampRelay(ts: unknown): number {
  const n = typeof ts === 'number' ? ts : Number(ts)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n >= 1e12 ? Math.round(n) : Math.round(n * 1000)
}

/** Parser DEFENSIVO da lista do relay (dado externo: shape nunca é confiado). */
export function normalizarListaRelay(data: unknown): ConversaChatwootLeve[] {
  const lista = (data as { conversas?: unknown } | null)?.conversas
  if (!Array.isArray(lista)) return []
  const out: ConversaChatwootLeve[] = []
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== 'object') continue
    const c = bruto as {
      id?: unknown
      inbox?: unknown
      contato?: { telefone?: unknown } | null
      ultimaMensagem?: { timestamp?: unknown } | null
    }
    if (typeof c.id !== 'number') continue
    out.push({
      id: c.id,
      telefone: typeof c.contato?.telefone === 'string' ? c.contato.telefone : null,
      inbox: typeof c.inbox === 'string' ? c.inbox : null,
      ultimaMensagemMs: msDoTimestampRelay(c.ultimaMensagem?.timestamp),
    })
  }
  return out
}

/** Parser DEFENSIVO das mensagens do relay. */
export function normalizarMensagensRelay(data: unknown): MensagemChatwootLeve[] {
  const lista = (data as { mensagens?: unknown } | null)?.mensagens
  if (!Array.isArray(lista)) return []
  const out: MensagemChatwootLeve[] = []
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== 'object') continue
    const m = bruto as { id?: unknown; timestamp?: unknown; direcao?: unknown; privada?: unknown }
    if (typeof m.id !== 'number') continue
    out.push({
      id: m.id,
      timestampMs: msDoTimestampRelay(m.timestamp),
      direcao: typeof m.direcao === 'string' ? m.direcao : '',
      privada: m.privada === true,
    })
  }
  return out
}

/**
 * A conversa do Chatwoot corresponde a esta conversa do acervo?
 * Telefone pelo matcher canônico (tolerante a máscara/DDI/9º dígito) E inbox
 * compatível com a instância — o MESMO número atendido em DF e SC são duas
 * conversas distintas (duas caixas de entrada), como no nosso acervo.
 * Inbox desconhecida de um dos lados não invalida o match (só o telefone manda).
 */
export function casaConversaChatwoot(
  c: Pick<ConversaChatwootLeve, 'telefone' | 'inbox'>,
  alvo: { telefone: string; inbox: 'DF' | 'SC' | null },
): boolean {
  if (!mesmoTelefone(c.telefone, alvo.telefone)) return false
  if (alvo.inbox && c.inbox && c.inbox !== alvo.inbox) return false
  return true
}

/**
 * Das conversas correspondentes, quais precisam de chamada ao relay: só as que
 * tiveram atividade DEPOIS do início do dia medido. As demais têm zero mensagem
 * na janela por construção — economiza chamadas sem perder contagem. Conversa
 * sem timestamp conhecido (0) entra por precaução.
 */
export function conversasParaMedir<T extends { ultimaMensagemMs: number }>(
  correspondentes: T[],
  inicioMs: number,
): T[] {
  return correspondentes.filter((c) => c.ultimaMensagemMs === 0 || c.ultimaMensagemMs >= inicioMs)
}

/**
 * Mensagens do Chatwoot dentro do dia medido. Conta só o que é MENSAGEM DE
 * WHATSAPP: 'atividade' (mudança de status/atribuição) e nota privada não saem
 * do Chatwoot — o nosso acervo, alimentado pelo webhook da Evolution, jamais as
 * teria, e contá-las inventaria divergência.
 */
export function contarNoDia(
  mensagens: MensagemChatwootLeve[],
  janela: Pick<JanelaMedida, 'inicioMs' | 'fimMs'>,
): number {
  let n = 0
  for (const m of mensagens) {
    if (m.privada || m.direcao === 'atividade') continue
    if (m.timestampMs >= janela.inicioMs && m.timestampMs < janela.fimMs) n++
  }
  return n
}

/** Cursor da próxima página (mensagens mais antigas): o MENOR id da página. */
export function proximoBefore(mensagens: MensagemChatwootLeve[]): number | null {
  if (mensagens.length === 0) return null
  return mensagens.reduce((min, m) => (m.id < min ? m.id : min), mensagens[0].id)
}

/**
 * A paginação já ultrapassou o início do dia medido? Enquanto a mensagem mais
 * antiga vista for >= início, ainda pode haver mensagem do dia mais atrás.
 */
export function alcancouInicio(mensagens: MensagemChatwootLeve[], inicioMs: number): boolean {
  return mensagens.some((m) => m.timestampMs > 0 && m.timestampMs < inicioMs)
}

/** Divergência = as duas contagens não batem (para mais OU para menos). */
export function divergiu(nossas: number, chatwoot: number): boolean {
  return nossas !== chatwoot
}

/**
 * As DUAS direções da divergência — elas respondem perguntas diferentes:
 *  • faltandoNoAcervo (chatwoot − nossas) é o número de GO/NO-GO da Etapa 4:
 *    enquanto for > 0, aposentar o Chatwoot PERDE mensagem. É o que a régua
 *    existe para zerar.
 *  • faltandoNoChatwoot (nossas − chatwoot) é o buraco que MOTIVOU o plano
 *    (grupo do WhatsApp nunca chega ao Chatwoot) — mede o ganho do acervo, não
 *    um risco.
 * Nunca negativos: numa conversa só uma das duas pode ser > 0.
 */
export function deficits(
  nossas: number,
  chatwoot: number,
): { faltandoNoAcervo: number; faltandoNoChatwoot: number } {
  return {
    faltandoNoAcervo: Math.max(0, chatwoot - nossas),
    faltandoNoChatwoot: Math.max(0, nossas - chatwoot),
  }
}

/** Há folga para uma chamada ao relay (que pode levar até 8s) antes do deadline? */
export function podeChamarRelay(deadline: number, agoraMs: number = Date.now()): boolean {
  return agoraMs + FOLGA_CHAMADA_RELAY_MS <= deadline
}

/* ── Rodada (I/O; nunca lança) ───────────────────────────────────────────── */

export interface MedidorOpcoes {
  /** Epoch ms absoluto. Default: agora + 30s. */
  deadline?: number
  /** Injetável para teste/reprocessamento pontual. */
  agora?: Date
  /** Escopa a rodada a um tenant (ausente = todos). */
  tenantId?: string
  /** Teto de conversas da rodada (default TETO_CONVERSAS). */
  limite?: number
}

export interface MedidorResultado {
  /** Dia civil de SP medido (YYYY-MM-DD) ou null se nem começou. */
  dia: string | null
  /** Conversas com contagem completa dos dois lados. */
  conversasComparadas: number
  /** Dessas, quantas tiveram contagens diferentes. */
  comDivergencia: number
  /**
   * Mensagens que o NOSSO acervo não tem (soma de chatwoot − nossas, positivos).
   * É o número de GO/NO-GO: > 0 significa que aposentar o Chatwoot hoje perderia
   * mensagem.
   */
  mensagensFaltandoNoAcervo: number
  /**
   * Mensagens que o CHATWOOT não tem (soma de nossas − chatwoot, positivos) — o
   * buraco que motivou o plano (grupo do WhatsApp não chega ao Chatwoot).
   */
  mensagensFaltandoNoChatwoot: number
  /** Conversas registradas sem comparação (grupo, sem correspondente, erro...). */
  puladas: number
  /** Linhas gravadas em conversa_gaps. */
  gapsGravados: number
}

interface LinhaConversaAcervo {
  id: string
  tenant_id: string
  instancia: string
  jid: string
  tipo: string | null
}

interface LinhaGap {
  tenant_id: string
  dia: string
  conversa_chave: string
  nossas: number
  chatwoot: number
  detalhe: string | null
}

type ContagemChatwoot =
  | { ok: true; total: number }
  | { ok: false; motivo: 'relay_erro' | 'incompleto' | 'sem_tempo' }

/**
 * Varre a lista de conversas do Chatwoot (open + resolved, com teto de páginas)
 * e devolve o índice leve para casar por telefone. O relay não tem busca por
 * telefone — é a mesma varredura que o dossiê do cliente e o inbox de
 * comprovantes já fazem. Falha total (nenhuma página respondeu) → ok: false.
 *
 * EXPORTADA porque o confirmador da Etapa 1 usa a MESMA identificação de
 * conversa/inbox (casaConversaChatwoot + inboxDaInstancia): duas varreduras
 * diferentes dariam duas verdades diferentes sobre "qual conversa é esta".
 *
 * O teto (4 × 25 por status) é um limite de custo: a lista vem ordenada por
 * atividade e as candidatas do medidor são justamente as conversas ativas nas
 * últimas ~24h, então elas ficam no topo. Conversa do Chatwoot ALÉM do teto
 * seria lida como 'sem_correspondente' — por isso essa linha é diagnóstico, não
 * "mensagem perdida" (e não entra em comDivergencia).
 */
export async function indiceChatwoot(
  deadline: number,
): Promise<{ ok: true; conversas: ConversaChatwootLeve[] } | { ok: false; status: number }> {
  const porId = new Map<number, ConversaChatwootLeve>()
  let algumSucesso = false
  let ultimoStatus = 0

  for (const status of ['open', 'resolved'] as const) {
    for (let page = 1; page <= MAX_PAGINAS_LISTA; page++) {
      if (!podeChamarRelay(deadline)) break
      const { status: st, data } = await relayFetch('/conversations', {
        method: 'GET',
        email: RELAY_EMAIL_MEDIDOR,
        query: { status, page: String(page) },
      })
      if (st < 200 || st >= 300) {
        ultimoStatus = st
        break // erro/indisponível: encerra este status (best-effort)
      }
      algumSucesso = true
      const pagina = normalizarListaRelay(data)
      for (const c of pagina) porId.set(c.id, c)
      if (pagina.length < TAMANHO_PAGINA_CONVERSAS) break // página incompleta = fim
    }
  }

  if (!algumSucesso) return { ok: false, status: ultimoStatus || 502 }
  return { ok: true, conversas: [...porId.values()] }
}

/**
 * Conta as mensagens do dia medido numa conversa do Chatwoot, paginando para
 * trás com `before` (mesmo endpoint da tela). Para quando já viu mensagem mais
 * antiga que o início do dia. Se o teto de páginas acabar antes disso, a
 * contagem seria PARCIAL → devolve 'incompleto' (não inventa divergência).
 */
async function contarChatwoot(
  conversaChatwootId: number,
  janela: JanelaMedida,
  deadline: number,
): Promise<ContagemChatwoot> {
  const vistos = new Set<number>()
  const acumuladas: MensagemChatwootLeve[] = []
  let before: string | undefined
  let cursorAnterior: number | null = null

  for (let pagina = 0; pagina < MAX_PAGINAS_MENSAGENS; pagina++) {
    if (!podeChamarRelay(deadline)) return { ok: false, motivo: 'sem_tempo' }
    const { status, data } = await relayFetch(`/conversations/${conversaChatwootId}/messages`, {
      method: 'GET',
      email: RELAY_EMAIL_MEDIDOR,
      query: { before },
    })
    if (status < 200 || status >= 300) return { ok: false, motivo: 'relay_erro' }

    const mensagens = normalizarMensagensRelay(data)
    const novas = mensagens.filter((m) => !vistos.has(m.id))
    for (const m of novas) vistos.add(m.id)
    acumuladas.push(...novas)

    if (mensagens.length === 0) {
      return { ok: true, total: contarNoDia(acumuladas, janela) } // fim do histórico
    }
    if (alcancouInicio(mensagens, janela.inicioMs)) {
      return { ok: true, total: contarNoDia(acumuladas, janela) } // já passou do início do dia
    }
    // Página inteiramente repetida (relay ignorou o `before`): a contagem seria
    // parcial e viraria divergência falsa — melhor admitir que não deu.
    if (novas.length === 0) return { ok: false, motivo: 'incompleto' }
    const cursor = proximoBefore(mensagens)
    // Cursor que não anda = paginação sem fim; encerra como incompleto.
    if (cursor === null || (cursorAnterior !== null && cursor >= cursorAnterior)) {
      return { ok: false, motivo: 'incompleto' }
    }
    cursorAnterior = cursor
    before = String(cursor)
  }
  return { ok: false, motivo: 'incompleto' }
}

/** Contagem das NOSSAS mensagens da conversa no dia medido (COUNT no índice). */
async function contarNossas(
  admin: SupabaseClient,
  conversa: LinhaConversaAcervo,
  janela: JanelaMedida,
): Promise<number | null> {
  const { count, error } = await admin
    .from('conversa_mensagens')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', conversa.tenant_id)
    .eq('conversa_id', conversa.id)
    .gte('timestamp_msg', janela.inicioISO)
    .lt('timestamp_msg', janela.fimISO)
  if (error) {
    logger.error('conversas_acervo.medidor.contagem_nossa', { conversaId: conversa.id }, error)
    return null
  }
  return count ?? 0
}

/**
 * Mede a paridade acervo × Chatwoot do último dia civil completo e grava
 * conversa_gaps. NUNCA lança: devolve as contagens do que conseguiu fazer.
 *
 * Chamado na FOLGA do cron funil-consultas (sem cron próprio — plano Hobby).
 */
export async function medirParidade(
  admin: SupabaseClient,
  opts: MedidorOpcoes = {},
): Promise<MedidorResultado> {
  const r: MedidorResultado = {
    dia: null,
    conversasComparadas: 0,
    comDivergencia: 0,
    mensagensFaltandoNoAcervo: 0,
    mensagensFaltandoNoChatwoot: 0,
    puladas: 0,
    gapsGravados: 0,
  }
  try {
    const agora = opts.agora ?? new Date()
    const deadline = opts.deadline ?? Date.now() + 30_000
    const janela = janelaMedida(agora)
    r.dia = janela.dia

    // 1) Candidatas: conversas com atividade recente, mais ativas primeiro.
    let q = admin
      .from('conversas_acervo')
      .select('id, tenant_id, instancia, jid, tipo')
      .gte('ultima_mensagem_em', desdeCandidatas(agora, janela))
      .order('ultima_mensagem_em', { ascending: false })
      .limit(opts.limite ?? TETO_CONVERSAS)
    if (opts.tenantId) q = q.eq('tenant_id', opts.tenantId)
    const { data, error } = await q
    if (error) {
      logger.error('conversas_acervo.medidor.candidatas', {}, error)
      return r
    }
    const candidatas = (data ?? []) as LinhaConversaAcervo[]
    if (candidatas.length === 0) return r

    // 2) Índice do Chatwoot (uma varredura para todas as candidatas). Relay
    //    inteiro fora do ar → rodada silenciosa (não polui conversa_gaps com 40
    //    linhas de 'relay_erro' por causa de uma indisponibilidade).
    if (!podeChamarRelay(deadline)) return r
    const indice = await indiceChatwoot(deadline)
    if (!indice.ok) {
      logger.warn('conversas_acervo.medidor.relay_lista', { status: indice.status })
      return r
    }

    // 3) Conversa a conversa.
    const gaps: LinhaGap[] = []
    let errosSeguidos = 0

    for (const conversa of candidatas) {
      if (Date.now() > deadline) break

      const nossas = await contarNossas(admin, conversa, janela)
      if (nossas === null) {
        r.puladas++
        continue // erro de banco: nem linha, nem contagem inventada
      }

      const chave = conversaChave(conversa.instancia, conversa.jid)
      const base = { tenant_id: conversa.tenant_id, dia: janela.dia, conversa_chave: chave, nossas }

      // 3a) Sem correspondente possível: grupo (a ponte nem leva grupo ao
      //     Chatwoot — é o buraco que motivou o plano) ou jid sem telefone.
      const telefone = conversa.tipo === 'grupo' ? null : telefoneDoJid(conversa.jid)
      if (!telefone) {
        gaps.push({ ...base, chatwoot: 0, detalhe: 'sem_correspondente' })
        r.puladas++
        continue
      }

      const alvo = { telefone, inbox: inboxDaInstancia(conversa.instancia) }
      const correspondentes = indice.conversas.filter((c) => casaConversaChatwoot(c, alvo))
      if (correspondentes.length === 0) {
        gaps.push({ ...base, chatwoot: 0, detalhe: 'sem_correspondente' })
        r.puladas++
        continue
      }

      // 3b) O Chatwoot abre uma conversa NOVA por sessão do mesmo contato:
      //     somamos todas as correspondentes que tiveram atividade no dia.
      let total = 0
      let falha: 'relay_erro' | 'incompleto' | 'sem_tempo' | null = null
      for (const alvoChatwoot of conversasParaMedir(correspondentes, janela.inicioMs)) {
        const contagem = await contarChatwoot(alvoChatwoot.id, janela, deadline)
        if (!contagem.ok) {
          falha = contagem.motivo
          break
        }
        total += contagem.total
      }

      if (falha === 'sem_tempo') break // acabou o orçamento: fica para amanhã
      if (falha) {
        gaps.push({ ...base, chatwoot: 0, detalhe: falha })
        r.puladas++
        if (falha === 'relay_erro' && ++errosSeguidos >= MAX_ERROS_RELAY_SEGUIDOS) break
        continue
      }

      errosSeguidos = 0
      gaps.push({ ...base, chatwoot: total, detalhe: null })
      r.conversasComparadas++
      if (divergiu(nossas, total)) {
        r.comDivergencia++
        const d = deficits(nossas, total)
        r.mensagensFaltandoNoAcervo += d.faltandoNoAcervo
        r.mensagensFaltandoNoChatwoot += d.faltandoNoChatwoot
      }
    }

    // 4) Upsert idempotente (PK tenant+dia+chave): re-rodar atualiza a linha.
    if (gaps.length > 0) {
      const { error: erroGaps } = await admin
        .from('conversa_gaps')
        .upsert(gaps, { onConflict: 'tenant_id,dia,conversa_chave' })
      if (erroGaps) logger.error('conversas_acervo.medidor.gravar_gaps', { linhas: gaps.length }, erroGaps)
      else r.gapsGravados = gaps.length
    }

    logger.info('conversas_acervo.medidor', { ...r })
    return r
  } catch (e) {
    logger.error('conversas_acervo.medidor.falha', {}, e)
    return r
  }
}
