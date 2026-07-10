'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useToast } from '@/components/ui/toast'
import type { Conversa, RespostaLista } from '@/lib/conversas/tipos'

// Chaves por navegador (preferência é por dispositivo; pedido do dono 2026-07-10).
export const NOTIF_PREF_KEY = 'conversas:notificar'      // 'on' (default) | 'off'
const VISTO_KEY = 'conversas:vistoAte'                    // epoch seg da última msg de cliente já vista

export function notificacoesLigadas(): boolean {
  try { return localStorage.getItem(NOTIF_PREF_KEY) !== 'off' } catch { return true }
}

/**
 * Notificador global de mensagens novas do WhatsApp (montado na Sidebar, presente
 * em todas as páginas do dashboard). Checa 1×/minuto (aba visível): se alguma
 * conversa aberta tem mensagem de CLIENTE mais nova que a marca d'água local e o
 * usuário NÃO está no /conversas, dispara toast e badge no menu. Respeita o
 * interruptor do usuário (sino no /conversas). O escopo por canal é o do relay
 * (cada um só é notificado do que pode ver).
 */
export function NotificadorConversas({
  pathname,
  onBadge,
}: {
  pathname: string
  onBadge: (n: number) => void
}) {
  const { success } = useToast()
  const parado = useRef(false) // 401/403 → para de checar nesta sessão

  const checar = useCallback(async () => {
    if (parado.current || document.visibilityState !== 'visible') return
    if (!notificacoesLigadas()) { onBadge(0); return }
    try {
      const r = await fetch('/api/conversas?status=open')
      if (r.status === 401 || r.status === 403) { parado.current = true; return }
      if (!r.ok) return
      const d = (await r.json()) as RespostaLista
      const conversas = d.conversas ?? []
      const entrada = (c: Conversa) =>
        c.ultimaMensagem && c.ultimaMensagem.direcao === 'entrada' ? c.ultimaMensagem.timestamp : null
      const maisNova = Math.max(0, ...conversas.map((c) => entrada(c) ?? 0))
      const visto = Number(localStorage.getItem(VISTO_KEY) ?? '0')

      // Primeira execução neste navegador: ancora sem notificar (evita rajada no login).
      if (!visto) {
        if (maisNova) localStorage.setItem(VISTO_KEY, String(maisNova))
        return
      }

      // No /conversas a própria tela mostra tudo: só avança a marca d'água.
      if (pathname.startsWith('/conversas')) {
        if (maisNova > visto) localStorage.setItem(VISTO_KEY, String(maisNova))
        onBadge(0)
        return
      }

      if (maisNova > visto) {
        const novas = conversas.filter((c) => (entrada(c) ?? 0) > visto)
        const primeira = novas.sort((a, b) => (entrada(b) ?? 0) - (entrada(a) ?? 0))[0]
        const nome = primeira?.contato.nome || primeira?.contato.telefone || 'Cliente'
        success(
          novas.length === 1 ? `Nova mensagem de ${nome}` : `${novas.length} conversas com mensagens novas`,
          primeira?.ultimaMensagem?.trecho ?? 'Abra Conversas para responder.',
        )
        onBadge(novas.length)
        localStorage.setItem(VISTO_KEY, String(maisNova)) // não repete o mesmo aviso a cada minuto
      }
    } catch { /* rede: tenta no próximo ciclo */ }
  }, [pathname, onBadge, success])

  useEffect(() => {
    void checar()
    const id = setInterval(() => void checar(), 60_000)
    document.addEventListener('visibilitychange', checar)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', checar)
    }
  }, [checar])

  // Entrou no /conversas → zera o badge.
  useEffect(() => {
    if (pathname.startsWith('/conversas')) onBadge(0)
  }, [pathname, onBadge])

  return null
}
