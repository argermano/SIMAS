import {
  LIMITE_MEDIA_BYTES,
  LIMITE_TEXTO_CHARS,
  type EventoConversa,
  type InstanciaAcervo,
} from './contrato'

/**
 * Normalização PURA dos eventos do encaminhador → linhas do acervo
 * (migration 082). Sem I/O: tudo aqui é testável isoladamente e é onde moram as
 * defesas (anti-traversal do path, dedupe intra-lote, "última mensagem só
 * avança"). A rota de ingestão só orquestra o banco.
 */

// --- Chaves -------------------------------------------------------------------

/** Chave estável da conversa: '<instancia>:<jid>'. Usada no dedupe intra-lote e
 *  em conversa_gaps.conversa_chave (o medidor de paridade). */
export function conversaChave(instancia: string, jid: string): string {
  return `${instancia}:${jid}`
}

/** Chave de dedupe da mensagem: '<instancia>:<key.id da Evolution>'. */
export function mensagemChave(instancia: string, mensagemId: string): string {
  return `${instancia}:${mensagemId}`
}

// --- Storage ------------------------------------------------------------------

/**
 * Sanitiza um pedaço de path do Storage. Mesmo espírito do
 * sanitizarNomeArquivo de conversas-envio (só [A-Za-z0-9._-]) MAIS a defesa
 * anti-traversal explícita: qualquer sequência de dois ou mais pontos vira '_',
 * então nenhum segmento pode virar '..'. Nunca devolve vazio.
 */
export function sanitizarSegmentoPath(
  valor: string | null | undefined,
  padrao: string,
): string {
  const limpo = (valor ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
  return limpo || padrao
}

/** Prefixo (no bucket `documentos`) do acervo de conversas DESTE tenant. Termina com '/'. */
export function prefixoAcervo(tenantId: string): string {
  return `${tenantId}/conversas-acervo/`
}

/**
 * Path do objeto de mídia no bucket `documentos`:
 *   <tenant>/conversas-acervo/<instancia>/<jidSanitizado>/<mensagemId>_<nomeSanitizado>
 * O jid é sanitizado ('@' e '.' viram '_' ou somem), então o path NÃO é
 * reversível — a identidade da conversa vive no banco, não no path.
 */
export function caminhoMediaAcervo(dados: {
  tenantId: string
  instancia: string
  conversaJid?: string | null
  mensagemId: string
  filename: string
}): string {
  const instancia = sanitizarSegmentoPath(dados.instancia, 'instancia')
  const jid = sanitizarSegmentoPath(dados.conversaJid, 'sem-jid')
  const mensagemId = sanitizarSegmentoPath(dados.mensagemId, 'msg')
  const nome = sanitizarSegmentoPath(dados.filename, 'arquivo')
  return `${prefixoAcervo(dados.tenantId)}${instancia}/${jid}/${mensagemId}_${nome}`
}

/**
 * True se o storagePath informado pelo encaminhador pertence ao acervo DESTE
 * tenant. LIÇÃO DA AUDITORIA: o path vem de fora e o admin client (service role)
 * ignora a RLS — sem esta checagem uma linha do acervo poderia apontar para
 * QUALQUER objeto do bucket (inclusive de outro tenant). '..' é recusado como
 * defesa extra.
 */
export function pathMediaAcervoValido(
  storagePath: string | null | undefined,
  tenantId: string | null | undefined,
): boolean {
  if (!storagePath || !tenantId) return false
  if (storagePath.includes('..')) return false
  return storagePath.startsWith(prefixoAcervo(tenantId))
}

export type ValidacaoMediaOk = { ok: true }
export type ValidacaoMediaErro = { ok: false; erro: string; status: number }

/**
 * Guard do preparar-media: só TAMANHO (teto de 40 MB). O tipo de arquivo é
 * LIVRE de propósito — isto é acervo, não envio: o que o cliente mandou tem de
 * ser guardado como veio (a allowlist de conversas-envio existe para não
 * ENVIARMOS lixo, aqui só recebemos). O bucket é privado e nada é servido
 * inline sem passar pelo proxy de anexos.
 */
export function validarMediaAcervo(dados: {
  tamanho: number
}): ValidacaoMediaOk | ValidacaoMediaErro {
  if (!Number.isFinite(dados.tamanho) || dados.tamanho <= 0) {
    return { ok: false, erro: 'Tamanho inválido', status: 400 }
  }
  if (dados.tamanho > LIMITE_MEDIA_BYTES) {
    return { ok: false, erro: 'Arquivo excede o limite de 40 MB', status: 413 }
  }
  return { ok: true }
}

// --- Campos -------------------------------------------------------------------

/**
 * Epoch → ISO. O contrato diz MILISSEGUNDOS, mas a Evolution entrega
 * messageTimestamp em SEGUNDOS em vários payloads: valores abaixo de 1e12
 * (antes de 2001 em ms) são tratados como segundos. Absurdos (ou NaN) caem no
 * "agora" — perder a mensagem por causa do relógio seria pior.
 */
export function timestampParaIso(epoch: number, agora: number = Date.now()): string {
  if (!Number.isFinite(epoch) || epoch <= 0) return new Date(agora).toISOString()
  const ms = epoch < 1e12 ? Math.round(epoch * 1000) : Math.round(epoch)
  // Janela sã: 2001-09-09 .. ~agora + 1 dia (relógio adiantado do aparelho).
  if (ms < 1e12 || ms > agora + 86_400_000) return new Date(agora).toISOString()
  return new Date(ms).toISOString()
}

/** Texto vazio/só espaço vira null; acima do teto é truncado (nunca 400). */
export function normalizarTexto(texto: string | null | undefined): string | null {
  const t = (texto ?? '').trim()
  if (!t) return null
  return t.length > LIMITE_TEXTO_CHARS ? t.slice(0, LIMITE_TEXTO_CHARS) : t
}

/** Título do grupo: só em conversa de grupo, vazio vira null. */
export function normalizarTitulo(evento: EventoConversa): string | null {
  if (evento.tipoConversa !== 'grupo') return null
  const t = (evento.tituloGrupo ?? '').trim()
  return t ? t.slice(0, 300) : null
}

/** origem só existe quando a mensagem saiu do nosso número (deMim). */
export function origemDoEvento(evento: EventoConversa): 'sistema' | 'atendente' | null {
  if (!evento.deMim) return null
  return evento.origemProvavel ?? null
}

// --- Dedupe intra-lote --------------------------------------------------------

/**
 * Remove repetições DENTRO do lote por (instancia, mensagemId), mantendo a
 * PRIMEIRA ocorrência. O UNIQUE do banco já protegeria, mas deduplicar aqui faz
 * a contagem devolvida ao encaminhador bater com a realidade (aceitos +
 * duplicados = eventos recebidos).
 */
export function deduplicarEventos(eventos: EventoConversa[]): {
  unicos: EventoConversa[]
  duplicadosNoLote: number
} {
  const vistos = new Set<string>()
  const unicos: EventoConversa[] = []
  for (const ev of eventos) {
    const chave = mensagemChave(ev.instancia, ev.mensagemId)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    unicos.push(ev)
  }
  return { unicos, duplicadosNoLote: eventos.length - unicos.length }
}

// --- Linhas do banco ----------------------------------------------------------

export interface ConversaDesejada {
  chave: string
  instancia: InstanciaAcervo
  jid: string
  tipo: 'individual' | 'grupo'
  titulo: string | null
  ultimaMensagemEm: string
}

/**
 * Agrega o lote em uma linha desejada por conversa: tipo/titulo do evento MAIS
 * RECENTE que os informa (grupo renomeado ganha o nome novo) e
 * ultimaMensagemEm = maior timestamp do lote.
 */
export function conversasDoLote(
  eventos: EventoConversa[],
  agora: number = Date.now(),
): ConversaDesejada[] {
  const mapa = new Map<string, ConversaDesejada & { _ts: number }>()
  for (const ev of eventos) {
    const chave = conversaChave(ev.instancia, ev.conversaJid)
    const iso = timestampParaIso(ev.timestamp, agora)
    const ts = Date.parse(iso)
    const atual = mapa.get(chave)
    if (!atual) {
      mapa.set(chave, {
        chave,
        instancia: ev.instancia,
        jid: ev.conversaJid,
        tipo: ev.tipoConversa,
        titulo: normalizarTitulo(ev),
        ultimaMensagemEm: iso,
        _ts: ts,
      })
      continue
    }
    if (ts >= atual._ts) {
      atual._ts = ts
      atual.ultimaMensagemEm = iso
      atual.tipo = ev.tipoConversa
      const titulo = normalizarTitulo(ev)
      if (titulo) atual.titulo = titulo
    } else if (!atual.titulo) {
      atual.titulo = normalizarTitulo(ev)
    }
  }
  return [...mapa.values()].map(({ _ts, ...conversa }) => conversa)
}

export interface ConversaExistente {
  id: string
  tipo: string | null
  titulo: string | null
  ultima_mensagem_em: string | null
}

/**
 * Patch a aplicar numa conversa já existente — null quando nada muda (evita
 * UPDATE inútil). ultima_mensagem_em SÓ AVANÇA: evento atrasado ou backfill
 * nunca envelhece a conversa. titulo nunca é apagado por um evento sem título.
 */
export function patchDeConversa(
  existente: ConversaExistente,
  desejada: ConversaDesejada,
  agoraIso: string = new Date().toISOString(),
): Record<string, string> | null {
  const patch: Record<string, string> = {}
  const atualMs = existente.ultima_mensagem_em ? Date.parse(existente.ultima_mensagem_em) : 0
  const novaMs = Date.parse(desejada.ultimaMensagemEm)
  if (!Number.isNaN(novaMs) && (Number.isNaN(atualMs) || novaMs > atualMs)) {
    patch.ultima_mensagem_em = desejada.ultimaMensagemEm
  }
  if (desejada.titulo && desejada.titulo !== existente.titulo) {
    patch.titulo = desejada.titulo
  }
  // Correção de classificação (conversa criada como individual e depois
  // identificada como grupo, ou vice-versa).
  if (desejada.tipo !== existente.tipo) {
    patch.tipo = desejada.tipo
  }
  if (Object.keys(patch).length === 0) return null
  patch.atualizado_em = agoraIso
  return patch
}

export interface LinhaMensagem {
  tenant_id: string
  conversa_id: string
  mensagem_id: string
  instancia: string
  de_mim: boolean
  origem: 'sistema' | 'atendente' | null
  autor_jid: string | null
  push_name: string | null
  tipo: string
  texto: string | null
  media_storage_path: string | null
  media_filename: string | null
  media_mimetype: string | null
  media_tamanho: number | null
  media_pendente_motivo: string | null
  timestamp_msg: string
}

/**
 * Evento → linha de conversa_mensagens. Regras de mídia:
 *  • `{ pendente: true, motivo }` → só o motivo (a mensagem fica registrada).
 *  • storagePath fora do prefixo do tenant → 'path_invalido' (não confiamos em
 *    path vindo de fora; ver pathMediaAcervoValido).
 *  • tamanho acima do teto do contrato → 'excede_teto' (protege também a coluna
 *    INT de um número absurdo).
 */
export function linhaMensagem(
  evento: EventoConversa,
  contexto: { tenantId: string; conversaId: string },
  agora: number = Date.now(),
): LinhaMensagem {
  let storagePath: string | null = null
  let filename: string | null = null
  let mimetype: string | null = null
  let tamanho: number | null = null
  let pendenteMotivo: string | null = null

  const media = evento.media
  if (media) {
    if ('pendente' in media) {
      pendenteMotivo = media.motivo.slice(0, 120)
    } else if (!pathMediaAcervoValido(media.storagePath, contexto.tenantId)) {
      pendenteMotivo = 'path_invalido'
    } else if (media.tamanho > LIMITE_MEDIA_BYTES) {
      pendenteMotivo = 'excede_teto'
    } else {
      storagePath = media.storagePath
      filename = media.filename.slice(0, 300)
      mimetype = media.mimetype ? media.mimetype.slice(0, 200) : null
      tamanho = media.tamanho
    }
  }

  return {
    tenant_id: contexto.tenantId,
    conversa_id: contexto.conversaId,
    mensagem_id: evento.mensagemId,
    instancia: evento.instancia,
    de_mim: evento.deMim,
    origem: origemDoEvento(evento),
    autor_jid: evento.autorJid?.trim() || null,
    push_name: evento.pushName?.trim().slice(0, 300) || null,
    tipo: evento.tipo,
    texto: normalizarTexto(evento.texto),
    media_storage_path: storagePath,
    media_filename: filename,
    media_mimetype: mimetype,
    media_tamanho: tamanho,
    media_pendente_motivo: pendenteMotivo,
    timestamp_msg: timestampParaIso(evento.timestamp, agora),
  }
}
