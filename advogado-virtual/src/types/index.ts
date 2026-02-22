// ─────────────────────────────────────────────────────────────────────────────
// Tipos centrais do Advogado Virtual
// ─────────────────────────────────────────────────────────────────────────────

export type TenantPlano = 'trial' | 'basico' | 'profissional'
export type TenantStatus = 'ativo' | 'suspenso' | 'cancelado'

export interface Tenant {
  id: string
  nome: string
  cnpj?: string
  plano: TenantPlano
  status: TenantStatus
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'advogado' | 'revisor' | 'estagiario'
export type UserStatus = 'ativo' | 'inativo'

export interface Usuario {
  id: string
  tenant_id: string
  nome: string
  email: string
  role: UserRole
  status: UserStatus
  last_login?: string
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────────

export interface Cliente {
  id: string
  tenant_id: string
  nome: string
  cpf?: string          // armazenado criptografado
  telefone?: string
  email?: string
  endereco?: string
  notas?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface ClienteComAtendimentos extends Cliente {
  atendimentos?: Atendimento[]
  total_atendimentos?: number
}

// ─────────────────────────────────────────────────────────────────────────────

export type AreaJuridica = 'previdenciario' | 'trabalhista' | 'civel' | 'criminal' | 'tributario' | 'empresarial'
export type AtendimentoStatus = 'caso_novo' | 'peca_gerada' | 'finalizado'

export interface Atendimento {
  id: string
  tenant_id: string
  cliente_id: string
  user_id: string
  area: AreaJuridica
  audio_url?: string
  transcricao_raw?: string
  transcricao_editada?: string
  pedidos_especificos?: string
  metadados_extraidos: Record<string, unknown>
  status: AtendimentoStatus
  created_at: string
  updated_at: string
  // joins
  cliente?: Cliente
  usuario?: Usuario
  documentos?: Documento[]
}

// ─────────────────────────────────────────────────────────────────────────────

export type TipoDocumento =
  | 'cnis'
  | 'indeferimento'
  | 'cessacao'
  | 'laudo'
  | 'procuracao'
  | 'carta_concessao'
  | 'outro'

export interface Documento {
  id: string
  atendimento_id: string
  tenant_id: string
  tipo: TipoDocumento
  file_url: string
  file_name: string
  mime_type?: string
  tamanho_bytes?: number
  texto_extraido?: string
  dados_extraidos: Record<string, unknown>
  confirmado_por_usuario: boolean
  confirmado_por?: string
  confirmado_at?: string
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────────

export type AnaliseStatus = 'gerada' | 'revisada' | 'aprovada'

export interface Analise {
  id: string
  atendimento_id: string
  tenant_id: string
  resumo_fatos?: string
  tese_principal?: string
  plano_a?: PlanoAcao
  plano_b?: PlanoAcao
  riscos?: Risco[]
  checklist_documentos?: ChecklistDoc[]
  perguntas_faltantes?: PerguntaFaltante[]
  acoes_sugeridas?: AcaoSugerida[]
  fontes_utilizadas: Record<string, unknown>
  prompt_utilizado?: string
  modelo_ia?: string
  tokens_utilizados?: TokensInfo
  status: AnaliseStatus
  revisada_por?: string
  revisada_at?: string
  created_by: string
  created_at: string
}

export interface PlanoAcao {
  titulo: string
  descricao: string
  fundamento: string
  probabilidade: 'alta' | 'media' | 'baixa'
  pre_requisitos: string
}

export interface Risco {
  tipo: string
  descricao: string
  severidade: 'alta' | 'media' | 'baixa'
}

export interface ChecklistDoc {
  documento: string
  status: 'fornecido' | 'incompleto' | 'faltante'
  observacao?: string
}

export interface PerguntaFaltante {
  pergunta: string
  motivo: string
}

export interface AcaoSugerida {
  tipo_peca: string
  label: string
  descricao: string
}

export interface TokensInfo {
  input: number
  output: number
  custo_estimado: number
}

// ─────────────────────────────────────────────────────────────────────────────

export type TipoPeca =
  | 'peticao_inicial'
  | 'contestacao'
  | 'replica'
  | 'apelacao'
  | 'agravo'
  | 'embargos'
  | 'tutela'
  | 'cumprimento'

export type PecaStatus = 'rascunho' | 'revisada' | 'aprovada' | 'exportada'

export interface Peca {
  id: string
  analise_id?: string
  atendimento_id: string
  tenant_id: string
  tipo: TipoPeca
  area: AreaJuridica
  conteudo_markdown?: string
  conteudo_html?: string
  validacao_coerencia?: Record<string, unknown>
  validacao_fontes?: Record<string, unknown>
  versao: number
  status: PecaStatus
  prompt_utilizado?: string
  modelo_ia?: string
  tokens_utilizados?: TokensInfo
  created_by: string
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────────────────

// Helpers de UI
export const LABELS_AREA: Record<AreaJuridica, string> = {
  previdenciario: 'Previdenciário',
  trabalhista:    'Trabalhista',
  civel:          'Cível',
  criminal:       'Criminal',
  tributario:     'Tributário',
  empresarial:    'Empresarial',
}

export const LABELS_STATUS_ATENDIMENTO: Record<AtendimentoStatus, string> = {
  caso_novo:   'Caso Novo',
  peca_gerada: 'Peça Gerada',
  finalizado:  'Finalizado',
}

export const LABELS_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  cnis:           'CNIS',
  indeferimento:  'Carta de Indeferimento',
  cessacao:       'Carta de Cessação',
  laudo:          'Laudo Médico',
  procuracao:     'Procuração',
  carta_concessao: 'Carta de Concessão',
  outro:          'Outro',
}

export const LABELS_ROLE: Record<UserRole, string> = {
  admin:      'Administrador',
  advogado:   'Advogado(a)',
  revisor:    'Revisor(a)',
  estagiario: 'Estagiário(a)',
}
