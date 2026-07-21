// Fase 5 (Lote 2) — envio do aviso de movimentação ao cliente por WhatsApp.
// SIMAS → ai-attendant (POST /notify, header X-Notify-Token) → Evolution. Passa
// pelo bot (não direto na Evolution) para registrar o id da mensagem e não
// disparar o handoff de "humano assumiu". Ver docs/PLANO-FASE-5-OPUS.md §6.

import { logger } from '@/lib/logger'
import type { Instancia } from '@/lib/conversas/instancia'

export interface AvisoInput {
  clienteNome: string | null
  resumo: string | null
  nomeTecnico: string
  rotuloProcesso: string | null // apelido ou nº formatado
  escritorioNome: string | null
}

/** Primeiro nome, capitalizado, para a saudação. */
function primeiroNome(nome: string | null): string {
  const p = (nome ?? '').trim().split(/\s+/)[0]
  if (!p) return ''
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
}

/** Monta o texto do aviso (curto, factual, sem juridiquês). Editável na fila. */
export function montarTextoAviso(a: AvisoInput): string {
  const nome = primeiroNome(a.clienteNome)
  const saud = nome ? `Olá, ${nome}!` : 'Olá!'
  const corpo = (a.resumo && a.resumo.trim()) || a.nomeTecnico
  const ref = a.rotuloProcesso ? ` referente ao seu processo (${a.rotuloProcesso})` : ' no seu processo'
  const assinatura = a.escritorioNome ? `— Equipe ${a.escritorioNome}` : '— Equipe do escritório'
  return [
    saud,
    ``,
    `Passando para avisar sobre uma atualização${ref}:`,
    ``,
    corpo,
    ``,
    `Se tiver qualquer dúvida, é só responder por aqui que a gente te ajuda. 🙂`,
    assinatura,
  ].join('\n')
}

/**
 * Envia o texto ao WhatsApp do cliente via ai-attendant. Best-effort com timeout
 * 5s e 1 retry. Retorna {ok:false} se as envs não estiverem configuradas ou o
 * envio falhar (o chamador marca o movimento como 'erro' para retry no próximo sync).
 * `instancia` (opcional) escolhe o número de saída (body.instance); ausente → o
 * VPS roteia pelo DDD do destino. Avisos AUTOMÁTICOS não passam instância.
 * `autor: 'atendente'` = mensagem ESCRITA POR HUMANO (modal "Mensagem ao
 * cliente"): o ai-attendant PAUSA a IA daquela conversa (caso real: bot
 * conversando por cima da atendente). Avisos automáticos NUNCA passam autor.
 */
export async function enviarAvisoWhatsApp(
  telefone: string,
  texto: string,
  instancia?: Instancia | null,
  autor?: 'atendente' | null,
): Promise<{ ok: boolean; id?: string }> {
  const url = process.env.PROCESSOS_NOTIFY_URL
  const token = process.env.PROCESSOS_NOTIFY_TOKEN
  if (!url || !token) {
    logger.error('processos.notificar.sem_config', { temUrl: !!url, temToken: !!token })
    return { ok: false }
  }

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Notify-Token': token },
        body: JSON.stringify({ telefone, texto, ...(instancia ? { instance: instancia } : {}), ...(autor ? { autor } : {}) }),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (r.ok) {
        const d = (await r.json().catch(() => ({}))) as { id?: string }
        return { ok: true, id: d.id }
      }
      logger.error('processos.notificar.http', { status: r.status, tentativa })
    } catch (err) {
      clearTimeout(timer)
      logger.error('processos.notificar.excecao', { tentativa }, err as Error)
      // Invariante do dono: aviso nunca 2x. O timeout de 5s (AbortError) é
      // exatamente a janela "talvez já entregou" — o ai-attendant pode ter
      // recebido e mandado à Evolution, mas a resposta HTTP demorou. Nesse caso
      // NÃO retransmitimos (a marcação atômica pendente→aprovada nos chamadores já
      // garante at-most-once da DECISÃO; aqui protegemos a ENTREGA). Só re-tenta em
      // erro de conexão claro pré-envio (rede/DNS), onde nada saiu.
      if (err instanceof Error && err.name === 'AbortError') break
    }
  }
  return { ok: false }
}

/**
 * Envia um DOCUMENTO/IMAGEM por WhatsApp pelo mesmo canal do bot (/notify com
 * `media`) — funciona para QUALQUER número, mesmo sem conversa aberta no
 * Chatwoot (caso "cliente novo": mandar procuração no primeiro contato).
 * caption vira a legenda. SEM retry (mídia duplicada no WhatsApp é pior que
 * pedir pro atendente reenviar); timeout maior (arquivo + base64).
 */
export async function enviarMediaWhatsApp(
  telefone: string,
  media: { base64: string; filename: string; mimetype: string },
  caption?: string,
  instancia?: Instancia | null,
  autor?: 'atendente' | null,
): Promise<{ ok: boolean; id?: string }> {
  const url = process.env.PROCESSOS_NOTIFY_URL
  const token = process.env.PROCESSOS_NOTIFY_TOKEN
  if (!url || !token) {
    logger.error('processos.notificar.sem_config', { temUrl: !!url, temToken: !!token })
    return { ok: false }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Notify-Token': token },
      body: JSON.stringify({ telefone, texto: caption ?? '', media, ...(instancia ? { instance: instancia } : {}), ...(autor ? { autor } : {}) }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (r.ok) {
      const d = (await r.json().catch(() => ({}))) as { id?: string }
      return { ok: true, id: d.id }
    }
    logger.error('processos.notificar.media_http', { status: r.status })
  } catch (err) {
    clearTimeout(timer)
    logger.error('processos.notificar.media_excecao', {}, err as Error)
  }
  return { ok: false }
}
