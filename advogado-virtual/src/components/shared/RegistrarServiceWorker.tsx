'use client'

import { useEffect } from 'react'

// Registra o service worker (public/sw.js) após o load. Componente sem UI,
// montado uma vez no layout raiz. Só registra em produção e quando o navegador
// suporta — em dev, evita cache atrapalhando o hot reload.
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    const registrar = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Falha ao registrar é não-fatal: o app segue funcionando online.
      })
    }

    if (document.readyState === 'complete') registrar()
    else {
      window.addEventListener('load', registrar)
      return () => window.removeEventListener('load', registrar)
    }
  }, [])

  return null
}
