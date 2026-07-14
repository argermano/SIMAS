// Mapeia status + code do relay (repassados fielmente pelos proxies) para uma
// mensagem curta em pt-BR para a UI de Conversas. Puro (sem side effects).

export function codeDoErro(data: unknown): string | null {
  if (data && typeof data === 'object' && 'code' in data) {
    const c = (data as { code?: unknown }).code
    return typeof c === 'string' ? c : null
  }
  return null
}

export function mensagemErroRelay(status: number, data: unknown): string {
  const code = codeDoErro(data)
  switch (code) {
    case 'RELAY_NAO_CONFIGURADO':
      return 'Integração de atendimento não configurada no servidor.'
    case 'RELAY_INDISPONIVEL':
      return 'Serviço de atendimento indisponível no momento. Tente novamente.'
    case 'AGENT_NOT_CONNECTED':
      return 'Conecte sua conta do Chatwoot para responder.'
    case 'CONTENT_OBRIGATORIO':
      return 'A mensagem não pode ficar vazia.'
    case 'TOKEN_INVALIDO':
      return 'Token inválido. Confira o token de acesso do seu perfil no Chatwoot.'
    case 'TOKEN_OBRIGATORIO':
      return 'Informe o token de acesso.'
    case 'EMAIL_MISMATCH':
      return 'Este token pertence a outro agente. Use o token da sua própria conta.'
    case 'EMAIL_OBRIGATORIO':
      return 'E-mail do usuário ausente na sessão.'
    default:
      break
  }
  // 428 = agente sem token pessoal conectado (relay), com ou sem `code`.
  if (status === 428) return 'Conecte sua conta do Chatwoot para responder.'
  if (status === 401) return 'Sessão expirada. Faça login novamente.'
  if (status === 403) return 'Você não tem permissão para esta ação.'
  if (status === 404) return 'Não encontrado.'
  if (status === 502 || status === 503) return 'Serviço de atendimento indisponível. Tente novamente.'
  return 'Não foi possível completar a ação. Tente novamente.'
}

/** "2024-03-15" (chave de agrupadorDia) -> "15/03/2024" para o cabeçalho do dia. */
export function rotuloDia(chave: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave)
  if (!m) return chave
  return `${m[3]}/${m[2]}/${m[1]}`
}
