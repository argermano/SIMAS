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
}

export interface Conversa {
  id: number
  contato: Contato
  inbox: InboxNome
  status: StatusConversa
  assignee: Assignee | null
  ultimaMensagem: UltimaMensagem | null
  naoLidas: number
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

export interface RespostaLista {
  conversas: Conversa[]
  meta: unknown
}

export interface RespostaMensagens {
  mensagens: Mensagem[]
}
