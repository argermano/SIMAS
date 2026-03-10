'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Detecta tokens de autenticação no hash fragment da URL (magiclink, invite, recovery)
 * e configura a sessão automaticamente.
 *
 * O Supabase redireciona com tokens no hash: /#access_token=...&refresh_token=...
 * Este componente captura esses tokens e chama setSession().
 */
export function HashTokenHandler() {
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash
    if (!hash || !hash.includes('access_token=')) return

    const params = new URLSearchParams(hash.substring(1))
    const accessToken  = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const type         = params.get('type')

    if (!accessToken || !refreshToken) return

    async function handleToken() {
      const supabase = createClient()
      const { error } = await supabase.auth.setSession({
        access_token:  accessToken!,
        refresh_token: refreshToken!,
      })

      // Limpa o hash da URL
      window.history.replaceState(null, '', window.location.pathname)

      if (error) {
        console.error('[HashTokenHandler] Erro ao configurar sessão:', error.message)
        router.push('/login')
        return
      }

      // Redireciona baseado no tipo de link
      if (type === 'invite' || type === 'signup' || type === 'recovery') {
        router.push('/definir-senha')
      } else {
        router.push('/dashboard')
      }
    }

    handleToken()
  }, [router])

  return null
}
