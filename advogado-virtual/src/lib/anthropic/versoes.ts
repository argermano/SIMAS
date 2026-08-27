// Versões de IA expostas ao usuário — rótulos amigáveis que representam cada modelo,
// SEM expor o nome técnico. Client-safe: não importa o SDK Anthropic.
//
// Mapeamento:
//   - "padrao"   → modelo equilibrado/rápido (ANTHROPIC_MODEL, default Sonnet)
//   - "avancado" → modelo mais capaz, com raciocínio mais profundo (default Opus)

export type VersaoIA = 'padrao' | 'avancado'

export const VERSAO_IA_PADRAO: VersaoIA = 'padrao'

// Opções para o seletor na UI (apenas rótulos — nada de nome de modelo)
export const VERSOES_IA: ReadonlyArray<{ id: VersaoIA; label: string; descricao: string }> = [
  { id: 'padrao',   label: 'Padrão',               descricao: 'Rápida e equilibrada — recomendada para a maioria dos casos' },
  { id: 'avancado', label: 'Raciocínio estendido', descricao: 'Análise mais profunda e fundamentada — pode demorar um pouco mais' },
]

// Normaliza a string crua vinda da UI para uma VersaoIA (default: padrão).
// Existe para as rotas poderem repassar a versão ao client de IA (que liga
// raciocínio adaptativo + esforço alto no 'avancado') sem espalhar comparações
// de string por aí.
export function normalizarVersao(versao?: string | null): VersaoIA {
  return versao === 'avancado' ? 'avancado' : VERSAO_IA_PADRAO
}

// Resolve a versão (string vinda da UI) para o modelo. Usado SOMENTE no servidor.
export function modeloDaVersao(versao?: string | null): string {
  const padrao   = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'
  const avancado = process.env.ANTHROPIC_MODEL_AVANCADO ?? 'claude-opus-4-8'
  return normalizarVersao(versao) === 'avancado' ? avancado : padrao
}
