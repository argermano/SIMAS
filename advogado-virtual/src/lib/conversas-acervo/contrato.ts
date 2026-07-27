import { z } from 'zod'

/**
 * CONTRATO do encaminhador (ai-attendant no VPS) → SIMAS, Etapa 0 do plano
 * Conversas Próprias (docs/PLANO-CONVERSAS-PROPRIAS-OPUS.md).
 *
 * Fonte da verdade para as DUAS pontas. Mudou aqui, mudou lá — e vice-versa.
 * A regra de ouro é ser PERMISSIVO com o que não muda o significado (campo
 * desconhecido, timestamp em segundos, texto gigante) e ESTRITO com o que
 * define identidade (instância, id da mensagem, jid): um 400 faz o VPS jogar
 * fora o lote; só vale a pena quando a linha seria lixo de qualquer jeito.
 */

/** Instâncias da Evolution (uma por unidade: SC e DF). */
export const INSTANCIAS = ['whatsapp-sc', 'whatsapp-df'] as const
export type InstanciaAcervo = (typeof INSTANCIAS)[number]

/** Tipos de mensagem que o encaminhador classifica. */
export const TIPOS_MENSAGEM = [
  'texto', 'imagem', 'video', 'audio', 'documento', 'sticker', 'outro',
] as const
export type TipoMensagemAcervo = (typeof TIPOS_MENSAGEM)[number]

/** Máximo de eventos por lote (o VPS quebra o buffer em pedaços deste tamanho). */
export const LOTE_MAX_EVENTOS = 50

/**
 * Teto por arquivo de mídia do acervo. MESMO teto dos anexos de saída
 * (LIMITE_UPLOAD_BYTES): o binário sobe DIRETO ao Storage por URL assinada,
 * nunca pelo corpo da função Vercel (~4,5 MB). Acima disso o encaminhador manda
 * o evento com `media: { pendente: true, motivo: 'excede_teto' }` — a mensagem
 * fica registrada mesmo sem o binário.
 */
export const LIMITE_MEDIA_BYTES = 40 * 1024 * 1024

/** Corte defensivo do texto guardado (WhatsApp já limita bem abaixo disso). */
export const LIMITE_TEXTO_CHARS = 65_536

/** Mídia guardada no nosso Storage (o VPS já subiu o binário). */
const mediaOkSchema = z.object({
  storagePath: z.string().min(1).max(1024),
  filename: z.string().min(1).max(300),
  mimetype: z.string().max(200),
  tamanho: z.number().int().nonnegative(),
})

/** Mídia que existe na conversa mas NÃO pôde ser guardada (registra a existência). */
const mediaPendenteSchema = z.object({
  pendente: z.literal(true),
  /** Código curto (ex.: 'download_falhou', 'excede_teto'). Não é texto livre do cliente. */
  motivo: z.string().min(1).max(120),
})

export const mediaEventoSchema = z.union([mediaOkSchema, mediaPendenteSchema])

export const eventoSchema = z.object({
  instancia: z.enum(INSTANCIAS),
  /** key.id da Evolution — dedupe global por (instancia, mensagemId). */
  mensagemId: z.string().min(1).max(300),
  /** remoteJid: '<numero>@s.whatsapp.net' ou '<id>@g.us'. */
  conversaJid: z.string().min(1).max(300),
  tipoConversa: z.enum(['individual', 'grupo']),
  /** subject do grupo, quando o payload traz. */
  tituloGrupo: z.string().max(300).optional(),
  /** key.fromMe. */
  deMim: z.boolean(),
  /** Só faz sentido quando deMim: id ∈ botIds → 'sistema', senão 'atendente'. */
  origemProvavel: z.enum(['sistema', 'atendente']).optional(),
  /** participant (quem falou) em grupos. */
  autorJid: z.string().max(300).optional(),
  pushName: z.string().max(300).optional(),
  /** Epoch em MILISSEGUNDOS (segundos são tolerados na normalização). */
  timestamp: z.number().int().positive(),
  tipo: z.enum(TIPOS_MENSAGEM),
  /** Texto da mensagem ou caption da mídia (truncado na normalização). */
  texto: z.string().optional(),
  media: mediaEventoSchema.optional(),
})

export type EventoConversa = z.infer<typeof eventoSchema>
export type MediaEvento = z.infer<typeof mediaEventoSchema>

/** Corpo de POST /api/integracao/conversas/eventos. */
export const loteEventosSchema = z.object({
  eventos: z.array(eventoSchema).min(1).max(LOTE_MAX_EVENTOS),
})

/**
 * Corpo de POST /api/integracao/conversas/preparar-media.
 * `conversaJid` é OPCIONAL por compatibilidade com o contrato mínimo (o VPS
 * pode ainda não tê-lo no momento do preparar): sem ele o objeto vai para o
 * segmento 'sem-jid' do prefixo da instância. Com ele, o path fica organizado
 * por conversa — que é como a Etapa 2 vai varrer o acervo.
 */
export const prepararMediaSchema = z.object({
  instancia: z.enum(INSTANCIAS),
  mensagemId: z.string().min(1).max(300),
  conversaJid: z.string().max(300).optional(),
  filename: z.string().min(1).max(300),
  mimetype: z.string().max(200),
  tamanho: z.number().int().positive(),
})

export type PrepararMediaEntrada = z.infer<typeof prepararMediaSchema>
