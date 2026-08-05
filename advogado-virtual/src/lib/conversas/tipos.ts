// Tipos TypeScript espelhando os shapes JÁ NORMALIZADOS pelo relay externo.
// Fonte da verdade: contrato do relay (agenda.apoiojuridicodf.adv.br/relay).
// Timestamps são EPOCH em SEGUNDOS.

export type DirecaoMensagem = 'entrada' | 'saida' | 'atividade'
export type TipoSender = 'cliente' | 'agente' | 'bot' | 'sistema'
export type InboxNome = 'DF' | 'SC'
export type StatusConversa = 'open' | 'resolved'

export interface Contato {
  nome: string | null
  telefone: string | null
  /** Foto do contato (thumbnail do Chatwoot / foto de perfil do WhatsApp), se houver. */
  avatarUrl?: string | null
}

export interface Assignee {
  id: number
  nome: string
}

export interface UltimaMensagem {
  trecho: string
  timestamp: number
  /** Direção da última mensagem (campo novo do relay; ausente em versões antigas). */
  direcao?: DirecaoMensagem
}

export interface Conversa {
  id: number
  contato: Contato
  inbox: InboxNome
  status: StatusConversa
  assignee: Assignee | null
  ultimaMensagem: UltimaMensagem | null
  naoLidas: number
  /**
   * Desde quando o CLIENTE espera resposta (epoch em segundos).
   * null = conversa respondida ou sem mensagens de entrada pendentes.
   */
  aguardandoDesde: number | null
  /** Etiquetas do Chatwoot repassadas pelo relay (ex.: "atendimento-humano"). [] se ausente (relay antigo). */
  labels: string[]
}

export interface Anexo {
  tipo: string
  url: string
}

export interface Sender {
  tipo: TipoSender
  nome: string
}

export interface Mensagem {
  id: number
  direcao: DirecaoMensagem
  privada: boolean
  conteudo: string
  anexos: Anexo[]
  sender: Sender
  timestamp: number
  /**
   * Id da mensagem CITADA (resposta no padrão WhatsApp) — vem de
   * content_attributes.in_reply_to no Chatwoot, normalizado pelo relay. É sempre
   * uma mensagem da MESMA conversa. Ausente em relays antigos e em mensagens
   * vindas do espelho no banco; null quando a mensagem não responde ninguém.
   */
  emRespostaA?: number | null
  /**
   * source_id do Chatwoot, como o relay entrega. Quando veio da ponte nativa da
   * Evolution é 'WAID:<key.id>' — o primeiro degrau para achar a mensagem no
   * WhatsApp (editar/reconciliar). Ausente em relays antigos; null quando a
   * mensagem nasceu no painel do Chatwoot. Ver src/lib/conversas/edicao.ts.
   */
  sourceId?: string | null
}

export interface Agente {
  id: number
  nome: string
  email: string
  role: string
  conectado: boolean
}

export interface AgenteMe {
  conectado: boolean
  agentId?: number
  agentName?: string
  status?: string
  validadoEm?: number
}

// ---------------------------------------------------------------------------
// Contexto SIMAS da conversa (GET /api/conversas/contexto?telefone=...):
// cliente casado por telefone + processos dele + últimas publicações.
// ---------------------------------------------------------------------------

export interface ContextoConversa {
  cliente: { id: string; nome: string } | null
  processos: {
    id: string
    numeroMascara: string | null
    titulo: string | null
    situacao: string | null
  }[]
  publicacoes: {
    id: string
    trecho: string
    tribunal: string | null
    data: string | null
  }[]
  /** Casos/atendimentos do cliente (últimos 3; inclui importados sem CNJ). */
  casos: {
    id: string
    titulo: string | null
    area: string | null
    status: string | null
  }[]
}

export interface RespostaLista {
  conversas: Conversa[]
  meta: unknown
}

export interface RespostaMensagens {
  mensagens: Mensagem[]
}
