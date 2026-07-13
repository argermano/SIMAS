// Detecção de conversas TRANSFERIDAS PELO ASSISTENTE (bot → humano).
// O ai-attendant aplica a etiqueta "atendimento-humano" no Chatwoot e posta uma
// nota de triagem quando entrega o atendimento a uma pessoa; o relay repassa
// essa etiqueta no array `labels` de cada conversa. Módulo PURO e client-safe.

// NEXT_PUBLIC_ para valer também no bundle do cliente (lista/notificador). É a
// MESMA etiqueta que o bot aplica — só mude o env se mudar do lado do bot.
export const HANDOFF_LABEL = process.env.NEXT_PUBLIC_HANDOFF_LABEL || 'atendimento-humano'

/**
 * Conversa que o bot transferiu para atendimento humano E que AINDA está ativa.
 * Resolvida (status 'resolved') não conta — o atendimento já terminou.
 */
export function transferidaPeloBot(c: { labels?: string[]; status?: string }): boolean {
  return c.status !== 'resolved' && Array.isArray(c.labels) && c.labels.includes(HANDOFF_LABEL)
}

/**
 * Transferida pelo bot e ainda SEM ninguém atribuído — o sinal mais acionável
 * ("o bot largou isto e ninguém pegou"). Usado para o destaque de maior prioridade.
 */
export function transferidaPendente(c: {
  labels?: string[]
  status?: string
  assignee?: unknown
}): boolean {
  return transferidaPeloBot(c) && !c.assignee
}
