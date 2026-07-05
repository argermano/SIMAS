import type { EtapaFunil } from '@/lib/funil/regras'

export interface LeadData {
  id: string
  nome_informado: string | null
  telefone: string
  email: string | null
  area: string | null
  unidade: string
  etapa: EtapaFunil
  valor_estimado: number | null
  consulta_data: string | null
  consulta_formato: string | null
  meet_url: string | null
  aguardando_confirmacao: boolean
  sugerir_perda: boolean
  consulta_cancelada: boolean
  ultimo_contato_em: string | null
  chatwoot_conversation_id: number | null
  created_at: string
  updated_at: string
  clientes: { id: string; nome: string; status_cadastro: string } | null
}
