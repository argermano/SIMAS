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

  // Criptografia em repouso (CPF/RG + transcrições): sem ENCRYPTION_KEY, esses
  // dados pessoais/sensíveis (LGPD) são gravados em texto-plano. Para forçar a
  // presença da chave em produção, defina ENCRYPTION_REQUIRED=true no ambiente
  // (opt-in para não derrubar deploys que ainda não provisionaram a chave). Uma
  // vez confirmado que ENCRYPTION_KEY está em TODOS os ambientes que leem dados
  // cifrados, ligue o flag para transformar a ausência em erro de boot.
  const chaveAusente = !process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.includes('gere_com')
  if (chaveAusente) {
    const exigida = process.env.ENCRYPTION_REQUIRED === 'true'
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
    const msg = 'ENCRYPTION_KEY ausente — CPF/RG e transcrições serão gravados em TEXTO-PLANO.'
    if (exigida && process.env.NODE_ENV === 'production' && !isBuildPhase) {
      throw new Error(`❌ [env] ${msg} ENCRYPTION_REQUIRED=true exige a chave configurada.`)
    }
    console.warn(`⚠️  [env] ${msg} Defina ENCRYPTION_KEY (e ENCRYPTION_REQUIRED=true para exigir).`)
  }
}

/**
 * Captura app-wide de erros não tratados (rotas, server components, actions) —
 * hook nativo do Next 15. Registra de forma estruturada via logger (visível nos
 * logs da Vercel, pesquisável). É o ponto único onde um APM/Sentry pode ser
 * plugado no futuro (basta encaminhar `err` aqui), sem tocar em cada rota.
 */
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routePath?: string; routeType?: string },
) {
  try {
    const { logger } = await import('@/lib/logger')
    logger.error('request.erro_nao_tratado', {
      path: request?.path,
      method: request?.method,
      routePath: context?.routePath,
      routeType: context?.routeType,
    }, err)
  } catch {
    // Nunca deixar o próprio handler de erro derrubar a request.
    console.error('[onRequestError] falha ao registrar:', err)
  }
}
