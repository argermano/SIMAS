// Sentry — navegador. Captura erros que acontecem na TELA do advogado (tela que
// trava, botão que não responde) — coisa que nunca chega ao log do servidor.
// Gate por NEXT_PUBLIC_SENTRY_DSN (inlined em build): sem a variável, inerte.
import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // Só erros (sem tracing/replay) — leve e sem capturar tela (privacidade).
    sendDefaultPii: false,
  })
}
