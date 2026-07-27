import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { relayFetch } from '@/lib/conversas/relay'
import {
  casaConversaChatwoot,
  inboxDaInstancia,
  indiceChatwoot,
  msDoTimestampRelay,
  podeChamarRelay,
  telefoneDoJid,
  type ConversaChatwootLeve,
} from './medidor'

/**
 * CONFIRMADOR — Etapa 1 do plano Conversas Próprias
 * (docs/PLANO-CONVERSAS-PROPRIAS-OPUS.md §Etapa 1).
 *
 * Responde UMA pergunta por mensagem do nosso acervo: "ela chegou ao Chatwoot?".
 * Sem essa resposta a reconciliação seria cega — postaríamos de novo o que a
 * ponte nativa da Evolution já entregou (mensagem duplicada para o cliente, o
 * pior desfecho possível).
 *
 * COMO CASA (nesta ordem):
 *  1. MARCADOR 'simas-rec:<mensagemId>' — só existe nas mensagens que NÓS
 *     postamos. É prova, não heurística: casa mesmo com texto/tempo diferentes
 *     (o relay pode ter prefixado data de origem no conteúdo). Fecha também a
 *     janela de morte "postou e morreu antes de gravar" — a linha volta pendente
 *     e o marcador a confirma na rodada seguinte.
 *  2. HEURÍSTICA — mesma direção, |Δtimestamp| <= 180s e conteúdo compatível
 *     (prefixo de 24 chars normalizados; mídia por tipo e tamanho aproximado).
 *     Guloso pelo MENOR Δt, cada lado consumido uma única vez: dois PDFs
 *     encaminhados em sequência SEM texto (o caso real que motivou o plano) não
 *     podem casar os dois com a mesma mensagem do Chatwoot — se só um chegou lá,
 *     só um é confirmado e o outro vira candidato à reposição.
 *
 * INVARIANTES:
 *  • As funções de casamento são PURAS (é onde mora o risco, é o que o teste
 *    exercita). O I/O só orquestra.
 *  • NUNCA LANÇA: roda em after()/cron; erro vira contador + log.
 *  • É SÓ LEITURA (do Chatwoot) — quem escreve é o reconciliador.
 *  • LGPD: log só com ids internos e contagens. Nunca texto, telefone ou jid.
 */

/** Identidade de serviço no relay (leitura usa o token admin — ver tokenLeitura). */
export const RELAY_EMAIL_RECONCILIACAO = 'reconciliador@simas.app'

/** Prefixo do marcador de origem (content_attributes/echo_id do lado do relay). */
export const MARCADOR_PREFIXO = 'simas-rec:'
/** Tolerância de tempo entre a nossa mensagem e a cópia no Chatwoot. */
export const TOLERANCIA_MS = 180_000
/** Chars comparados do texto (o suficiente para distinguir; imune a truncagem). */
export const PREFIXO_CHARS = 24
/** Páginas de mensagens lidas por conversa do Chatwoot (~20 por página). */
const MAX_PAGINAS_MENSAGENS = 2
/** Teto de mensagens pendentes examinadas por conversa numa rodada. */
export const TETO_PENDENTES = 100

/* ── Tipos ────────────────────────────────────────────────────────────────── */

/** Mensagem do NOSSO acervo, reduzida ao que decide o casamento. */
export interface MensagemNossa {
  /** id (UUID) da linha em conversa_mensagens. */
  id: string
  /** key.id da Evolution — é ele que vai no marcador. */
  mensagemId: string
  /** key.fromMe: true = saiu do nosso número. */
  deMim: boolean
  tipo: string
  texto: string | null
  timestampMs: number
  /** Tamanho do binário quando guardado (null quando mídia pendente). */
  mediaTamanho: number | null
  /** A mensagem TEM mídia (guardada ou pendente) — não é texto puro. */
  temMedia: boolean
}

/** Mensagem do Chatwoot com o que o casamento precisa (superset do medidor). */
export interface MensagemChatwoot {
  id: number
  timestampMs: number
  /** 'entrada' | 'saida' | 'atividade' (contrato do relay). */
  direcao: string
  privada: boolean
  conteudo: string
  anexos: { tipo: string | null; tamanho: number | null }[]
  /** Marcador de origem, quando o relay o expõe (content_attributes/echo_id). */
  marcador: string | null
}

/**
 * PISO DE COBERTURA do índice de conversas do Chatwoot (epoch ms).
 *
 * A lista do Chatwoot vem ordenada por atividade e nós lemos só as primeiras
 * páginas (teto de custo do medidor). Logo, uma conversa AUSENTE do índice tem
 * atividade mais antiga que a última conversa que vimos — este piso.
 *
 * É o que torna 'sem_correspondente' uma afirmação segura: se a mensagem que
 * queremos repor é MAIS NOVA que o piso e a conversa não apareceu no índice,
 * então ela realmente não existe no Chatwoot (se existisse com essa mensagem,
 * teria atividade recente e estaria no topo da lista). Mensagem mais ANTIGA que
 * o piso fica de fora: ali não sabemos, e postar às cegas duplicaria mensagem
 * para o cliente.
 *
 * Índice vazio = o Chatwoot não tem conversa nenhuma → cobertura total (0).
 */
export function coberturaDoIndice(conversas: Pick<ConversaChatwootLeve, 'ultimaMensagemMs'>[]): number {
  let piso = Number.POSITIVE_INFINITY
  for (const c of conversas) {
    if (c.ultimaMensagemMs > 0 && c.ultimaMensagemMs < piso) piso = c.ultimaMensagemMs
  }
  return Number.isFinite(piso) ? piso : 0
}

export interface ParCasado {
  nossaId: string
  chatwootId: number
  /** true quando casou pelo MARCADOR (prova de que a postagem foi nossa). */
  porMarcador: boolean
}

/* ── Puras: marcador ──────────────────────────────────────────────────────── */

/** Marcador que identifica uma postagem nossa desta mensagem. */
export function marcadorDaMensagem(mensagemId: string): string {
  return `${MARCADOR_PREFIXO}${mensagemId}`
}

/**
 * Extrai o marcador de uma mensagem do Chatwoot. Aceita as DUAS formas do
 * contrato: campo dedicado (content_attributes/echo_id repassado pelo relay) ou
 * embutido no conteúdo (quando a API não aceitou o atributo). Devolve o
 * mensagemId cru (sem o prefixo) ou null.
 */
export function extrairMarcador(entrada: {
  marcador?: string | null
  conteudo?: string | null
}): string | null {
  const direto = (entrada.marcador ?? '').trim()
  if (direto.startsWith(MARCADOR_PREFIXO)) {
    const id = direto.slice(MARCADOR_PREFIXO.length).trim()
    if (id) return id
  }
  const conteudo = entrada.conteudo ?? ''
  // Id da Evolution é alfanumérico com '-', '_' e '.'; qualquer outro char encerra.
  const m = /simas-rec:([A-Za-z0-9._-]{1,300})/.exec(conteudo)
  return m ? m[1] : null
}

/* ── Puras: comparação de conteúdo ────────────────────────────────────────── */

/**
 * Prefixo comparável do texto: sem acento, minúsculo, espaços colapsados e
 * pontuação removida. O Chatwoot/ponte pode reescrever detalhes (aspas curvas,
 * quebras de linha, emoji de status) sem que a mensagem seja outra.
 */
export function normalizarPrefixo(texto: string | null | undefined, n = PREFIXO_CHARS): string {
  const base = (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira acento (NFD → diacríticos combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return base.slice(0, n)
}

/** Nossa direção (de_mim) na linguagem do relay. */
export function direcaoRelayDe(deMim: boolean): 'entrada' | 'saida' {
  return deMim ? 'saida' : 'entrada'
}

/**
 * Tipo de mídia do acervo × file_type do Chatwoot. Desconhecido dos dois lados
 * não invalida (o Chatwoot rotula muita coisa como 'file'); só rejeitamos
 * incompatibilidade EVIDENTE (áudio × imagem).
 */
export function tipoMidiaCompativel(nosso: string, chatwoot: string | null): boolean {
  const cw = (chatwoot ?? '').trim().toLowerCase()
  if (!cw) return true
  const esperado: Record<string, string[]> = {
    imagem: ['image', 'file'],
    video: ['video', 'file'],
    audio: ['audio', 'file'],
    documento: ['file', 'image', 'video', 'audio'], // PDF às vezes vira 'file', imagem enviada como documento vira 'image'
    sticker: ['image', 'file'],
  }
  const aceitos = esperado[nosso]
  if (!aceitos) return true // 'texto'/'outro': nada a checar aqui
  return aceitos.includes(cw)
}

/**
 * Tamanhos "iguais o bastante". A ponte pode recomprimir/reempacotar (metadados
 * de EXIF, container de áudio): 10% ou 4 KB de folga, o que for maior. Se um dos
 * lados não informa tamanho (o relay hoje não expõe), NÃO decide nada — devolve
 * true e o casamento fica por conta de direção/tempo/tipo.
 */
export function tamanhoAproximado(a: number | null, b: number | null): boolean {
  if (a == null || b == null || a <= 0 || b <= 0) return true
  const folga = Math.max(4096, Math.max(a, b) * 0.1)
  return Math.abs(a - b) <= folga
}

/**
 * Esta mensagem do Chatwoot PODE ser a nossa? (sem contar o marcador, que é
 * decidido antes). Regras, todas necessárias:
 *  • a do Chatwoot é mensagem de WhatsApp (não 'atividade', não nota privada);
 *  • mesma direção;
 *  • |Δt| <= TOLERANCIA_MS;
 *  • "tem anexo" tem de bater dos dois lados — texto puro não casa com anexo;
 *  • com anexo: tipo compatível e tamanho aproximado;
 *  • com texto dos dois lados: mesmo prefixo normalizado. Se só um lado tem
 *    texto, só é tolerado quando há mídia (legenda que a ponte perde, ou nome de
 *    arquivo que o Chatwoot põe como conteúdo).
 */
export function compativel(nossa: MensagemNossa, cw: MensagemChatwoot): boolean {
  if (cw.privada || cw.direcao === 'atividade') return false
  if (cw.direcao !== direcaoRelayDe(nossa.deMim)) return false
  if (!Number.isFinite(nossa.timestampMs) || !Number.isFinite(cw.timestampMs)) return false
  if (cw.timestampMs <= 0) return false
  if (Math.abs(nossa.timestampMs - cw.timestampMs) > TOLERANCIA_MS) return false

  const cwTemAnexo = cw.anexos.length > 0
  if (nossa.temMedia !== cwTemAnexo) return false

  if (nossa.temMedia) {
    const algumCompativel = cw.anexos.some(
      (a) => tipoMidiaCompativel(nossa.tipo, a.tipo) && tamanhoAproximado(nossa.mediaTamanho, a.tamanho),
    )
    if (!algumCompativel) return false
  }

  const pn = normalizarPrefixo(nossa.texto)
  const pc = normalizarPrefixo(cw.conteudo)
  if (pn && pc) return pn === pc
  // Um lado sem texto: só passa quando há mídia explicando a diferença.
  return nossa.temMedia
}

/**
 * Casamento GULOSO e determinístico entre as nossas mensagens pendentes e as
 * mensagens recentes do Chatwoot.
 *
 * 1) Marcador primeiro (prova).
 * 2) Depois todos os pares compatíveis, ordenados por |Δt| (empate: nossa mais
 *    antiga, depois menor id do Chatwoot). Cada mensagem — dos DOIS lados — é
 *    usada no máximo uma vez.
 *
 * Guloso pelo menor Δt é o certo aqui: mensagens em sequência (os 2 PDFs) casam
 * cada uma com a cópia mais próxima no tempo, e sobra pendente exatamente quem
 * não tem par — que é o buraco que a Etapa 1 existe para tapar.
 */
export function casarMensagens(
  nossas: MensagemNossa[],
  chatwoot: MensagemChatwoot[],
): ParCasado[] {
  const pares: ParCasado[] = []
  const nossasUsadas = new Set<string>()
  const cwUsadas = new Set<number>()

  // 1) Marcador.
  const porMensagemId = new Map<string, MensagemNossa>()
  for (const n of nossas) porMensagemId.set(n.mensagemId, n)
  for (const cw of chatwoot) {
    const marcado = extrairMarcador(cw)
    if (!marcado) continue
    const nossa = porMensagemId.get(marcado)
    if (!nossa || nossasUsadas.has(nossa.id) || cwUsadas.has(cw.id)) continue
    nossasUsadas.add(nossa.id)
    cwUsadas.add(cw.id)
    pares.push({ nossaId: nossa.id, chatwootId: cw.id, porMarcador: true })
  }

  // 2) Heurística, do par mais próximo no tempo para o mais distante.
  interface Candidato {
    nossaIdx: number
    nossaId: string
    chatwootId: number
    delta: number
  }
  const candidatos: Candidato[] = []
  nossas.forEach((nossa, nossaIdx) => {
    if (nossasUsadas.has(nossa.id)) return
    for (const cw of chatwoot) {
      if (cwUsadas.has(cw.id)) continue
      if (!compativel(nossa, cw)) continue
      candidatos.push({
        nossaIdx,
        nossaId: nossa.id,
        chatwootId: cw.id,
        delta: Math.abs(nossa.timestampMs - cw.timestampMs),
      })
    }
  })
  candidatos.sort(
    (a, b) => a.delta - b.delta || a.nossaIdx - b.nossaIdx || a.chatwootId - b.chatwootId,
  )
  for (const c of candidatos) {
    if (nossasUsadas.has(c.nossaId) || cwUsadas.has(c.chatwootId)) continue
    nossasUsadas.add(c.nossaId)
    cwUsadas.add(c.chatwootId)
    pares.push({ nossaId: c.nossaId, chatwootId: c.chatwootId, porMarcador: false })
  }

  return pares
}

/* ── Puras: parsing do relay ──────────────────────────────────────────────── */

/**
 * Parser DEFENSIVO das mensagens do relay para o confirmador (o do medidor só
 * conta; aqui precisamos de conteúdo e anexos). Dado externo: nada é confiado.
 * `tamanho` e `marcador` são campos que o relay PODE não expor — ausentes, o
 * casamento simplesmente não os usa (ver tamanhoAproximado/extrairMarcador).
 */
export function normalizarMensagensChatwoot(data: unknown): MensagemChatwoot[] {
  const lista = (data as { mensagens?: unknown } | null)?.mensagens
  if (!Array.isArray(lista)) return []
  const out: MensagemChatwoot[] = []
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== 'object') continue
    const m = bruto as {
      id?: unknown
      timestamp?: unknown
      direcao?: unknown
      privada?: unknown
      conteudo?: unknown
      anexos?: unknown
      marcador?: unknown
    }
    if (typeof m.id !== 'number') continue
    const anexos: { tipo: string | null; tamanho: number | null }[] = []
    if (Array.isArray(m.anexos)) {
      for (const a of m.anexos) {
        if (!a || typeof a !== 'object') continue
        const anexo = a as { tipo?: unknown; tamanho?: unknown }
        const tamanho = typeof anexo.tamanho === 'number' && anexo.tamanho > 0 ? anexo.tamanho : null
        anexos.push({ tipo: typeof anexo.tipo === 'string' ? anexo.tipo : null, tamanho })
      }
    }
    out.push({
      id: m.id,
      timestampMs: msDoTimestampRelay(m.timestamp),
      direcao: typeof m.direcao === 'string' ? m.direcao : '',
      privada: m.privada === true,
      conteudo: typeof m.conteudo === 'string' ? m.conteudo : '',
      anexos,
      marcador: typeof m.marcador === 'string' ? m.marcador : null,
    })
  }
  return out
}

/** Linha crua de conversa_mensagens → MensagemNossa (defensivo com o banco). */
export function mensagemNossaDaLinha(linha: {
  id: string
  mensagem_id: string
  de_mim: boolean | null
  tipo: string | null
  texto: string | null
  media_storage_path: string | null
  media_pendente_motivo: string | null
  media_tamanho: number | null
  timestamp_msg: string
}): MensagemNossa {
  const ts = Date.parse(linha.timestamp_msg)
  return {
    id: linha.id,
    mensagemId: linha.mensagem_id,
    deMim: linha.de_mim === true,
    tipo: linha.tipo ?? 'outro',
    texto: linha.texto,
    timestampMs: Number.isNaN(ts) ? 0 : ts,
    mediaTamanho: linha.media_tamanho ?? null,
    temMedia: !!linha.media_storage_path || !!linha.media_pendente_motivo,
  }
}

/* ── I/O (nunca lança) ────────────────────────────────────────────────────── */

export interface ConversaAcervo {
  id: string
  tenant_id: string
  instancia: string
  jid: string
  tipo: string | null
}

export interface ConfirmacaoResultado {
  /** Mensagens marcadas como confirmadas nesta rodada. */
  confirmadas: number
  /** Ids (nossos) confirmados — o reconciliador tira estes da fila de reposição. */
  confirmadasIds: string[]
  /** Pendentes examinadas (as que continuam sem correspondente = examinadas − confirmadas). */
  examinadas: number
  /**
   * Piso de cobertura do índice (ver coberturaDoIndice). Com motivo
   * 'sem_correspondente', só mensagens com timestamp >= este piso podem ser
   * repostas com segurança. 0 = cobertura total (grupo, índice vazio ou
   * conversa encontrada).
   */
  coberturaMs: number
  /**
   * Desfecho da rodada. Só 'ok' e 'sem_correspondente' são CONHECIMENTO sobre o
   * Chatwoot; os demais são ignorância — o reconciliador não posta neles.
   */
  motivo: 'ok' | 'sem_pendentes' | 'sem_correspondente' | 'relay_erro' | 'sem_tempo' | 'erro'
}

/** Índice de conversas do Chatwoot com TTL curto — uma varredura serve o lote
 *  inteiro (a ingestão costuma tocar várias conversas na mesma invocação). */
let indiceCache: { em: number; conversas: ConversaChatwootLeve[] } | null = null
const INDICE_TTL_MS = 60_000

async function obterIndice(
  deadline: number,
  agoraMs: number,
): Promise<ConversaChatwootLeve[] | null> {
  if (indiceCache && agoraMs - indiceCache.em < INDICE_TTL_MS) return indiceCache.conversas
  const r = await indiceChatwoot(deadline)
  if (!r.ok) {
    logger.warn('conversas_acervo.confirmador.relay_lista', { status: r.status })
    return null
  }
  indiceCache = { em: agoraMs, conversas: r.conversas }
  return r.conversas
}

/** Só para teste: zera o cache do índice entre casos. */
export function limparCacheIndice(): void {
  indiceCache = null
}

export interface LeituraChatwoot {
  msgs: MensagemChatwoot[]
  /** Chegamos ao FIM do histórico (não paramos por teto de páginas/tempo). */
  completa: boolean
}

/**
 * Mensagens recentes de uma conversa do Chatwoot (1ª página = as mais novas).
 * null = NÃO FOI POSSÍVEL LER (relay fora, sem tempo). A distinção entre "li e
 * não tem nada" ([]) e "não li" (null) é de segurança: postar sem ter lido o
 * Chatwoot duplicaria mensagem para o cliente. `completa` diz se dá para
 * afirmar ausência ATRÁS da mensagem mais antiga lida (ver pisoDaLeitura).
 */
async function mensagensRecentes(
  conversaChatwootId: number,
  deadline: number,
): Promise<LeituraChatwoot | null> {
  const acumuladas: MensagemChatwoot[] = []
  const vistos = new Set<number>()
  let leuAlguma = false
  let completa = false
  let before: string | undefined
  for (let pagina = 0; pagina < MAX_PAGINAS_MENSAGENS; pagina++) {
    if (!podeChamarRelay(deadline)) break
    const { status, data } = await relayFetch(`/conversations/${conversaChatwootId}/messages`, {
      method: 'GET',
      email: RELAY_EMAIL_RECONCILIACAO,
      query: { before },
    })
    if (status < 200 || status >= 300) break
    leuAlguma = true
    const lote = normalizarMensagensChatwoot(data)
    const novas = lote.filter((m) => !vistos.has(m.id))
    for (const m of novas) vistos.add(m.id)
    acumuladas.push(...novas)
    if (lote.length === 0 || novas.length === 0) {
      completa = true // fim do histórico (ou paginação parada): nada mais atrás
      break
    }
    const menor = lote.reduce((min, m) => (m.id < min ? m.id : min), lote[0].id)
    before = String(menor)
  }
  return leuAlguma ? { msgs: acumuladas, completa } : null
}

/**
 * Piso de cobertura de UMA leitura de conversa: leitura completa cobre tudo (0);
 * leitura truncada só cobre até a mensagem mais antiga que veio. Abaixo disso,
 * a mensagem pode estar no Chatwoot sem que a tenhamos visto.
 */
export function pisoDaLeitura(leitura: LeituraChatwoot): number {
  if (leitura.completa) return 0
  let piso = Number.POSITIVE_INFINITY
  for (const m of leitura.msgs) {
    if (m.timestampMs > 0 && m.timestampMs < piso) piso = m.timestampMs
  }
  return Number.isFinite(piso) ? piso : 0
}

/**
 * Confirma o que já chegou ao Chatwoot nesta conversa. Devolve as contagens; o
 * que sobrar pendente é a matéria-prima do reconciliador.
 *
 * `pendentes` pode ser injetado por quem já as leu (o reconciliador lê uma vez e
 * reaproveita) — sem isso, lê aqui.
 */
export async function confirmarConversa(
  admin: SupabaseClient,
  conversa: ConversaAcervo,
  opts: { deadline: number; agora?: Date; pendentes?: MensagemNossa[] },
): Promise<ConfirmacaoResultado> {
  const r: ConfirmacaoResultado = {
    confirmadas: 0,
    confirmadasIds: [],
    examinadas: 0,
    coberturaMs: 0,
    motivo: 'ok',
  }
  try {
    const agoraMs = (opts.agora ?? new Date()).getTime()
    const pendentes = opts.pendentes ?? (await lerPendentes(admin, conversa))
    r.examinadas = pendentes.length
    if (pendentes.length === 0) {
      r.motivo = 'sem_pendentes'
      return r
    }

    // Grupo (ou jid sem telefone) não tem correspondente no Chatwoot: é
    // exatamente o buraco que motivou o plano. Nada a confirmar — tudo vira
    // candidato à reposição.
    const telefone = conversa.tipo === 'grupo' ? null : telefoneDoJid(conversa.jid)
    if (!telefone) {
      r.motivo = 'sem_correspondente'
      return r
    }

    if (!podeChamarRelay(opts.deadline)) {
      r.motivo = 'sem_tempo'
      return r
    }
    const indice = await obterIndice(opts.deadline, agoraMs)
    if (!indice) {
      r.motivo = 'relay_erro'
      return r
    }

    const alvo = { telefone, inbox: inboxDaInstancia(conversa.instancia) }
    const correspondentes = indice.filter((c) => casaConversaChatwoot(c, alvo))
    if (correspondentes.length === 0) {
      // "Não achei" só vale como "não existe" acima do piso de cobertura.
      r.coberturaMs = coberturaDoIndice(indice)
      r.motivo = 'sem_correspondente'
      return r
    }

    // O Chatwoot abre conversa NOVA por sessão do mesmo contato: juntamos as
    // mensagens de TODAS as correspondentes antes de casar.
    const doChatwoot: MensagemChatwoot[] = []
    let lidas = 0
    let piso = 0
    for (const c of correspondentes) {
      if (!podeChamarRelay(opts.deadline)) break
      const leitura = await mensagensRecentes(c.id, opts.deadline)
      if (leitura === null) continue
      lidas++
      doChatwoot.push(...leitura.msgs)
      // A mensagem pode estar em QUALQUER uma das correspondentes: o piso que
      // vale é o mais restritivo (a leitura que enxergou menos atrás).
      piso = Math.max(piso, pisoDaLeitura(leitura))
    }
    if (lidas === 0) {
      r.motivo = 'relay_erro'
      return r
    }
    // Confirmar com leitura parcial é SEGURO (casar é prova); POSTAR não é —
    // por isso o motivo vira 'relay_erro' quando alguma correspondente ficou
    // sem ser lida, e o piso limita o que o reconciliador pode repor.
    r.coberturaMs = piso
    if (lidas < correspondentes.length) r.motivo = 'relay_erro'

    const pares = casarMensagens(pendentes, doChatwoot)
    if (pares.length === 0) return r

    const agoraIso = new Date(agoraMs).toISOString()
    // Casados por MARCADOR foram postados por nós: gravamos também postada_em +
    // o id do Chatwoot (fecha a janela "postou e morreu antes de gravar").
    const porMarcador = pares.filter((p) => p.porMarcador)
    for (const p of porMarcador) {
      const { error } = await admin
        .from('conversa_mensagens')
        .update({
          chatwoot_confirmada_em: agoraIso,
          chatwoot_postada_em: agoraIso,
          chatwoot_msg_id: String(p.chatwootId),
          rec_claim_em: null,
        })
        .eq('id', p.nossaId)
        .is('chatwoot_confirmada_em', null)
      if (error) {
        logger.error('conversas_acervo.confirmador.marcador', { conversaId: conversa.id }, error)
      } else {
        r.confirmadas++
        r.confirmadasIds.push(p.nossaId)
      }
    }

    const heuristicos = pares.filter((p) => !p.porMarcador).map((p) => p.nossaId)
    if (heuristicos.length > 0) {
      const { data, error } = await admin
        .from('conversa_mensagens')
        .update({ chatwoot_confirmada_em: agoraIso })
        .in('id', heuristicos)
        .is('chatwoot_confirmada_em', null)
        .select('id')
      if (error) {
        logger.error('conversas_acervo.confirmador.gravar', { conversaId: conversa.id }, error)
      } else {
        const ids = (data ?? []).map((l) => (l as { id: string }).id)
        r.confirmadas += ids.length
        r.confirmadasIds.push(...ids)
      }
    }
    return r
  } catch (e) {
    logger.error('conversas_acervo.confirmador.falha', { conversaId: conversa.id }, e)
    r.motivo = 'erro'
    return r
  }
}

/**
 * Pendentes da conversa (não confirmadas e não postadas), mais antigas primeiro.
 * Sem filtro de tentativas: confirmar é de graça e vale até para quem já virou
 * dead-letter de postagem (a linha sai da fila quando a ponte finalmente entrega).
 */
export async function lerPendentes(
  admin: SupabaseClient,
  conversa: ConversaAcervo,
  limite: number = TETO_PENDENTES,
): Promise<MensagemNossa[]> {
  const { data, error } = await admin
    .from('conversa_mensagens')
    .select(
      'id, mensagem_id, de_mim, tipo, texto, media_storage_path, media_pendente_motivo, media_tamanho, timestamp_msg',
    )
    .eq('conversa_id', conversa.id)
    .eq('tenant_id', conversa.tenant_id)
    .is('chatwoot_confirmada_em', null)
    .is('chatwoot_postada_em', null)
    .order('timestamp_msg', { ascending: true })
    .limit(limite)
  if (error) {
    logger.error('conversas_acervo.confirmador.pendentes', { conversaId: conversa.id }, error)
    return []
  }
  return (data ?? []).map((l) =>
    mensagemNossaDaLinha(l as Parameters<typeof mensagemNossaDaLinha>[0]),
  )
}
