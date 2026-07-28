import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { relayFetch, relayFetchBinario } from '@/lib/conversas/relay'
import { apenasDigitos } from '@/lib/conversas/telefone'
import { LIMITE_MEDIA_BYTES, type EventoConversa, type InstanciaAcervo, type TipoMensagemAcervo } from './contrato'
import { msDoTimestampRelay, podeChamarRelay } from './medidor'
import {
  conversasDoLote,
  deduplicarEventos,
  linhaMensagem,
  patchDeConversa,
  prefixoAcervo,
  sanitizarSegmentoPath,
  type ConversaDesejada,
  type ConversaExistente,
  type LinhaMensagem,
} from './normalizar'

/**
 * BACKFILL — importa TODO o histórico do Chatwoot (conversas, mensagens,
 * anexos) para o acervo próprio (migration 082/084).
 *
 * A etapa era da 4 do plano (docs/PLANO-CONVERSAS-PROPRIAS-OPUS.md); foi
 * ANTECIPADA por decisão do dono para a Etapa 2 (a tela /conversas lendo do
 * NOSSO banco) nascer com o passado completo.
 *
 * COMO LÊ: 100% do lado SIMAS, pelos MESMOS endpoints do relay que a tela, o
 * medidor e o confirmador já usam — nada foi inventado do outro lado:
 *   GET /conversations?status=&page=&inbox=   (listagem paginada)
 *   GET /conversations/:id/messages?before=   (histórico retroativo)
 *   GET /attachments?url=                     (binário do anexo)
 *
 * INVARIANTES:
 *  • ANTI-LOOP (o risco número 1): toda mensagem importada nasce com
 *    chatwoot_confirmada_em = agora e origem_backfill = true. Ela VEIO do
 *    Chatwoot — sem o carimbo, o reconciliador da Etapa 1 leria o acervo
 *    histórico como "suspeito de perdido" e tentaria REPOSTAR o passado inteiro
 *    do escritório. chatwoot_postada_em NUNCA é escrito aqui (nós não postamos).
 *  • NUNCA LANÇA: roda em cron; qualquer erro vira log + contador.
 *  • RETOMADA IDEMPOTENTE: cursor durável por (inbox × status) + dedupe pelo
 *    UNIQUE (tenant_id, instancia, mensagem_id). Reprocessar uma página é
 *    sempre seguro (custa chamadas ao relay, não duplica linha).
 *  • ultima_mensagem_em da conversa SÓ AVANÇA (patchDeConversa, da ingestão):
 *    data histórica nunca rebaixa a conversa na lista.
 *  • LGPD: log e retorno só com ids internos, códigos e contagens.
 */

/* ── Parâmetros ───────────────────────────────────────────────────────────── */

/** Identidade de serviço no relay (a leitura usa o token admin do Chatwoot). */
export const RELAY_EMAIL_BACKFILL = 'backfill@simas.app'

export const INBOXES_BACKFILL = ['df', 'sc'] as const
export type InboxBackfill = (typeof INBOXES_BACKFILL)[number]

/**
 * Os QUATRO status de conversa do Chatwoot, nesta ordem de prioridade.
 * open/resolved são o grosso; 'pending' é onde ficam as conversas paradas no bot
 * (o ai-attendant é AgentBot da caixa) e 'snoozed' as adiadas — sem elas o
 * "importar TODO o histórico" seria mentira. Ficam por ÚLTIMO de propósito: se
 * um status exótico devolvesse erro do Chatwoot, o cursor dele travaria a
 * varredura, e é melhor que isso aconteça depois de open/resolved terem entrado.
 */
export const STATUS_BACKFILL = ['open', 'resolved', 'pending', 'snoozed'] as const
export type StatusBackfill = (typeof STATUS_BACKFILL)[number]

/** Teto de segurança de mensagens lidas por conversa numa visita. */
export const TETO_MENSAGENS_CONVERSA = 2000
/** Teto de páginas de mensagens por conversa (o Chatwoot devolve ~20 por página). */
export const TETO_PAGINAS_MENSAGENS = 120
/** Anexos considerados por mensagem (WhatsApp manda 1; o resto é defesa). */
export const MAX_ANEXOS_POR_MENSAGEM = 5
/** Linhas por INSERT (lote grande demais estoura o payload do PostgREST). */
export const CHUNK_INSERT = 200
/**
 * Folga exigida antes de INICIAR o download de um anexo: o cliente binário do
 * relay tem timeout de 15s e o upload ao Storage (até 40 MB) tem o seu próprio
 * teto (TIMEOUT_UPLOAD_MS). 15 + 30 + margem — a função morre em 300s e o que
 * não pode faltar é o SALVAR CURSOR no fim do tick.
 */
const FOLGA_ANEXO_MS = 50_000

/**
 * Teto do upload ao Storage. O supabase-js não aceita AbortSignal aqui, então o
 * limite é uma corrida: perdida a corrida, a mensagem fica com motivo pendente
 * (o objeto que porventura chegue depois é sobrescrito na próxima visita, que
 * sobe com upsert) e o tick termina a tempo de gravar o cursor.
 */
const TIMEOUT_UPLOAD_MS = 30_000

/**
 * Espaçamento MÍNIMO entre chamadas ao relay. O relay limita 120 req/min por IP
 * (RELAY_RATE_MAX) e esse orçamento é compartilhado com a tela /conversas e com
 * o cron do reconciliador: um backfill de 280s sem freio dispararia centenas de
 * chamadas por minuto e derrubaria os DOIS em 429. 900ms ≈ 66 req/min deixa a
 * metade do orçamento para quem está atendendo cliente.
 */
export const ESPACO_RELAY_MS = 900

/**
 * Ritmo (rate limit do lado de cá): devolve uma função que só resolve quando já
 * passou `espacamentoMs` desde a chamada anterior. Pura o bastante para teste
 * (relógio injetável); espaçamento 0 = sem espera (é o que os testes usam).
 */
export function criarRitmo(
  espacamentoMs: number = ESPACO_RELAY_MS,
  agoraFn: () => number = Date.now,
): () => Promise<number> {
  let liberadoEm = 0
  return async function aguardarVez(): Promise<number> {
    if (espacamentoMs <= 0) return 0
    const agora = agoraFn()
    const espera = liberadoEm - agora
    liberadoEm = Math.max(agora, liberadoEm) + espacamentoMs
    if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera))
    return espera > 0 ? espera : 0
  }
}

/** Assinatura do ritmo repassado às funções de I/O. */
export type Ritmo = () => Promise<number>

/* ── Tipos ────────────────────────────────────────────────────────────────── */

/** Linha de conversas_backfill_estado (o cursor). */
export interface CursorBackfill {
  inbox: string
  status: string
  pagina: number
  concluido: boolean
  conversas_feitas: number
  mensagens_importadas: number
  anexos_importados: number
  /** Ids do Chatwoot já concluídos NESTA página (progresso durável intra-página). */
  conversas_pagina_ok: number[]
}

/** Conversa do Chatwoot reduzida ao que o backfill precisa. */
export interface ConversaBackfill {
  id: number
  nome: string | null
  telefone: string | null
  /**
   * identifier do contato — é onde o jid de GRUPO viveria. O relay hoje NÃO
   * expõe este campo (ver observações do workflow): lido defensivamente para o
   * dia em que expuser; ausente, conversa de grupo simplesmente não aparece.
   */
  identifier: string | null
}

/** Mensagem do Chatwoot reduzida ao que o backfill precisa. */
export interface MensagemBackfill {
  id: number
  direcao: string
  privada: boolean
  conteudo: string
  timestampMs: number
  senderTipo: string | null
  /**
   * source_id do Chatwoot ('WAID:<key.id da Evolution>' quando a mensagem veio
   * pela ponte nativa). O relay hoje NÃO expõe — lido defensivamente nos dois
   * nomes possíveis. Sem ele o id da linha vira 'cw:<id>' (ver mensagemIdDeChatwoot).
   */
  sourceId: string | null
  anexos: { tipo: string | null; url: string | null }[]
}

/** Anexo a buscar depois que a mensagem já entrou no acervo. */
export interface AnexoPendente {
  instancia: InstanciaAcervo
  mensagemId: string
  url: string
  filename: string
}

/* ── Puras: cursor ────────────────────────────────────────────────────────── */

/**
 * As combinações varridas (inbox × status), na ORDEM em que são atacadas:
 * status-major, para que as duas caixas terminem 'open' antes de qualquer uma
 * começar 'resolved' — e para que um status exótico com problema no Chatwoot
 * (que travaria o cursor dele) não bloqueie o essencial.
 */
export const CURSORES_PADRAO: { inbox: InboxBackfill; status: StatusBackfill }[] =
  STATUS_BACKFILL.flatMap((status) => INBOXES_BACKFILL.map((inbox) => ({ inbox, status })))

/** Chave de comparação de um cursor. */
export function chaveCursor(inbox: string, status: string): string {
  return `${inbox}:${status}`
}

/**
 * Próximo cursor a trabalhar: a primeira combinação de CURSORES_PADRAO que ainda
 * não foi concluída. Combinação sem linha no banco conta como pagina 1 (a
 * semeadura acontece antes, mas a decisão não depende dela). null = tudo pronto.
 */
export function proximoCursor(linhas: CursorBackfill[]): CursorBackfill | null {
  const porChave = new Map<string, CursorBackfill>()
  for (const l of linhas) porChave.set(chaveCursor(l.inbox, l.status), l)
  for (const padrao of CURSORES_PADRAO) {
    const atual = porChave.get(chaveCursor(padrao.inbox, padrao.status))
    if (!atual) {
      return {
        inbox: padrao.inbox,
        status: padrao.status,
        pagina: 1,
        concluido: false,
        conversas_feitas: 0,
        mensagens_importadas: 0,
        anexos_importados: 0,
        conversas_pagina_ok: [],
      }
    }
    if (!atual.concluido) return atual
  }
  return null
}

/**
 * Estado seguinte do cursor:
 *  • listagem VAZIA → concluído (fim daquela combinação inbox × status);
 *  • página inteira importada → próxima página, com a lista de "feitas nesta
 *    página" ZERADA (ela só vale para a página que fica);
 *  • página incompleta (deadline/erro) → mesma página, GUARDANDO quem já
 *    terminou: sem isso uma página cujo trabalho não cabe num tick seria refeita
 *    do zero a cada 10 minutos e a varredura travaria nela para sempre.
 */
export function avancoDoCursor(
  pagina: number,
  contagens: { conversasNaPagina: number; conversasFeitas: number; feitasIds?: number[] },
): { pagina: number; concluido: boolean; conversasPaginaOk: number[] } {
  if (contagens.conversasNaPagina === 0) return { pagina, concluido: true, conversasPaginaOk: [] }
  if (contagens.conversasFeitas >= contagens.conversasNaPagina) {
    return { pagina: pagina + 1, concluido: false, conversasPaginaOk: [] }
  }
  return { pagina, concluido: false, conversasPaginaOk: contagens.feitasIds ?? [] }
}

/* ── Puras: mapeamento Chatwoot → acervo ──────────────────────────────────── */

/** Inbox do cursor → instância da Evolution (a chave da conversa no acervo). */
export function instanciaDaInbox(inbox: string): InstanciaAcervo | null {
  const v = (inbox ?? '').trim().toLowerCase()
  if (v === 'df') return 'whatsapp-df'
  if (v === 'sc') return 'whatsapp-sc'
  return null
}

/** Inbox do cursor → rótulo aceito pelo relay ('DF' | 'SC'). */
export function inboxParaRelay(inbox: string): 'DF' | 'SC' | null {
  const v = (inbox ?? '').trim().toLowerCase()
  if (v === 'df') return 'DF'
  if (v === 'sc') return 'SC'
  return null
}

/**
 * jid da conversa a partir do contato do Chatwoot:
 *  • identifier de GRUPO ('<id>@g.us') → conversa de grupo, jid como veio;
 *  • telefone → dígitos + '@s.whatsapp.net' (o mesmo formato que a Evolution
 *    entrega ao encaminhador, o que faz a conversa importada CAIR NA MESMA
 *    linha de conversas_acervo que a ingestão ao vivo já criou).
 * Sem telefone utilizável e sem identifier → null (conversa não importável).
 */
export function jidDaConversa(
  c: Pick<ConversaBackfill, 'telefone' | 'identifier'>,
): { jid: string; tipo: 'individual' | 'grupo' } | null {
  const ident = (c.identifier ?? '').trim().toLowerCase()
  if (ident.endsWith('@g.us') && ident.length > '@g.us'.length) {
    return { jid: ident, tipo: 'grupo' }
  }
  const digitos = apenasDigitos(c.telefone)
  if (digitos.length >= 10) return { jid: `${digitos}@s.whatsapp.net`, tipo: 'individual' }
  return null
}

/**
 * Id da mensagem no acervo.
 *
 * Quando o Chatwoot guarda o source_id da ponte nativa ('WAID:<key.id>'), o id
 * usado é o key.id CRU — exatamente o que o encaminhador da Etapa 0 grava. É o
 * que faz o histórico importado e a captura ao vivo se DEDUPLICAREM sozinhos
 * pelo UNIQUE (tenant_id, instancia, mensagem_id), sem janela de duplicata.
 * Sem source_id (mensagem criada no painel do Chatwoot, ou relay que ainda não
 * expõe o campo) o id vira 'cw:<id do Chatwoot>' — estável e não colide com
 * nenhum id da Evolution.
 */
export function mensagemIdDeChatwoot(m: { id: number; sourceId?: string | null }): string {
  const bruto = (m.sourceId ?? '').trim()
  const waid = /^WAID:(.+)$/i.exec(bruto)
  if (waid) {
    const id = waid[1].trim()
    if (id) return id.slice(0, 300)
  }
  return `cw:${m.id}`
}

/** file_type do Chatwoot → tipo do acervo. */
export function tipoDoAnexo(fileType: string | null): TipoMensagemAcervo {
  switch ((fileType ?? '').trim().toLowerCase()) {
    case 'image':
      return 'imagem'
    case 'video':
      return 'video'
    case 'audio':
      return 'audio'
    case 'file':
      return 'documento'
    default:
      return 'outro'
  }
}

/** Tipo da mensagem: sem anexo é texto; com anexo, o tipo do PRIMEIRO anexo. */
export function tipoDaMensagem(anexos: { tipo: string | null }[]): TipoMensagemAcervo {
  if (anexos.length === 0) return 'texto'
  return tipoDoAnexo(anexos[0].tipo)
}

/**
 * origem da mensagem — só faz sentido quando saiu do nosso número (de_mim).
 * O relay classifica o sender em cliente/agente/bot/sistema; traduzimos só o que
 * é inequívoco (agente → atendente, bot/sistema → sistema). Qualquer outra coisa
 * fica NULL: não forçar é melhor do que inventar autoria no acervo.
 *
 * CAVEAT registrado: a classificação é do relay, não nossa — e o fallback dele
 * para saída sem sender_type conhecido é 'agente'. Mensagem do BOT que o
 * Chatwoot recebeu por um sender genérico pode, portanto, aparecer como
 * 'atendente' no histórico importado. É o melhor sinal disponível do lado de lá;
 * a captura ao vivo (Etapa 0) continua sendo a fonte precisa de autoria.
 */
export function origemDoSender(
  deMim: boolean,
  senderTipo: string | null,
): 'sistema' | 'atendente' | undefined {
  if (!deMim) return undefined
  const t = (senderTipo ?? '').trim().toLowerCase()
  if (t === 'agente') return 'atendente'
  if (t === 'bot' || t === 'sistema') return 'sistema'
  return undefined
}

/**
 * A mensagem do Chatwoot entra no acervo?
 * NÃO entram: 'atividade' (mudança de status/atribuição, que só existe no
 * Chatwoot) e NOTA PRIVADA (conversa interna da equipe). Nenhuma das duas saiu
 * ou entrou pelo WhatsApp — importá-las poluiria a thread da Etapa 2 e
 * quebraria o medidor de paridade, que também as ignora do outro lado.
 * Mensagem sem data utilizável também fica de fora: o acervo ordena por
 * timestamp e um "agora" inventado empurraria a conversa histórica para o topo.
 */
export function importavelParaAcervo(m: MensagemBackfill): boolean {
  if (m.privada) return false
  if (m.direcao === 'atividade') return false
  return m.timestampMs > 0
}

/** Nome do arquivo a partir da URL do anexo (fallback: '<mensagemId>_<n>'). */
export function nomeDoAnexo(url: string | null, mensagemId: string, indice: number): string {
  const padrao = `${mensagemId}_${indice + 1}`
  try {
    const caminho = new URL(String(url)).pathname
    const seg = decodeURIComponent(caminho.split('/').filter(Boolean).pop() ?? '')
    return seg.trim() ? seg.trim().slice(0, 300) : padrao
  } catch {
    return padrao
  }
}

/**
 * Path do binário importado, dentro do prefixo do acervo DESTE tenant
 * (pathMediaAcervoValido continua valendo):
 *   <tenant>/conversas-acervo/backfill/<conversa>/<mensagemId>_<nome>
 * Todos os segmentos são sanitizados (anti-traversal da normalizar.ts).
 */
export function caminhoMediaBackfill(dados: {
  tenantId: string
  conversaId: string
  mensagemId: string
  filename: string
}): string {
  const conversa = sanitizarSegmentoPath(dados.conversaId, 'sem-conversa')
  const mensagem = sanitizarSegmentoPath(dados.mensagemId, 'msg')
  const nome = sanitizarSegmentoPath(dados.filename, 'arquivo')
  return `${prefixoAcervo(dados.tenantId)}backfill/${conversa}/${mensagem}_${nome}`
}

/** Motivo registrado enquanto o binário do anexo ainda não foi buscado. */
export const MOTIVO_ANEXO_PENDENTE = 'backfill_anexo_pendente'

/**
 * Mensagem do Chatwoot → eventos do contrato da ingestão (contrato.ts). Um
 * evento por anexo (o WhatsApp manda um só; mensagem do painel do Chatwoot pode
 * ter mais de um — o extra ganha id sufixado para não se perder), ou um único
 * evento de texto quando não há anexo.
 *
 * A mídia nasce SEMPRE `pendente`: a mensagem entra no acervo primeiro (é o que
 * não pode faltar) e o binário é preenchido depois, dentro do orçamento do tick.
 */
export function eventosDaMensagem(
  m: MensagemBackfill,
  ctx: {
    instancia: InstanciaAcervo
    jid: string
    tipoConversa: 'individual' | 'grupo'
    tituloGrupo?: string | null
  },
): EventoConversa[] {
  const mensagemId = mensagemIdDeChatwoot(m)
  const deMim = m.direcao === 'saida'
  const base = {
    instancia: ctx.instancia,
    conversaJid: ctx.jid,
    tipoConversa: ctx.tipoConversa,
    tituloGrupo: ctx.tipoConversa === 'grupo' ? (ctx.tituloGrupo ?? undefined) : undefined,
    deMim,
    origemProvavel: origemDoSender(deMim, m.senderTipo),
    timestamp: m.timestampMs,
  } satisfies Partial<EventoConversa>

  const anexos = m.anexos.slice(0, MAX_ANEXOS_POR_MENSAGEM)
  if (anexos.length === 0) {
    return [{ ...base, mensagemId, tipo: 'texto', texto: m.conteudo || undefined }]
  }

  return anexos.map((anexo, i) => ({
    ...base,
    // O primeiro anexo guarda o id "real" (e a legenda); os extras ganham
    // sufixo estável — reimportar gera exatamente os mesmos ids.
    mensagemId: i === 0 ? mensagemId : `${mensagemId}#a${i + 1}`,
    tipo: tipoDoAnexo(anexo.tipo),
    texto: i === 0 ? m.conteudo || undefined : undefined,
    media: { pendente: true as const, motivo: MOTIVO_ANEXO_PENDENTE },
  }))
}

/** Linha de conversa_mensagens do backfill (a da ingestão + a proveniência). */
export interface LinhaBackfill extends LinhaMensagem {
  chatwoot_msg_id: string
  chatwoot_confirmada_em: string
  origem_backfill: true
}

/**
 * Evento → linha do acervo com o CARIMBO ANTI-LOOP.
 *
 * chatwoot_confirmada_em vem preenchido porque a mensagem VEIO do Chatwoot: sem
 * isso o reconciliador da Etapa 1 (083) trataria o histórico inteiro como
 * "suspeito de perdido" e tentaria repostá-lo. chatwoot_postada_em NUNCA é
 * escrito — nós não postamos nada aqui.
 */
export function linhaBackfill(
  evento: EventoConversa,
  contexto: { tenantId: string; conversaId: string },
  chatwootMsgId: number,
  agoraIso: string,
): LinhaBackfill {
  return {
    ...linhaMensagem(evento, contexto),
    chatwoot_msg_id: String(chatwootMsgId),
    chatwoot_confirmada_em: agoraIso,
    origem_backfill: true,
  }
}

/* ── Puras: parsers defensivos do relay ───────────────────────────────────── */

/** Parser DEFENSIVO da listagem (dado externo: shape nunca é confiado). */
export function normalizarConversasBackfill(data: unknown): ConversaBackfill[] {
  const lista = (data as { conversas?: unknown } | null)?.conversas
  if (!Array.isArray(lista)) return []
  const out: ConversaBackfill[] = []
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== 'object') continue
    const c = bruto as {
      id?: unknown
      contato?: { nome?: unknown; telefone?: unknown; identifier?: unknown } | null
    }
    if (typeof c.id !== 'number') continue
    out.push({
      id: c.id,
      nome: typeof c.contato?.nome === 'string' ? c.contato.nome : null,
      telefone: typeof c.contato?.telefone === 'string' ? c.contato.telefone : null,
      identifier: typeof c.contato?.identifier === 'string' ? c.contato.identifier : null,
    })
  }
  return out
}

/** Parser DEFENSIVO das mensagens (superset do que medidor/confirmador leem). */
export function normalizarMensagensBackfill(data: unknown): MensagemBackfill[] {
  const lista = (data as { mensagens?: unknown } | null)?.mensagens
  if (!Array.isArray(lista)) return []
  const out: MensagemBackfill[] = []
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== 'object') continue
    const m = bruto as {
      id?: unknown
      direcao?: unknown
      privada?: unknown
      conteudo?: unknown
      timestamp?: unknown
      sender?: { tipo?: unknown } | null
      sourceId?: unknown
      source_id?: unknown
      anexos?: unknown
    }
    if (typeof m.id !== 'number') continue
    const anexos: { tipo: string | null; url: string | null }[] = []
    if (Array.isArray(m.anexos)) {
      for (const a of m.anexos) {
        if (!a || typeof a !== 'object') continue
        const anexo = a as { tipo?: unknown; url?: unknown }
        anexos.push({
          tipo: typeof anexo.tipo === 'string' ? anexo.tipo : null,
          url: typeof anexo.url === 'string' ? anexo.url : null,
        })
      }
    }
    const fonte = typeof m.sourceId === 'string' ? m.sourceId : typeof m.source_id === 'string' ? m.source_id : null
    out.push({
      id: m.id,
      direcao: typeof m.direcao === 'string' ? m.direcao : '',
      privada: m.privada === true,
      conteudo: typeof m.conteudo === 'string' ? m.conteudo : '',
      timestampMs: msDoTimestampRelay(m.timestamp),
      senderTipo: typeof m.sender?.tipo === 'string' ? m.sender.tipo : null,
      sourceId: fonte,
      anexos,
    })
  }
  return out
}

/** Há folga para baixar + subir um anexo antes do deadline? */
export function podeBaixarAnexo(deadline: number, agoraMs: number = Date.now()): boolean {
  return agoraMs + FOLGA_ANEXO_MS <= deadline
}

/* ── I/O (nunca lança) ────────────────────────────────────────────────────── */

export interface BackfillOpcoes {
  tenantId: string
  /** Epoch ms absoluto: nada é INICIADO depois disso. */
  deadline: number
  agora?: Date
  /** Espaçamento entre chamadas ao relay (default ESPACO_RELAY_MS; 0 nos testes). */
  espacamentoRelayMs?: number
}

export interface BackfillResultado {
  cursor: { inbox: string; status: string; pagina: number } | null
  conversasNaPagina: number
  /** Conversas concluídas NESTE tick (as que entram no contador do cursor). */
  conversasFeitas: number
  /** Conversas da página já concluídas em ticks anteriores (puladas sem custo). */
  conversasJaFeitas: number
  mensagensImportadas: number
  anexosImportados: number
  anexosFalhados: number
  conversasPuladas: number
  /** TODOS os cursores concluídos → a rota vira no-op barato. */
  concluido: boolean
  motivo: 'ok' | 'concluido' | 'sem_tempo' | 'relay_erro' | 'erro'
}

function zerado(): BackfillResultado {
  return {
    cursor: null,
    conversasNaPagina: 0,
    conversasFeitas: 0,
    conversasJaFeitas: 0,
    mensagensImportadas: 0,
    anexosImportados: 0,
    anexosFalhados: 0,
    conversasPuladas: 0,
    concluido: false,
    motivo: 'ok',
  }
}

/**
 * Semeia (uma vez) as linhas do cursor (inbox × status) e devolve o estado atual.
 * ON CONFLICT DO NOTHING: quem já existe é preservado com o progresso dele.
 */
async function garantirCursores(
  admin: SupabaseClient,
  tenantId: string,
): Promise<CursorBackfill[] | null> {
  const { error: erroSemear } = await admin.from('conversas_backfill_estado').upsert(
    CURSORES_PADRAO.map((c) => ({ tenant_id: tenantId, inbox: c.inbox, status: c.status })),
    { onConflict: 'tenant_id,inbox,status', ignoreDuplicates: true },
  )
  if (erroSemear) {
    logger.error('conversas_acervo.backfill.semear_cursor', {}, erroSemear)
    return null
  }
  const { data, error } = await admin
    .from('conversas_backfill_estado')
    .select(
      'inbox, status, pagina, concluido, conversas_feitas, mensagens_importadas, anexos_importados, conversas_pagina_ok',
    )
    .eq('tenant_id', tenantId)
  if (error) {
    logger.error('conversas_acervo.backfill.ler_cursor', {}, error)
    return null
  }
  return (data ?? []).map((l) => {
    const linha = l as Record<string, unknown>
    return {
      inbox: String(linha.inbox ?? ''),
      status: String(linha.status ?? ''),
      pagina: typeof linha.pagina === 'number' ? linha.pagina : 1,
      concluido: linha.concluido === true,
      conversas_feitas: typeof linha.conversas_feitas === 'number' ? linha.conversas_feitas : 0,
      mensagens_importadas:
        typeof linha.mensagens_importadas === 'number' ? linha.mensagens_importadas : 0,
      anexos_importados: typeof linha.anexos_importados === 'number' ? linha.anexos_importados : 0,
      conversas_pagina_ok: Array.isArray(linha.conversas_pagina_ok)
        ? linha.conversas_pagina_ok.map((v) => Number(v)).filter((n) => Number.isFinite(n))
        : [],
    }
  })
}

/** Grava o novo estado do cursor (contadores acumulados + página/conclusão). */
async function salvarCursor(
  admin: SupabaseClient,
  tenantId: string,
  cursor: CursorBackfill,
  novo: { pagina: number; concluido: boolean; conversasPaginaOk: number[] },
  deltas: { conversas: number; mensagens: number; anexos: number },
  agoraIso: string,
): Promise<void> {
  const { error } = await admin
    .from('conversas_backfill_estado')
    .update({
      pagina: novo.pagina,
      concluido: novo.concluido,
      conversas_pagina_ok: novo.conversasPaginaOk,
      conversas_feitas: cursor.conversas_feitas + deltas.conversas,
      mensagens_importadas: cursor.mensagens_importadas + deltas.mensagens,
      anexos_importados: cursor.anexos_importados + deltas.anexos,
      atualizado_em: agoraIso,
    })
    .eq('tenant_id', tenantId)
    .eq('inbox', cursor.inbox)
    .eq('status', cursor.status)
  if (error) {
    logger.error('conversas_acervo.backfill.salvar_cursor', { inbox: cursor.inbox }, error)
  }
}

/**
 * Conversa do acervo (cria se não existir) com a regra "ultima_mensagem_em só
 * avança" da ingestão (patchDeConversa). Devolve o id ou null.
 */
async function garantirConversa(
  admin: SupabaseClient,
  tenantId: string,
  desejada: ConversaDesejada,
  agoraIso: string,
): Promise<string | null> {
  const { error: erroUpsert } = await admin.from('conversas_acervo').upsert(
    [
      {
        tenant_id: tenantId,
        instancia: desejada.instancia,
        jid: desejada.jid,
        tipo: desejada.tipo,
        titulo: desejada.titulo,
        ultima_mensagem_em: desejada.ultimaMensagemEm,
      },
    ],
    { onConflict: 'tenant_id,instancia,jid', ignoreDuplicates: true },
  )
  if (erroUpsert) {
    logger.error('conversas_acervo.backfill.conversa_upsert', {}, erroUpsert)
    return null
  }

  const { data, error } = await admin
    .from('conversas_acervo')
    .select('id, tipo, titulo, ultima_mensagem_em')
    .eq('tenant_id', tenantId)
    .eq('instancia', desejada.instancia)
    .eq('jid', desejada.jid)
    .maybeSingle()
  if (error || !data) {
    logger.error('conversas_acervo.backfill.conversa_select', {}, error)
    return null
  }

  const linha = data as Record<string, unknown>
  const existente: ConversaExistente = {
    id: String(linha.id),
    tipo: (linha.tipo as string | null) ?? null,
    titulo: (linha.titulo as string | null) ?? null,
    ultima_mensagem_em: (linha.ultima_mensagem_em as string | null) ?? null,
  }
  const patch = patchDeConversa(existente, desejada, agoraIso)
  if (patch) {
    const { error: erroPatch } = await admin
      .from('conversas_acervo')
      .update(patch)
      .eq('id', existente.id)
      .eq('tenant_id', tenantId)
    if (erroPatch) logger.error('conversas_acervo.backfill.conversa_update', {}, erroPatch)
  }
  return existente.id
}

interface LeituraMensagens {
  mensagens: MensagemBackfill[]
  /** Chegamos ao fim do histórico (não paramos por teto/deadline/erro). */
  completa: boolean
  motivo: 'ok' | 'sem_tempo' | 'relay_erro' | 'teto' | 'sumiu'
}

/**
 * 404/410 do Chatwoot = a conversa listada não existe mais (apagada entre a
 * listagem e a leitura). É DEFINITIVO: insistir travaria a página para sempre —
 * o cursor só anda quando todas as conversas dela terminam. Qualquer outro
 * código (429, 5xx, 502/503 do relay) é transitório e merece nova tentativa.
 */
function conversaSumiu(status: number): boolean {
  return status === 404 || status === 410
}

/**
 * TODAS as mensagens de uma conversa do Chatwoot, paginando para trás com
 * `before` (mesmo endpoint da tela). Para no fim do histórico, no teto de
 * segurança, no deadline ou num erro do relay — e devolve o que já leu: as
 * mensagens lidas são gravadas de qualquer forma (progresso não se joga fora).
 */
async function lerMensagensDaConversa(
  conversaChatwootId: number,
  deadline: number,
  ritmo: Ritmo,
): Promise<LeituraMensagens> {
  const vistos = new Set<number>()
  const mensagens: MensagemBackfill[] = []
  let before: string | undefined
  let cursorAnterior: number | null = null

  for (let pagina = 0; pagina < TETO_PAGINAS_MENSAGENS; pagina++) {
    if (mensagens.length >= TETO_MENSAGENS_CONVERSA) {
      return { mensagens, completa: false, motivo: 'teto' }
    }
    if (!podeChamarRelay(deadline)) return { mensagens, completa: false, motivo: 'sem_tempo' }
    await ritmo()

    const { status, data } = await relayFetch(`/conversations/${conversaChatwootId}/messages`, {
      method: 'GET',
      email: RELAY_EMAIL_BACKFILL,
      query: { before },
    })
    if (conversaSumiu(status)) return { mensagens, completa: false, motivo: 'sumiu' }
    if (status < 200 || status >= 300) return { mensagens, completa: false, motivo: 'relay_erro' }

    const lote = normalizarMensagensBackfill(data)
    if (lote.length === 0) return { mensagens, completa: true, motivo: 'ok' }

    const novas = lote.filter((m) => !vistos.has(m.id))
    for (const m of novas) vistos.add(m.id)
    mensagens.push(...novas)
    // Página inteiramente repetida = o relay ignorou o `before`: parar é melhor
    // do que girar em falso contra o Chatwoot.
    if (novas.length === 0) return { mensagens, completa: true, motivo: 'ok' }

    const menor = lote.reduce((min, m) => (m.id < min ? m.id : min), lote[0].id)
    if (cursorAnterior !== null && menor >= cursorAnterior) {
      return { mensagens, completa: true, motivo: 'ok' }
    }
    cursorAnterior = menor
    before = String(menor)
  }
  return { mensagens, completa: false, motivo: 'teto' }
}

/**
 * Dos anexos da conversa, os que AINDA precisam de binário (a linha existe e
 * está sem media_storage_path). Numa revisita (a página só anda quando termina)
 * isto poupa baixar e subir de novo o que já está no Storage.
 * Erro de banco → devolve a lista inteira: tentar de novo é idempotente.
 */
async function filtrarAnexosFaltantes(
  admin: SupabaseClient,
  tenantId: string,
  anexos: AnexoPendente[],
): Promise<AnexoPendente[]> {
  if (anexos.length === 0) return anexos
  const faltantes: AnexoPendente[] = []
  for (let i = 0; i < anexos.length; i += CHUNK_INSERT) {
    const lote = anexos.slice(i, i + CHUNK_INSERT)
    const { data, error } = await admin
      .from('conversa_mensagens')
      .select('mensagem_id')
      .eq('tenant_id', tenantId)
      .eq('instancia', lote[0].instancia)
      .in(
        'mensagem_id',
        lote.map((a) => a.mensagemId),
      )
      .is('media_storage_path', null)
    if (error) {
      logger.error('conversas_acervo.backfill.anexos_faltantes', {}, error)
      faltantes.push(...lote)
      continue
    }
    const semMedia = new Set((data ?? []).map((l) => String((l as { mensagem_id: unknown }).mensagem_id)))
    faltantes.push(...lote.filter((a) => semMedia.has(a.mensagemId)))
  }
  return faltantes
}

/** Insere as linhas em lotes; devolve quantas ENTRARAM de fato (dedupe). */
async function inserirLinhas(admin: SupabaseClient, linhas: LinhaBackfill[]): Promise<number> {
  let inseridas = 0
  for (let i = 0; i < linhas.length; i += CHUNK_INSERT) {
    const lote = linhas.slice(i, i + CHUNK_INSERT)
    const { data, error } = await admin
      .from('conversa_mensagens')
      .upsert(lote, { onConflict: 'tenant_id,instancia,mensagem_id', ignoreDuplicates: true })
      .select('id')
    if (error) {
      logger.error('conversas_acervo.backfill.inserir', { linhas: lote.length }, error)
      continue
    }
    inseridas += data?.length ?? 0
  }
  return inseridas
}

type DesfechoAnexo = 'importado' | 'falhou' | 'sem_tempo' | 'relay_fora'

/**
 * Baixa o binário do anexo pelo relay e o sobe ao Storage, completando a linha
 * da mensagem. O UPDATE é CONDICIONAL (`media_storage_path IS NULL`): se outra
 * visita já completou a mídia, esta não sobrescreve.
 *
 * Falha DEFINITIVA (anexo grande demais, proxy desligado, upload recusado)
 * apenas registra o código em media_pendente_motivo — a mensagem continua no
 * acervo com a existência da mídia declarada, que é o que impede o buraco
 * silencioso. Relay fora do ar NÃO é definitivo: a conversa fica incompleta e o
 * próximo tick tenta de novo.
 */
async function importarAnexo(
  admin: SupabaseClient,
  tenantId: string,
  conversaId: string,
  anexo: AnexoPendente,
  deadline: number,
  ritmo: Ritmo,
): Promise<DesfechoAnexo> {
  if (!podeBaixarAnexo(deadline)) return 'sem_tempo'
  await ritmo()

  const marcarPendente = async (motivo: string) => {
    const { error } = await admin
      .from('conversa_mensagens')
      .update({ media_pendente_motivo: motivo.slice(0, 120) })
      .eq('tenant_id', tenantId)
      .eq('instancia', anexo.instancia)
      .eq('mensagem_id', anexo.mensagemId)
      .is('media_storage_path', null)
    if (error) logger.error('conversas_acervo.backfill.anexo_motivo', { conversaId }, error)
  }

  const origem = await relayFetchBinario('/attachments', {
    method: 'GET',
    email: RELAY_EMAIL_BACKFILL,
    query: { url: anexo.url },
  })
  if (origem.status === 502 || origem.status === 503) return 'relay_fora'
  if (origem.status !== 200 || !origem.buffer) {
    // 404 = proxy de anexos desligado no relay (RELAY_PROXY_ATTACHMENTS) ou
    // objeto sumido no Chatwoot. Fica registrado na mensagem e a varredura anda.
    await marcarPendente(origem.status === 404 ? 'anexo_indisponivel' : `anexo_http_${origem.status}`)
    return 'falhou'
  }
  if (origem.buffer.length === 0) {
    await marcarPendente('anexo_vazio')
    return 'falhou'
  }
  if (origem.buffer.length > LIMITE_MEDIA_BYTES) {
    await marcarPendente('excede_teto')
    return 'falhou'
  }

  const mimetype = (origem.contentType ?? '').split(';')[0].trim() || 'application/octet-stream'
  const path = caminhoMediaBackfill({
    tenantId,
    conversaId,
    mensagemId: anexo.mensagemId,
    filename: anexo.filename,
  })
  // O upload não aceita AbortSignal: a corrida com o relógio existe para que um
  // upload lento NÃO leve a função além do maxDuration — o cursor precisa ser
  // gravado no fim do tick. Quem perde a corrida vira pendente e é refeito na
  // próxima visita (upsert: true sobrescreve qualquer objeto meio-escrito).
  let timerUpload: ReturnType<typeof setTimeout> | undefined
  const erroUpload = await Promise.race([
    admin.storage
      .from('documentos')
      .upload(path, origem.buffer, { contentType: mimetype, upsert: true })
      .then(({ error }) => error as { message: string } | null),
    new Promise<{ message: string }>((resolve) => {
      timerUpload = setTimeout(() => resolve({ message: 'upload_timeout' }), TIMEOUT_UPLOAD_MS)
    }),
  ]).finally(() => clearTimeout(timerUpload))
  if (erroUpload) {
    logger.error('conversas_acervo.backfill.upload', { conversaId }, erroUpload)
    await marcarPendente('anexo_upload_falhou')
    return 'falhou'
  }

  const { error: erroUpdate } = await admin
    .from('conversa_mensagens')
    .update({
      media_storage_path: path,
      media_filename: anexo.filename.slice(0, 300),
      media_mimetype: mimetype.slice(0, 200),
      media_tamanho: origem.buffer.length,
      media_pendente_motivo: null,
    })
    .eq('tenant_id', tenantId)
    .eq('instancia', anexo.instancia)
    .eq('mensagem_id', anexo.mensagemId)
    .is('media_storage_path', null)
  if (erroUpdate) {
    logger.error('conversas_acervo.backfill.anexo_update', { conversaId }, erroUpdate)
    return 'falhou'
  }
  return 'importado'
}

interface ResultadoConversa {
  /** Conversa terminou (mensagens E anexos resolvidos) → a página pode andar. */
  completa: boolean
  mensagens: number
  anexos: number
  anexosFalhados: number
  pulada: boolean
  motivo: 'ok' | 'sem_tempo' | 'relay_erro' | 'sem_jid' | 'teto' | 'sumiu' | 'erro'
}

/**
 * Importa UMA conversa do Chatwoot: mensagens primeiro (é o que não pode
 * faltar), anexos depois, dentro do orçamento do tick.
 */
async function importarConversa(
  admin: SupabaseClient,
  tenantId: string,
  inbox: string,
  conversa: ConversaBackfill,
  opts: { deadline: number; agoraIso: string; ritmo: Ritmo },
): Promise<ResultadoConversa> {
  const r: ResultadoConversa = {
    completa: false,
    mensagens: 0,
    anexos: 0,
    anexosFalhados: 0,
    pulada: false,
    motivo: 'ok',
  }

  const instancia = instanciaDaInbox(inbox)
  const identidade = jidDaConversa(conversa)
  if (!instancia || !identidade) {
    // Sem jid não há conversa no acervo (contato do Chatwoot sem telefone).
    // Conta como resolvida: insistir nela travaria a página para sempre.
    r.completa = true
    r.pulada = true
    r.motivo = 'sem_jid'
    return r
  }

  const leitura = await lerMensagensDaConversa(conversa.id, opts.deadline, opts.ritmo)
  if (leitura.motivo === 'relay_erro') r.motivo = 'relay_erro'
  if (leitura.motivo === 'sem_tempo') r.motivo = 'sem_tempo'
  // Conversa apagada no Chatwoot depois de listada: DEFINITIVO. Damos por
  // resolvida (com o que já lemos, se lemos algo) para a página poder andar —
  // insistir nela travaria a varredura inteira para sempre.
  if (leitura.motivo === 'sumiu') {
    r.motivo = 'sumiu'
    logger.warn('conversas_acervo.backfill.conversa_sumiu', { chatwootConvId: conversa.id })
  }
  // TETO de segurança batido: guardamos as mensagens mais recentes e damos a
  // conversa por RESOLVIDA de propósito. Insistir nela travaria a página (e a
  // varredura inteira) para sempre por causa de um único histórico gigante.
  if (leitura.motivo === 'teto') {
    r.motivo = 'teto'
    logger.warn('conversas_acervo.backfill.teto_mensagens', {
      chatwootConvId: conversa.id,
      lidas: leitura.mensagens.length,
    })
  }
  const leituraResolvida =
    leitura.completa || leitura.motivo === 'teto' || leitura.motivo === 'sumiu'

  const importaveis = leitura.mensagens.filter(importavelParaAcervo)
  if (importaveis.length === 0) {
    // Nada a guardar (só atividades/notas) — a conversa está resolvida se a
    // leitura chegou ao fim.
    r.completa = leituraResolvida
    return r
  }

  const brutos: EventoConversa[] = []
  const anexosPorMensagem = new Map<string, AnexoPendente>()
  const chatwootIdPorMensagem = new Map<string, number>()
  for (const m of importaveis) {
    const dela = eventosDaMensagem(m, {
      instancia,
      jid: identidade.jid,
      tipoConversa: identidade.tipo,
      tituloGrupo: identidade.tipo === 'grupo' ? conversa.nome : null,
    })
    dela.forEach((evento, i) => {
      brutos.push(evento)
      // "Primeiro ganha", igual ao dedupe intra-lote logo abaixo: se dois
      // eventos colidirem no mesmo mensagemId, os metadados são os do primeiro.
      if (chatwootIdPorMensagem.has(evento.mensagemId)) return
      chatwootIdPorMensagem.set(evento.mensagemId, m.id)
      const anexo = m.anexos[i]
      if (anexo?.url) {
        anexosPorMensagem.set(evento.mensagemId, {
          instancia,
          mensagemId: evento.mensagemId,
          url: anexo.url,
          filename: nomeDoAnexo(anexo.url, evento.mensagemId, i),
        })
      }
    })
  }
  // Dedupe intra-lote (mesmo helper da ingestão): duas mensagens do Chatwoot com
  // o mesmo source_id virariam a mesma linha — a primeira ganha.
  const { unicos: eventos } = deduplicarEventos(brutos)

  const desejadas = conversasDoLote(eventos)
  const desejada = desejadas[0]
  if (!desejada) {
    r.completa = leituraResolvida
    return r
  }
  const conversaId = await garantirConversa(admin, tenantId, desejada, opts.agoraIso)
  if (!conversaId) {
    r.motivo = 'erro'
    return r
  }

  const linhas = eventos.map((evento) =>
    linhaBackfill(
      evento,
      { tenantId, conversaId },
      chatwootIdPorMensagem.get(evento.mensagemId) ?? 0,
      opts.agoraIso,
    ),
  )
  r.mensagens = await inserirLinhas(admin, linhas)

  // Anexos: o que não couber no tick fica pendente e é completado na próxima
  // visita (UPDATE condicional por media_storage_path IS NULL).
  const anexosPendentes = await filtrarAnexosFaltantes(
    admin,
    tenantId,
    eventos.map((e) => anexosPorMensagem.get(e.mensagemId)).filter((a): a is AnexoPendente => !!a),
  )
  let anexosResolvidos = true
  for (const anexo of anexosPendentes) {
    const desfecho = await importarAnexo(
      admin,
      tenantId,
      conversaId,
      anexo,
      opts.deadline,
      opts.ritmo,
    )
    if (desfecho === 'importado') r.anexos++
    else if (desfecho === 'falhou') r.anexosFalhados++
    else {
      // sem_tempo / relay_fora: não resolvido — a conversa volta no próximo tick.
      anexosResolvidos = false
      r.motivo = desfecho === 'sem_tempo' ? 'sem_tempo' : 'relay_erro'
      break
    }
  }

  r.completa = leituraResolvida && anexosResolvidos
  return r
}

/**
 * UM TICK do backfill: pega o cursor não-concluído, importa a página dele e
 * salva o avanço. NUNCA lança; respeita o deadline SEMPRE (o cursor durável faz
 * a retomada custar zero em dados perdidos).
 */
export async function backfillLote(
  admin: SupabaseClient,
  opts: BackfillOpcoes,
): Promise<BackfillResultado> {
  const r = zerado()
  try {
    const agoraIso = (opts.agora ?? new Date()).toISOString()
    const cursores = await garantirCursores(admin, opts.tenantId)
    if (!cursores) {
      r.motivo = 'erro'
      return r
    }

    const cursor = proximoCursor(cursores)
    if (!cursor) {
      r.concluido = true
      r.motivo = 'concluido'
      return r
    }
    r.cursor = { inbox: cursor.inbox, status: cursor.status, pagina: cursor.pagina }

    const inboxRelay = inboxParaRelay(cursor.inbox)
    if (!inboxRelay) {
      logger.error('conversas_acervo.backfill.inbox_invalida', { inbox: cursor.inbox })
      r.motivo = 'erro'
      return r
    }
    if (!podeChamarRelay(opts.deadline)) {
      r.motivo = 'sem_tempo'
      return r
    }

    const ritmo = criarRitmo(opts.espacamentoRelayMs ?? ESPACO_RELAY_MS)
    await ritmo()
    const { status, data } = await relayFetch('/conversations', {
      method: 'GET',
      email: RELAY_EMAIL_BACKFILL,
      query: { status: cursor.status, page: String(cursor.pagina), inbox: inboxRelay },
    })
    if (status < 200 || status >= 300) {
      logger.warn('conversas_acervo.backfill.relay_lista', { status, inbox: cursor.inbox })
      r.motivo = 'relay_erro'
      return r
    }

    const conversas = normalizarConversasBackfill(data)
    r.conversasNaPagina = conversas.length

    // Conversas desta página já concluídas em ticks anteriores: pular custa
    // ZERO chamada de relay e é o que faz uma página pesada (muita mídia)
    // terminar em vários ticks em vez de recomeçar do zero para sempre.
    const jaFeitas = new Set(cursor.conversas_pagina_ok)
    const feitasIds: number[] = []

    for (const conversa of conversas) {
      if (jaFeitas.has(conversa.id)) {
        r.conversasJaFeitas++
        feitasIds.push(conversa.id)
        continue
      }
      if (!podeChamarRelay(opts.deadline)) {
        r.motivo = 'sem_tempo'
        break
      }
      const feita = await importarConversa(admin, opts.tenantId, cursor.inbox, conversa, {
        deadline: opts.deadline,
        agoraIso,
        ritmo,
      })
      r.mensagensImportadas += feita.mensagens
      r.anexosImportados += feita.anexos
      r.anexosFalhados += feita.anexosFalhados
      if (feita.pulada) r.conversasPuladas++
      if (!feita.completa) {
        // Conversa que não terminou: o cursor NÃO anda (a página volta no
        // próximo tick, já sem as conversas concluídas). 'ok' aqui só acontece
        // se a leitura parou sem motivo conhecido — trata como falta de tempo,
        // que é o caso benigno.
        r.motivo =
          feita.motivo === 'ok' || feita.motivo === 'sem_jid'
            ? 'sem_tempo'
            : feita.motivo === 'teto' || feita.motivo === 'sumiu'
              ? 'ok'
              : feita.motivo
        break
      }
      r.conversasFeitas++
      feitasIds.push(conversa.id)
    }

    const novo = avancoDoCursor(cursor.pagina, {
      conversasNaPagina: r.conversasNaPagina,
      conversasFeitas: r.conversasFeitas + r.conversasJaFeitas,
      feitasIds,
    })
    await salvarCursor(
      admin,
      opts.tenantId,
      cursor,
      novo,
      { conversas: r.conversasFeitas, mensagens: r.mensagensImportadas, anexos: r.anexosImportados },
      agoraIso,
    )

    // Concluiu esta combinação? Só é "tudo pronto" se as outras já estavam.
    // (Aplicamos a conclusão sobre a MESMA lista lida — tirar a linha daria
    // "combinação sem cursor", que proximoCursor lê como pendente.)
    if (novo.concluido) {
      const chaveAtual = chaveCursor(cursor.inbox, cursor.status)
      const depois = cursores.map((c) =>
        chaveCursor(c.inbox, c.status) === chaveAtual ? { ...c, concluido: true } : c,
      )
      if (!depois.some((c) => chaveCursor(c.inbox, c.status) === chaveAtual)) {
        depois.push({ ...cursor, concluido: true })
      }
      r.concluido = proximoCursor(depois) === null
      if (r.concluido) r.motivo = 'concluido'
    }

    logger.info('conversas_acervo.backfill', {
      inbox: cursor.inbox,
      status: cursor.status,
      pagina: cursor.pagina,
      conversasNaPagina: r.conversasNaPagina,
      conversasFeitas: r.conversasFeitas,
      conversasJaFeitas: r.conversasJaFeitas,
      mensagens: r.mensagensImportadas,
      anexos: r.anexosImportados,
      anexosFalhados: r.anexosFalhados,
      motivo: r.motivo,
    })
    return r
  } catch (e) {
    logger.error('conversas_acervo.backfill.falha', {}, e)
    r.motivo = 'erro'
    return r
  }
}

/** Progresso legível para o retorno da rota (LGPD: só contagens e cursores). */
export interface ProgressoBackfill {
  cursores: {
    inbox: string
    status: string
    pagina: number
    concluido: boolean
    conversas: number
    mensagens: number
    anexos: number
  }[]
  totalConversas: number
  totalMensagens: number
  totalAnexos: number
  concluido: boolean
}

export async function progressoBackfill(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ProgressoBackfill | null> {
  const { data, error } = await admin
    .from('conversas_backfill_estado')
    .select('inbox, status, pagina, concluido, conversas_feitas, mensagens_importadas, anexos_importados')
    .eq('tenant_id', tenantId)
  if (error) {
    logger.error('conversas_acervo.backfill.progresso', {}, error)
    return null
  }
  const linhas = (data ?? []) as Record<string, unknown>[]
  const cursores = linhas.map((l) => ({
    inbox: String(l.inbox ?? ''),
    status: String(l.status ?? ''),
    pagina: typeof l.pagina === 'number' ? l.pagina : 1,
    concluido: l.concluido === true,
    conversas: typeof l.conversas_feitas === 'number' ? l.conversas_feitas : 0,
    mensagens: typeof l.mensagens_importadas === 'number' ? l.mensagens_importadas : 0,
    anexos: typeof l.anexos_importados === 'number' ? l.anexos_importados : 0,
  }))
  return {
    cursores,
    totalConversas: cursores.reduce((s, c) => s + c.conversas, 0),
    totalMensagens: cursores.reduce((s, c) => s + c.mensagens, 0),
    totalAnexos: cursores.reduce((s, c) => s + c.anexos, 0),
    concluido: cursores.length === CURSORES_PADRAO.length && cursores.every((c) => c.concluido),
  }
}
