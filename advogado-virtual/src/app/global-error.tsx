'use client'

// Captura erros de renderização do React na raiz do App Router e os reporta ao
// Sentry (no-op se o Sentry não estiver configurado). Substitui a tela de erro
// crua do Next por uma página amigável em caso de falha grave.
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "'Segoe UI', Roboto, sans-serif", background: '#f1f3f9' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              maxWidth: 440,
              width: '100%',
              background: '#fff',
              borderRadius: 12,
              padding: 32,
              textAlign: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}
          >
            <h1 style={{ color: '#1e293b', fontSize: 20, margin: '0 0 8px' }}>Algo deu errado</h1>
            <p style={{ color: '#475569', fontSize: 15, lineHeight: 1.6, margin: '0 0 24px' }}>
              Ocorreu um erro inesperado. Você pode tentar novamente; se persistir, feche e reabra a página.
            </p>
            <button
              onClick={() => reset()}
              style={{
                background: '#4f5fcc',
                color: '#fff',
                border: 0,
                padding: '12px 28px',
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
