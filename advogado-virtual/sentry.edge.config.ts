// Sentry — runtime Edge (middleware / rotas edge). Mesma gate por SENTRY_DSN.
import * as Sentry from '@sentry/nextjs'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    sendDefaultPii: false,
  })
}
