// Sentry — runtime Node (servidor). Só inicializa se SENTRY_DSN estiver
// definido, de modo que ambientes sem a variável (local, preview sem a chave)
// ficam inertes — nada é enviado.
import * as Sentry from '@sentry/nextjs'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // Foco em ERROS (sem tracing de performance) — enxuto para o plano grátis.
    // NÃO enviar PII por padrão: dados de cliente/advogado são sensíveis (LGPD).
    sendDefaultPii: false,
  })
}
