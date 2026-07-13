// Detecção de conversas TRANSFERIDAS PELO ASSISTENTE (bot → humano).
// O ai-attendant aplica a etiqueta "atendimento-humano" no Chatwoot e posta uma
// nota de triagem quando entrega o atendimento a uma pessoa; o relay repassa
// essa etiqueta no array `labels` de cada conversa. Módulo PURO e client-safe.

// Etiquetas que marcam um handoff do bot. Reconhecemos DUAS: "atendimento-humano"
// (nome atual) e "andamento-processo" (nome antigo/enganoso que o bot usava por
// default antes da correção — algumas conversas em produção ainda têm ela). O
// caminho de aviso de processo NUNCA aplica etiqueta, então "andamento-processo"
// só aparece em handoff — reconhecê-la é seguro. NEXT_PUBLIC_ para valer também
// no bundle do cliente; sobrescreva com lista separada por vírgula se preciso.
export const HANDOFF_LABELS: string[] = (
  process.env.NEXT_PUBLIC_HANDOFF_LABELS || 'atendimento-humano,andamento-processo'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** Etiqueta canônica (a que o bot aplica hoje) — usada em textos/documentação. */
export const HANDOFF_LABEL = HANDOFF_LABELS[0] ?? 'atendimento-humano'

/**
 * Conversa que o bot transferiu para atendimento humano E que AINDA está ativa.
 * Resolvida (status 'resolved') não conta — o atendimento já terminou.
 */
export function transferidaPeloBot(c: { labels?: string[]; status?: string }): boolean {
  return (
    c.status !== 'resolved' &&
    Array.isArray(c.labels) &&
    c.labels.some((l) => HANDOFF_LABELS.includes(l))
  )
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
