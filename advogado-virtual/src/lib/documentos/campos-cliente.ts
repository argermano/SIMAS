// Fonte ÚNICA do que cada documento precisa DO CLIENTE. Puro e client-safe (sem
// dependências de servidor): usado tanto pela rota que extrai placeholders do modelo
// quanto pela tela que pede ao atendente os dados faltantes antes de gerar.
//
// Os nomes dos placeholders são EXATAMENTE os que `montarPlaceholders` emite
// (src/lib/export/montar-placeholders.ts) e que os modelos .docx/markdown usam:
// sempre com sufixo `_cliente` (ex.: {{cpf_cliente}}, {{nome_cliente}}).

export type TipoCampo = 'texto' | 'cpf' | 'cep' | 'uf' | 'select-estado-civil'

// Definição de um campo do cliente (sem o placeholder — que é a chave do registro).
export interface CampoClienteDef {
  campo: string // coluna real na tabela `clientes`
  label: string
  tipo: TipoCampo
}

// Campo faltante já resolvido (placeholder + definição), como o componente recebe.
export interface CampoCliente extends CampoClienteDef {
  placeholder: string
}

// placeholder → coluna. Cobre os 14 campos do cliente que os templates consomem.
// NÃO inclui o `{{cidade}}` "solto" (fecho): esse cai para a cidade do escritório
// quando o cliente não tem, então não deve virar pendência de preenchimento.
export const CAMPOS_CLIENTE: Record<string, CampoClienteDef> = {
  nome_cliente:            { campo: 'nome',            label: 'Nome completo',   tipo: 'texto' },
  cpf_cliente:             { campo: 'cpf',             label: 'CPF',             tipo: 'cpf' },
  rg_cliente:              { campo: 'rg',              label: 'RG',              tipo: 'texto' },
  orgao_expedidor_cliente: { campo: 'orgao_expedidor', label: 'Órgão expedidor', tipo: 'texto' },
  estado_civil_cliente:    { campo: 'estado_civil',   label: 'Estado civil',    tipo: 'select-estado-civil' },
  nacionalidade_cliente:   { campo: 'nacionalidade',  label: 'Nacionalidade',   tipo: 'texto' },
  profissao_cliente:       { campo: 'profissao',      label: 'Profissão',       tipo: 'texto' },
  telefone_cliente:        { campo: 'telefone',       label: 'Telefone',        tipo: 'texto' },
  email_cliente:           { campo: 'email',          label: 'E-mail',          tipo: 'texto' },
  endereco_cliente:        { campo: 'endereco',       label: 'Endereço',        tipo: 'texto' },
  bairro_cliente:          { campo: 'bairro',         label: 'Bairro',          tipo: 'texto' },
  cidade_cliente:          { campo: 'cidade',         label: 'Cidade',          tipo: 'texto' },
  estado_cliente:          { campo: 'estado',         label: 'UF',              tipo: 'uf' },
  cep_cliente:             { campo: 'cep',            label: 'CEP',             tipo: 'cep' },
}

// Extrai os placeholders {{campo}} de um texto (markdown OU texto já concatenado do .docx).
// Pura, sem dependências — a conversão .docx → texto fica no servidor (extrairTextoDocx).
// Aceita espaços internos ({{ campo }}) e deduplica preservando a ordem de aparição.
export function extrairPlaceholders(texto: string): string[] {
  const vistos = new Set<string>()
  for (const m of texto.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) vistos.add(m[1])
  return [...vistos]
}

function vazio(v: unknown): boolean {
  return v == null || String(v).trim() === ''
}

/**
 * Dentre os placeholders que o documento USA, retorna só os que são campos DO CLIENTE
 * e estão vazios no cadastro — ou seja, o que o atendente precisa completar antes de gerar.
 * `cliente` é a linha de `clientes` (já decifrada) como Record.
 */
export function camposFaltantes(
  cliente: Record<string, unknown>,
  placeholdersUsados: string[],
): CampoCliente[] {
  const faltantes: CampoCliente[] = []
  const jaIncluidos = new Set<string>()
  for (const placeholder of placeholdersUsados) {
    if (jaIncluidos.has(placeholder)) continue
    const def = CAMPOS_CLIENTE[placeholder]
    if (!def) continue // não é campo do cliente (objeto, oab, nome_advogado, …)
    if (!vazio(cliente[def.campo])) continue // já preenchido → não é pendência
    jaIncluidos.add(placeholder)
    faltantes.push({ placeholder, ...def })
  }
  return faltantes
}

// Fallback: quando NÃO há modelo (.docx nem markdown) para extrair os placeholders,
// assume o conjunto que o fluxo IA de fato substitui em /api/ia/gerar-documento
// (vars: nome/cpf/endereco/cidade/estado do cliente). Assim nunca pedimos mais do que
// o documento usaria. Por tipo para permitir ajuste futuro; hoje todos partem da base.
const PADRAO_BASE = [
  'nome_cliente',
  'cpf_cliente',
  'endereco_cliente',
  'cidade_cliente',
  'estado_cliente',
]

export const PLACEHOLDERS_PADRAO_POR_TIPO: Record<string, string[]> = {
  procuracao: PADRAO_BASE,
  declaracao_hipossuficiencia: PADRAO_BASE,
  substabelecimento: ['nome_cliente', 'cpf_cliente'],
  notificacao_extrajudicial: PADRAO_BASE,
  contrato_honorarios: PADRAO_BASE,
  _default: PADRAO_BASE,
}
