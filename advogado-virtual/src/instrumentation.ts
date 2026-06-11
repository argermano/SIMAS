/**
 * Hook de inicialização do Next.js (roda uma vez no boot do servidor).
 * Valida as variáveis de ambiente: falha rápido em produção se faltar
 * alguma obrigatória; apenas avisa para as opcionais (feature-gated).
 */
export async function register() {
  const { validateEnv, FEATURE_VARS } = await import('@/lib/env')

  const parsed = validateEnv()

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    console.error('❌ [env] Variáveis de ambiente obrigatórias inválidas/ausentes:', fieldErrors)
    // Falha rápido apenas no startup real do servidor — nunca durante `next build`
    // (a fase de build pode não ter todas as variáveis de runtime disponíveis).
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
    if (process.env.NODE_ENV === 'production' && !isBuildPhase) {
      throw new Error('Configuração de ambiente inválida — corrija as variáveis acima antes de iniciar.')
    }
  }

  // Avisos para features opcionais não configuradas
  for (const [varName, feature] of Object.entries(FEATURE_VARS)) {
    if (!process.env[varName]) {
      console.warn(`⚠️  [env] ${varName} ausente — ${feature} ficará indisponível.`)
    }
  }
}
