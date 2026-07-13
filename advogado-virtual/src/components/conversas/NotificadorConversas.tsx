'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useToast } from '@/components/ui/toast'
import { transferidaPeloBot } from '@/lib/conversas/handoff'
import type { Conversa, RespostaLista } from '@/lib/conversas/tipos'

// Chaves por navegador (preferência é por dispositivo; pedido do dono 2026-07-10).
export const NOTIF_PREF_KEY = 'conversas:notificar'      // 'on' (default) | 'off'
const VISTO_KEY = 'conversas:vistoAte'                    // epoch seg da última msg de cliente já vista
const HANDOFF_VISTOS_KEY = 'conversas:handoffVistos'     // JSON de ids já vistos em estado de handoff

function lerHandoffVistos(): number[] {
  try {
    const p = JSON.parse(localStorage.getItem(HANDOFF_VISTOS_KEY) ?? 'null')
    return Array.isArray(p) ? p.filter((x): x is number => typeof x === 'number') : []
  } catch { return [] }
}

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
  const { toast } = useToast()
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
      const emConversas = pathname.startsWith('/conversas')

      // ── Aviso 1: mensagens novas de cliente (comportamento preservado) ──────
      // Prepara o toast mas só dispara no fim (junto com o de handoff, se houver).
      let novasMsgs = 0
      let dispararToastMsg: (() => void) | null = null
      {
        const entrada = (c: Conversa) =>
          c.ultimaMensagem && c.ultimaMensagem.direcao === 'entrada' ? c.ultimaMensagem.timestamp : null
        const maisNova = Math.max(0, ...conversas.map((c) => entrada(c) ?? 0))
        const visto = Number(localStorage.getItem(VISTO_KEY) ?? '0')

        if (!visto) {
          // Primeira execução neste navegador: ancora sem notificar (evita rajada no login).
          if (maisNova) localStorage.setItem(VISTO_KEY, String(maisNova))
        } else if (emConversas) {
          // No /conversas a própria tela mostra tudo: só avança a marca d'água.
          if (maisNova > visto) localStorage.setItem(VISTO_KEY, String(maisNova))
        } else if (maisNova > visto) {
          const novas = conversas.filter((c) => (entrada(c) ?? 0) > visto)
          const primeira = novas.sort((a, b) => (entrada(b) ?? 0) - (entrada(a) ?? 0))[0]
          const nome = primeira?.contato.nome || primeira?.contato.telefone || 'Cliente'
          novasMsgs = novas.length
          dispararToastMsg = () => toast({
            type: 'success',
            title: novas.length === 1 ? `Nova mensagem de ${nome}` : `${novas.length} conversas com mensagens novas`,
            message: (primeira?.ultimaMensagem?.trecho ?? '') + ' — clique para abrir',
            duracaoMs: 20_000,
            href: novas.length === 1 && primeira ? `/conversas?conversa=${primeira.id}` : '/conversas',
          })
          localStorage.setItem(VISTO_KEY, String(maisNova)) // não repete o mesmo aviso a cada minuto
        }
      }

      // ── Aviso 2: conversas transferidas pelo assistente (ativo e separado) ──
      let novasHandoff = 0
      let dispararToastHandoff: (() => void) | null = null
      {
        const transferidas = conversas.filter((c) => transferidaPeloBot(c))
        const idsAtuais = transferidas.map((c) => c.id)
        const bruto = localStorage.getItem(HANDOFF_VISTOS_KEY)

        if (bruto == null) {
          // Primeira execução: ancora todas as transferidas atuais sem notificar.
          localStorage.setItem(HANDOFF_VISTOS_KEY, JSON.stringify(idsAtuais))
        } else {
          const vistos = lerHandoffVistos()
          const novas = transferidas.filter((c) => !vistos.includes(c.id))
          if (emConversas) {
            // Na própria tela: só reconcilia o conjunto visto (sem toast).
            localStorage.setItem(HANDOFF_VISTOS_KEY, JSON.stringify(idsAtuais))
          } else if (novas.length > 0) {
            const primeira = novas[0]
            const nome = primeira.contato.nome || primeira.contato.telefone || 'Cliente'
            novasHandoff = novas.length
            dispararToastHandoff = () => toast({
              type: 'warning',
              title: novas.length === 1
                ? '🙋 Conversa transferida pelo assistente'
                : `${novas.length} conversas transferidas pelo assistente`,
              message: novas.length === 1 ? `${nome} — clique para assumir` : 'clique para assumir',
              duracaoMs: 20_000,
              href: novas.length === 1 ? `/conversas?conversa=${primeira.id}` : '/conversas',
            })
            // Reconcilia com os transferidos atuais (inclui os agora avisados; some
            // ids que deixaram de ser handoff, permitindo re-aviso se reabrirem).
            localStorage.setItem(HANDOFF_VISTOS_KEY, JSON.stringify(idsAtuais))
          } else {
            // Nada novo: só reconcilia (interseção) p/ o conjunto não crescer infinito.
            const intersec = vistos.filter((id) => idsAtuais.includes(id))
            if (intersec.length !== vistos.length) {
              localStorage.setItem(HANDOFF_VISTOS_KEY, JSON.stringify(intersec))
            }
          }
        }
      }

      // Dispara os toasts (podem coexistir) e reflete no badge do menu.
      dispararToastMsg?.()
      dispararToastHandoff?.()
      if (emConversas) onBadge(0)
      else if (novasMsgs + novasHandoff > 0) onBadge(novasMsgs + novasHandoff) // total; senão mantém o badge anterior
    } catch { /* rede: tenta no próximo ciclo */ }
  }, [pathname, onBadge, toast])

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
