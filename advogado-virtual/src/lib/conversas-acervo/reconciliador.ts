import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { relayPostForm } from '@/lib/conversas/relay'
import { inboxDaInstancia, telefoneDoJid } from './medidor'
import { pathMediaAcervoValido } from './normalizar'
import {
  confirmarConversa,
  marcadorDaMensagem,
  RELAY_EMAIL_RECONCILIACAO,
  TETO_PENDENTES,
  type ConversaAcervo,
  type MensagemNossa,
} from './confirmador'

/**
 * RECONCILIADOR — Etapa 1 do plano Conversas Próprias
 * (docs/PLANO-CONVERSAS-PROPRIAS-OPUS.md §Etapa 1): "enquanto o Chatwoot
 * existir, nada mais se perde nele".
 *
 * Fluxo por conversa: (1) o confirmador diz o que JÁ chegou ao Chatwoot;
 * (2) o que sobrou pendente há mais de RECONCILIA_APOS_MIN minutos é REPOSTO no
 * Chatwoot pelo relay (POST {RELAY_URL}/reconciliar/mensagem), na ordem
 * cronológica da conversa, com o marcador 'simas-rec:<mensagemId>' que torna a
 * re-execução idempotente do outro lado.
 *
 * A ponte nativa da Evolution CONTINUA ligada — só cobrimos buraco.
 *
 * INVARIANTES (best-effort de verdade):
 *  • NUNCA quebra a ingestão nem o cron: try/catch total, deadline próprio,
 *    resultado sempre em contadores.
 *  • Só posta quando o confirmador CONSEGUIU olhar o Chatwoot (ou provou que
 *    não há conversa correspondente). Relay fora do ar = não posta nada —
 *    duplicar mensagem para o cliente é pior do que atrasar a reposição.
 *  • CLAIM atômico por mensagem (2 UPDATEs condicionais, sem .or() com
 *    timestamp — padrão da casa): duas execuções simultâneas nunca postam a
 *    mesma linha; claim com mais de CLAIM_EXPIRA_MS é retomado (kill de função).
 *  • Dead-letter passivo por tentativas; 'grupo_sem_conversa' tem teto próprio
 *    (depende de alguém abrir a conversa do grupo do outro lado).
 *  • LGPD: log só com ids internos, códigos e contagens.
 *
 * LIGA/DESLIGA (rollback em segundos, como o plano exige):
 *   RECONCILIA_CONVERSAS = '1'|'on'|'true'|'completo' → confirma E posta
 *                          'confirmar'                → só confirma (mede, não escreve)
 *                          ausente/'0'/'off'          → nada (default)
 * Default DESLIGADO de propósito: postar no Chatwoot faz a ponte ENTREGAR a
 * mensagem; a chave só é virada depois do relay expor /reconciliar/mensagem e do
 * go do dono.
 */

/* ── Parâmetros ───────────────────────────────────────────────────────────── */

/** Teto de tentativas de postagem (dead-letter passivo). */
export const MAX_TENTATIVAS = 5
/**
 * Teto próprio de 'grupo_sem_conversa': v1 não CRIA grupo no Chatwoot — depende
 * de a conversa passar a existir do outro lado. Insistir 5 vezes aposentaria a
 * mensagem cedo demais; 20 dá dias de janela sem virar loop eterno.
 */
export const TETO_GRUPO_SEM_CONVERSA = 20
/** Tentativas de uma linha aposentada (sai da fila sem virar dead-letter real). */
export const TENTATIVAS_APOSENTADA = 99
/** Claim expira em 10 min: retomada após kill da função no meio da postagem. */
export const CLAIM_EXPIRA_MS = 10 * 60_000
/** Folga exigida antes de INICIAR uma postagem (download + upload ao relay). */
const FOLGA_POST_MS = 12_000
/** Anexo maior que isto não é repassado (memória/tempo da função): vira nota. */
export const LIMITE_POST_BYTES = 16 * 1024 * 1024
/** Teto do texto enviado ao Chatwoot (o acervo guarda o texto inteiro). */
export const LIMITE_TEXTO_POST = 4000
/** Nota que substitui o anexo quando o binário não existe/não cabe. */
export const NOTA_ANEXO_PERDIDO = '[anexo não recuperável]'
/** Conversas por rodada de varredura. */
export const TETO_CONVERSAS_VARREDURA = 30

/* ── Puras: configuração ──────────────────────────────────────────────────── */

export type ModoReconciliacao = 'off' | 'confirmar' | 'completo'

/** Modo de operação lido do ambiente (ver cabeçalho). Default: 'off'. */
export function modoReconciliacao(env: Record<string, string | undefined> = process.env): ModoReconciliacao {
  const v = (env.RECONCILIA_CONVERSAS ?? '').trim().toLowerCase()
  if (v === '1' || v === 'on' || v === 'true' || v === 'completo') return 'completo'
  if (v === 'confirmar' || v === 'medir') return 'confirmar'
  return 'off'
}

/**
 * Idade mínima para repor uma mensagem (RECONCILIA_APOS_MIN, minutos).
 * É a janela que a ponte nativa tem para entregar sozinha — o que evita corrida
 * com ela. Default 10 min; valor inválido cai no default (nunca 0, que postaria
 * em cima da ponte).
 */
export function idadeMinimaMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.RECONCILIA_APOS_MIN)
  if (!Number.isFinite(n) || n < 1) return 10 * 60_000
  return Math.round(n) * 60_000
}

/**
 * Janela máxima de reposição (RECONCILIA_JANELA_HORAS, default 48h). Trava de
 * segurança: ligar a chave NÃO pode despejar o acervo inteiro no Chatwoot —
 * mensagem mais velha que a janela fica só no acervo (a Etapa 4 faz backfill).
 */
export function janelaMaximaMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.RECONCILIA_JANELA_HORAS)
  if (!Number.isFinite(n) || n < 1) return 48 * 3_600_000
  return Math.round(n) * 3_600_000
}

/* ── Tipos ────────────────────────────────────────────────────────────────── */

/** Pendente com o que a POSTAGEM precisa (superset do que o casamento usa). */
export interface MensagemPendente extends MensagemNossa {
  mediaStoragePath: string | null
  mediaFilename: string | null
  mediaMimetype: string | null
  mediaPendenteMotivo: string | null
  recTentativas: number
  recDetalhe: string | null
}

export interface ReconciliacaoResultado {
  confirmadas: number
  postadas: number
  /** Pendentes que continuam sem correspondente no Chatwoot ao fim da rodada. */
  aguardando: number
  /** Erros REAIS (rede/5xx/banco) — casos esperados do contrato não contam. */
  falhas: number
}

export interface VarreduraResultado extends ReconciliacaoResultado {
  conversas: number
}

function zerado(): ReconciliacaoResultado {
  return { confirmadas: 0, postadas: 0, aguardando: 0, falhas: 0 }
}

function somar(a: ReconciliacaoResultado, b: ReconciliacaoResultado): void {
  a.confirmadas += b.confirmadas
  a.postadas += b.postadas
  a.aguardando += b.aguardando
  a.falhas += b.falhas
}

/* ── Puras: elegibilidade e ordem ─────────────────────────────────────────── */

/** Teto de tentativas conforme o último desfecho (grupo tem teto próprio). */
export function tetoTentativas(detalhe: string | null): number {
  return detalhe === 'grupo_sem_conversa' ? TETO_GRUPO_SEM_CONVERSA : MAX_TENTATIVAS
}

/** Há o que postar? (mensagem sem texto e sem mídia não vira mensagem no Chatwoot.) */
export function temConteudoPostavel(m: Pick<MensagemPendente, 'texto' | 'temMedia'>): boolean {
  return !!m.texto?.trim() || m.temMedia
}

export interface CriteriosElegibilidade {
  agoraMs: number
  idadeMinMs: number
  janelaMs: number
  /**
   * Piso de cobertura do índice do Chatwoot (confirmador.coberturaDoIndice):
   * abaixo dele "não achei a conversa" NÃO prova "não existe". Default 0
   * (cobertura total — conversa encontrada, grupo ou Chatwoot vazio).
   */
  coberturaMs?: number
}

/**
 * Esta pendente pode ser reposta AGORA? Idade suficiente (deu tempo de a ponte
 * nativa entregar), dentro da janela de segurança, abaixo do teto de tentativas
 * e com conteúdo postável. Mensagem com timestamp no futuro (relógio do
 * aparelho adiantado) tem idade negativa → não é elegível, e volta a ser quando
 * o tempo passar.
 */
export function elegivelParaPostar(m: MensagemPendente, c: CriteriosElegibilidade): boolean {
  const idade = c.agoraMs - m.timestampMs
  if (idade < c.idadeMinMs) return false
  if (idade > c.janelaMs) return false
  // Fora da cobertura do índice: não sabemos se a conversa existe no Chatwoot —
  // e postar sem saber duplica mensagem para o cliente.
  if (m.timestampMs < (c.coberturaMs ?? 0)) return false
  if (m.recTentativas >= tetoTentativas(m.recDetalhe)) return false
  return temConteudoPostavel(m)
}

/**
 * Ordem de postagem DENTRO da conversa: cronológica (thread coerente no
 * Chatwoot). Empate de timestamp resolvido pelo id — determinismo entre
 * execuções, para o retry repetir a mesma ordem.
 */
export function ordenarParaPostagem<T extends { timestampMs: number; id: string }>(msgs: T[]): T[] {
  return [...msgs].sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id))
}

/** Instância da Evolution → inbox do CONTRATO da reconciliação ('df'|'sc'). */
export function inboxContrato(instancia: string): 'df' | 'sc' | null {
  const inbox = inboxDaInstancia(instancia)
  return inbox ? (inbox.toLowerCase() as 'df' | 'sc') : null
}

/* ── Puras: payload do contrato ───────────────────────────────────────────── */

/**
 * CONTRATO relay↔SIMAS (fonte de verdade das duas pontas) —
 * POST {RELAY_URL}/reconciliar/mensagem, autenticação de SERVIÇO já existente
 * (Bearer RELAY_TOKEN + X-Simas-User-Email). JSON, ou multipart com o JSON no
 * campo 'payload' e os bytes no campo 'arquivo' quando há anexo.
 */
export const payloadReconciliacaoSchema = z
  .object({
    /** Só dígitos — conversa INDIVIDUAL (o relay acha/cria contato+conversa). */
    telefone: z.string().regex(/^\d{10,15}$/).optional(),
    /** GRUPO: o relay só ACHA conversa existente (v1 não cria grupo). */
    grupoJid: z.string().min(1).max(300).optional(),
    inbox: z.enum(['df', 'sc']),
    direcao: z.enum(['incoming', 'outgoing']),
    texto: z.string().min(1).max(LIMITE_TEXTO_POST).optional(),
    anexo: z
      .object({ filename: z.string().min(1).max(300), mimetype: z.string().min(1).max(200) })
      .optional(),
    /** Epoch ms da mensagem ORIGINAL no WhatsApp. */
    timestampOriginal: z.number().int().positive(),
    /** 'simas-rec:<mensagemIdEvolution>' — dedupe idempotente no relay. */
    marcador: z.string().min(1).max(400),
  })
  .refine((d) => !!d.telefone || !!d.grupoJid, { message: 'telefone ou grupoJid' })
  .refine((d) => !!d.texto || !!d.anexo, { message: 'texto ou anexo' })

export type PayloadReconciliacao = z.infer<typeof payloadReconciliacaoSchema>

/** Corta o texto para o teto do contrato preservando o começo (o que identifica). */
export function textoParaPost(texto: string | null, nota?: string): string | undefined {
  const base = (texto ?? '').trim()
  const juntos = nota ? (base ? `${base}\n${nota}` : nota) : base
  if (!juntos) return undefined
  return juntos.length > LIMITE_TEXTO_POST ? juntos.slice(0, LIMITE_TEXTO_POST) : juntos
}

export type MontagemPayload =
  | { ok: true; payload: PayloadReconciliacao; anexoStoragePath: string | null }
  | { ok: false; motivo: string }

/**
 * Mensagem do acervo → corpo do contrato. PURA: nada de I/O — quem baixa os
 * bytes é o chamador (o payload só diz o nome/tipo do anexo).
 * Mídia sem binário utilizável (pendente, path inválido, grande demais) vira
 * TEXTO com a nota NOTA_ANEXO_PERDIDO: a existência da mensagem chega ao
 * Chatwoot mesmo quando o arquivo não chega.
 */
export function montarPayload(
  conversa: Pick<ConversaAcervo, 'tenant_id' | 'instancia' | 'jid' | 'tipo'>,
  m: MensagemPendente,
): MontagemPayload {
  const inbox = inboxContrato(conversa.instancia)
  if (!inbox) return { ok: false, motivo: 'instancia_desconhecida' }

  const ehGrupo = conversa.tipo === 'grupo' || conversa.jid.toLowerCase().endsWith('@g.us')
  const telefone = ehGrupo ? null : telefoneDoJid(conversa.jid)
  if (!ehGrupo && !telefone) return { ok: false, motivo: 'jid_sem_telefone' }

  const anexoUsavel =
    !!m.mediaStoragePath &&
    !m.mediaPendenteMotivo &&
    pathMediaAcervoValido(m.mediaStoragePath, conversa.tenant_id) &&
    (m.mediaTamanho ?? 0) <= LIMITE_POST_BYTES

  const texto = textoParaPost(m.texto, m.temMedia && !anexoUsavel ? NOTA_ANEXO_PERDIDO : undefined)

  const bruto = {
    ...(ehGrupo ? { grupoJid: conversa.jid } : { telefone: telefone! }),
    inbox,
    direcao: (m.deMim ? 'outgoing' : 'incoming') as 'incoming' | 'outgoing',
    ...(texto ? { texto } : {}),
    ...(anexoUsavel
      ? {
          anexo: {
            filename: (m.mediaFilename ?? 'arquivo').slice(0, 300),
            mimetype: (m.mediaMimetype ?? 'application/octet-stream').slice(0, 200),
          },
        }
      : {}),
    timestampOriginal: m.timestampMs,
    marcador: marcadorDaMensagem(m.mensagemId),
  }

  const parsed = payloadReconciliacaoSchema.safeParse(bruto)
  if (!parsed.success) return { ok: false, motivo: 'payload_invalido' }
  return {
    ok: true,
    payload: parsed.data,
    anexoStoragePath: anexoUsavel ? m.mediaStoragePath : null,
  }
}

/* ── Puras: leitura da resposta ───────────────────────────────────────────── */

export type DesfechoPost =
  | { tipo: 'postada'; chatwootMsgId: string | null }
  /** Caso ESPERADO do contrato (200 + ok:false): registra e tenta de novo depois. */
  | { tipo: 'esperado'; motivo: string }
  /**
   * NÃO FALAMOS com o relay (fora do ar / env ausente). NÃO conta tentativa: o
   * gatilho quente roda a cada lote de eventos, e contar aqui aposentaria
   * mensagens boas em minutos por causa de uma indisponibilidade de rede.
   */
  | { tipo: 'indisponivel'; detalhe: string }
  /** Erro real: conta tentativa e, no teto, vira dead-letter. */
  | { tipo: 'falha'; detalhe: string }

/** Código curto e seguro para a coluna rec_detalhe (LGPD: nunca texto livre). */
export function codigoDetalhe(valor: unknown, padrao: string): string {
  const s = String(valor ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 40)
  return s || padrao
}

/**
 * Resposta do relay → desfecho. O contrato separa "não deu, e isso é esperado"
 * (200 ok:false, ex.: grupo_sem_conversa) de "erro real" (5xx) — só o segundo é
 * falha. 4xx é BUG NOSSO de payload: conta tentativa (o teto o aposenta) para
 * não virar loop contra o relay.
 *
 * Os códigos que o PRÓPRIO cliente do relay sintetiza quando não houve conversa
 * nenhuma com o outro lado (RELAY_INDISPONIVEL / RELAY_NAO_CONFIGURADO) são
 * 'indisponivel', não falha desta mensagem — ver DesfechoPost.
 */
export function interpretarResposta(status: number, data: unknown): DesfechoPost {
  const d = (data ?? {}) as { ok?: unknown; motivo?: unknown; chatwootMsgId?: unknown; code?: unknown }
  if (status >= 200 && status < 300) {
    if (d.ok === true) {
      const id = d.chatwootMsgId
      return {
        tipo: 'postada',
        chatwootMsgId: id == null ? null : String(id).slice(0, 100),
      }
    }
    if (d.ok === false) return { tipo: 'esperado', motivo: codigoDetalhe(d.motivo, 'recusado') }
    return { tipo: 'falha', detalhe: 'resposta_invalida' }
  }
  const code = typeof d.code === 'string' ? d.code : ''
  if (code === 'RELAY_INDISPONIVEL' || code === 'RELAY_NAO_CONFIGURADO') {
    return { tipo: 'indisponivel', detalhe: codigoDetalhe(code, 'relay_fora') }
  }
  // 429 é "agora não" (teto por minuto da rota no relay), não payload errado:
  // recua sem gastar tentativa.
  if (status === 429) return { tipo: 'indisponivel', detalhe: 'rate_limited' }
  if (status >= 400 && status < 500) return { tipo: 'falha', detalhe: `payload_${status}` }
  return { tipo: 'falha', detalhe: `http_${status}` }
}

/* ── I/O ──────────────────────────────────────────────────────────────────── */

interface LinhaPendente {
  id: string
  mensagem_id: string
  de_mim: boolean | null
  tipo: string | null
  texto: string | null
  media_storage_path: string | null
  media_filename: string | null
  media_mimetype: string | null
  media_tamanho: number | null
  media_pendente_motivo: string | null
  timestamp_msg: string
  rec_tentativas: number | null
  rec_detalhe: string | null
}

const COLUNAS_PENDENTE =
  'id, mensagem_id, de_mim, tipo, texto, media_storage_path, media_filename, media_mimetype, media_tamanho, media_pendente_motivo, timestamp_msg, rec_tentativas, rec_detalhe'

/** Linha crua → MensagemPendente (defensivo com o banco). PURA. */
export function pendenteDaLinha(l: LinhaPendente): MensagemPendente {
  const ts = Date.parse(l.timestamp_msg)
  return {
    id: l.id,
    mensagemId: l.mensagem_id,
    deMim: l.de_mim === true,
    tipo: l.tipo ?? 'outro',
    texto: l.texto,
    timestampMs: Number.isNaN(ts) ? 0 : ts,
    mediaTamanho: l.media_tamanho ?? null,
    temMedia: !!l.media_storage_path || !!l.media_pendente_motivo,
    mediaStoragePath: l.media_storage_path,
    mediaFilename: l.media_filename,
    mediaMimetype: l.media_mimetype,
    mediaPendenteMotivo: l.media_pendente_motivo,
    recTentativas: l.rec_tentativas ?? 0,
    recDetalhe: l.rec_detalhe,
  }
}

/**
 * Pendentes da conversa DENTRO da janela de reposição, mais antigas primeiro
 * (a ordem em que serão postadas).
 *
 * O corte por `desdeIso` não é economia — é o que impede a FILA DE MORRER. Sem
 * ele, uma conversa acumula pendências que já nunca serão repostas (mais velhas
 * que a janela, ou aposentadas pelo teto de tentativas: exatamente o caso do
 * GRUPO, que depende de alguém abrir a thread do outro lado); passadas as 100
 * primeiras, o LIMIT só devolveria esse resíduo e as mensagens NOVAS jamais
 * seriam vistas — a conversa ficaria em silêncio para sempre, e logo a que mais
 * precisa da Etapa 1.
 * Preço: pendência fora da janela também não é mais CONFIRMADA e fica no índice
 * parcial da 083 (o backfill da Etapa 4 é quem fecha essa conta).
 */
async function lerPendentesRicas(
  admin: SupabaseClient,
  conversa: ConversaAcervo,
  desdeIso: string,
): Promise<MensagemPendente[]> {
  const { data, error } = await admin
    .from('conversa_mensagens')
    .select(COLUNAS_PENDENTE)
    .eq('conversa_id', conversa.id)
    .eq('tenant_id', conversa.tenant_id)
    .is('chatwoot_confirmada_em', null)
    .is('chatwoot_postada_em', null)
    .gte('timestamp_msg', desdeIso)
    .order('timestamp_msg', { ascending: true })
    .limit(TETO_PENDENTES)
  if (error) {
    logger.error('conversas_acervo.reconciliador.pendentes', { conversaId: conversa.id }, error)
    return []
  }
  return (data ?? []).map((l) => pendenteDaLinha(l as unknown as LinhaPendente))
}

/** Bytes da mídia no NOSSO Storage. null = não recuperável agora. */
async function baixarMedia(admin: SupabaseClient, path: string): Promise<Buffer | null> {
  try {
    const { data, error } = await admin.storage.from('documentos').download(path)
    if (error || !data) return null
    return Buffer.from(await data.arrayBuffer())
  } catch {
    return null
  }
}

/** Grava o desfecho de uma tentativa e LIBERA o claim (nunca deixa linha presa). */
async function registrarTentativa(
  admin: SupabaseClient,
  mensagemId: string,
  tentativasAtuais: number,
  detalhe: string,
): Promise<void> {
  const { error } = await admin
    .from('conversa_mensagens')
    .update({ rec_claim_em: null, rec_tentativas: tentativasAtuais + 1, rec_detalhe: detalhe })
    .eq('id', mensagemId)
  if (error) logger.error('conversas_acervo.reconciliador.tentativa', { mensagemId }, error)
}

/**
 * Reconcilia UMA conversa: confirma o que chegou e repõe o que faltou.
 * NUNCA lança. Respeita o deadline (não INICIA etapa que não caiba nele).
 */
export async function reconciliarConversa(
  admin: SupabaseClient,
  conversaId: string,
  opts: { deadline: number; agora?: Date },
): Promise<ReconciliacaoResultado> {
  const r = zerado()
  const modo = modoReconciliacao()
  if (modo === 'off') return r
  try {
    const agoraMs = (opts.agora ?? new Date()).getTime()

    const { data: linha, error } = await admin
      .from('conversas_acervo')
      .select('id, tenant_id, instancia, jid, tipo')
      .eq('id', conversaId)
      .maybeSingle()
    if (error || !linha) {
      if (error) logger.error('conversas_acervo.reconciliador.conversa', { conversaId }, error)
      return r
    }
    const conversa = linha as unknown as ConversaAcervo

    const criterios: CriteriosElegibilidade = {
      agoraMs,
      idadeMinMs: idadeMinimaMs(),
      janelaMs: janelaMaximaMs(),
    }
    const pendentes = await lerPendentesRicas(
      admin,
      conversa,
      new Date(agoraMs - criterios.janelaMs).toISOString(),
    )
    if (pendentes.length === 0) return r

    // Nada com idade suficiente = nada a decidir: não gastamos relay à toa
    // (o gatilho da ingestão dispara a cada lote; sem esta guarda cada mensagem
    // nova viraria duas chamadas ao Chatwoot).
    const temAlgoMaduro = pendentes.some(
      (m) => agoraMs - m.timestampMs >= criterios.idadeMinMs && agoraMs - m.timestampMs <= criterios.janelaMs,
    )
    if (!temAlgoMaduro) {
      r.aguardando = pendentes.length
      return r
    }

    // 1) Confirmação (leitura do Chatwoot).
    const conf = await confirmarConversa(admin, conversa, {
      deadline: opts.deadline,
      agora: new Date(agoraMs),
      pendentes,
    })
    r.confirmadas = conf.confirmadas
    const confirmadas = new Set(conf.confirmadasIds)
    const restantes = pendentes.filter((m) => !confirmadas.has(m.id))
    r.aguardando = restantes.length

    if (modo !== 'completo') return r
    // SEGURANÇA: só posta quando sabemos o estado do Chatwoot. 'sem_correspondente'
    // é conhecimento legítimo (grupo, ou contato que nunca abriu conversa lá);
    // 'relay_erro'/'sem_tempo'/'erro' são ignorância — postar seria adivinhar.
    if (conf.motivo !== 'ok' && conf.motivo !== 'sem_correspondente') return r

    // 2) Reposição, em ordem cronológica (thread coerente). O piso de cobertura
    //    só existe quando a conversa NÃO foi achada no índice do Chatwoot.
    criterios.coberturaMs = conf.coberturaMs
    const elegiveis = ordenarParaPostagem(restantes.filter((m) => elegivelParaPostar(m, criterios)))
    for (const m of elegiveis) {
      if (Date.now() + FOLGA_POST_MS > opts.deadline) break

      // CLAIM atômico em DOIS passos (livre; senão, claim velho). O .or() com
      // timestamp falha no PostgREST — dois UPDATEs condicionais simples são
      // equivalentes e cada um é atômico; o perdedor recebe 0 linhas e pula.
      const agoraIso = new Date().toISOString()
      const staleAntes = new Date(Date.now() - CLAIM_EXPIRA_MS).toISOString()
      let { data: claim } = await admin
        .from('conversa_mensagens')
        .update({ rec_claim_em: agoraIso })
        .eq('id', m.id)
        .is('rec_claim_em', null)
        .is('chatwoot_postada_em', null)
        .select('id, rec_tentativas')
      if (!claim || claim.length === 0) {
        const { data: claimVelho } = await admin
          .from('conversa_mensagens')
          .update({ rec_claim_em: agoraIso })
          .eq('id', m.id)
          .lt('rec_claim_em', staleAntes)
          .is('chatwoot_postada_em', null)
          .select('id, rec_tentativas')
        claim = claimVelho
      }
      if (!claim || claim.length === 0) continue // outra execução pegou (ou já postou)
      const tentativas = (claim[0] as { rec_tentativas: number | null }).rec_tentativas ?? 0

      const montagem = montarPayload(conversa, m)
      if (!montagem.ok) {
        // Payload impossível (instância/jid): aposenta a linha — insistir não muda nada.
        await admin
          .from('conversa_mensagens')
          .update({
            rec_claim_em: null,
            rec_detalhe: montagem.motivo,
            rec_tentativas: TENTATIVAS_APOSENTADA,
          })
          .eq('id', m.id)
        continue
      }

      let arquivo: { campo: string; bytes: Buffer; filename: string; contentType: string } | undefined
      if (montagem.anexoStoragePath && montagem.payload.anexo) {
        const bytes = await baixarMedia(admin, montagem.anexoStoragePath)
        if (!bytes) {
          // Transitório (Storage fora) — tentativa contada, claim liberado.
          await registrarTentativa(admin, m.id, tentativas, 'midia_indisponivel')
          r.falhas++
          continue
        }
        arquivo = {
          campo: 'arquivo',
          bytes,
          filename: montagem.payload.anexo.filename,
          contentType: montagem.payload.anexo.mimetype,
        }
      }

      const { status, data } = await relayPostForm('/reconciliar/mensagem', {
        email: RELAY_EMAIL_RECONCILIACAO,
        campos: { payload: JSON.stringify(montagem.payload) },
        arquivo,
      })
      const desfecho = interpretarResposta(status, data)

      if (desfecho.tipo === 'postada') {
        const { error: erroMarca } = await admin
          .from('conversa_mensagens')
          .update({
            chatwoot_postada_em: new Date().toISOString(),
            chatwoot_msg_id: desfecho.chatwootMsgId,
            rec_claim_em: null,
            rec_detalhe: null,
          })
          .eq('id', m.id)
        if (erroMarca) {
          // Postou e não conseguiu marcar: o marcador confirma na próxima rodada
          // (não re-posta — a idempotência do relay devolve o id existente).
          logger.error('conversas_acervo.reconciliador.marcar', { mensagemId: m.id }, erroMarca)
          r.falhas++
        } else {
          r.postadas++
          r.aguardando = Math.max(0, r.aguardando - 1)
        }
        continue
      }

      if (desfecho.tipo === 'esperado') {
        await registrarTentativa(admin, m.id, tentativas, desfecho.motivo)
        continue // segue pendente: 'aguardando' já a contabiliza
      }

      if (desfecho.tipo === 'indisponivel') {
        // Nem chegamos a falar com o relay: libera o claim SEM contar tentativa
        // e encerra a rodada desta conversa (as próximas dariam o mesmo).
        const { error: erroLiberar } = await admin
          .from('conversa_mensagens')
          .update({ rec_claim_em: null, rec_detalhe: desfecho.detalhe })
          .eq('id', m.id)
        if (erroLiberar) {
          logger.error('conversas_acervo.reconciliador.liberar', { mensagemId: m.id }, erroLiberar)
        }
        r.falhas++
        break
      }

      await registrarTentativa(admin, m.id, tentativas, desfecho.detalhe)
      r.falhas++
      // 5xx é do SISTEMA do outro lado (relay/Chatwoot fora), não desta
      // mensagem: seguir para as próximas só queimaria a tentativa de todas.
      // 4xx (payload_*) é específico da linha — segue para a próxima.
      if (desfecho.detalhe.startsWith('http_5')) break
    }

    if (r.postadas > 0 || r.confirmadas > 0 || r.falhas > 0) {
      logger.info('conversas_acervo.reconciliador', { conversaId, ...r })
    }
    return r
  } catch (e) {
    logger.error('conversas_acervo.reconciliador.falha', { conversaId }, e)
    r.falhas++
    return r
  }
}

/**
 * Reconcilia as conversas de um LOTE (gatilho quente: after() da ingestão).
 * Divide o orçamento entre elas e nunca ultrapassa o deadline.
 */
export async function reconciliarConversas(
  admin: SupabaseClient,
  conversaIds: string[],
  opts: { deadline: number; agora?: Date },
): Promise<ReconciliacaoResultado> {
  const total = zerado()
  if (modoReconciliacao() === 'off') return total
  const unicos = [...new Set(conversaIds)]
  for (const id of unicos) {
    if (Date.now() + 2_000 > opts.deadline) break
    somar(total, await reconciliarConversa(admin, id, opts))
  }
  return total
}

/**
 * VARREDURA (folga do cron diário): pega as conversas com as pendências MAIS
 * ANTIGAS e reconcilia cada uma. Complementa o gatilho quente — que só cobre
 * conversa que recebeu mensagem nova; conversa que silenciou depois do buraco
 * é resgatada aqui.
 * NUNCA lança. Sem cron próprio (plano Hobby: 2 crons/dia).
 */
export async function reconciliarVarredura(
  admin: SupabaseClient,
  opts: { deadline: number; teto?: number; agora?: Date; tenantId?: string } = { deadline: 0 },
): Promise<VarreduraResultado> {
  const r: VarreduraResultado = { ...zerado(), conversas: 0 }
  const modo = modoReconciliacao()
  if (modo === 'off') return r
  try {
    const agoraMs = (opts.agora ?? new Date()).getTime()
    const teto = opts.teto ?? TETO_CONVERSAS_VARREDURA
    const maduraAte = new Date(agoraMs - idadeMinimaMs()).toISOString()
    const janelaDesde = new Date(agoraMs - janelaMaximaMs()).toISOString()

    // Candidatas pelo índice parcial (tenant_id, timestamp_msg) da 083: as
    // pendências mais antigas primeiro. Buscamos mensagens e reduzimos a
    // conversas distintas (o PostgREST não agrupa).
    let q = admin
      .from('conversa_mensagens')
      .select('conversa_id')
      .is('chatwoot_confirmada_em', null)
      .is('chatwoot_postada_em', null)
      .lt('rec_tentativas', TETO_GRUPO_SEM_CONVERSA)
      .gte('timestamp_msg', janelaDesde)
      .lte('timestamp_msg', maduraAte)
      .order('timestamp_msg', { ascending: true })
      .limit(teto * 10)
    if (opts.tenantId) q = q.eq('tenant_id', opts.tenantId)
    const { data, error } = await q
    if (error) {
      logger.error('conversas_acervo.reconciliador.varredura_candidatas', {}, error)
      return r
    }

    const ids: string[] = []
    const vistos = new Set<string>()
    for (const linha of data ?? []) {
      const id = (linha as { conversa_id: string }).conversa_id
      if (!id || vistos.has(id)) continue
      vistos.add(id)
      ids.push(id)
      if (ids.length >= teto) break
    }

    for (const id of ids) {
      if (Date.now() + 3_000 > opts.deadline) break
      r.conversas++
      // Teto por conversa: uma conversa gorda não come o orçamento das outras.
      somar(r, await reconciliarConversa(admin, id, {
        deadline: Math.min(opts.deadline, Date.now() + 15_000),
        agora: new Date(agoraMs),
      }))
    }

    logger.info('conversas_acervo.reconciliador.varredura', { ...r })
    return r
  } catch (e) {
    logger.error('conversas_acervo.reconciliador.varredura_falha', {}, e)
    r.falhas++
    return r
  }
}
