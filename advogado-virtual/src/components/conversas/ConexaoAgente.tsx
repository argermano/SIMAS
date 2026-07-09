'use client'

import { useState } from 'react'
import { KeyRound, PlugZap, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import type { AgenteMe } from '@/lib/conversas/tipos'
import { mensagemErroRelay } from './erros'

export function ConexaoAgente({
  agente,
  loading,
  onMudou,
}: {
  agente: AgenteMe | null
  loading: boolean
  onMudou: () => void
}) {
  const { success, error: toastError } = useToast()
  const [token, setToken] = useState('')
  const [conectando, setConectando] = useState(false)
  const [desconectando, setDesconectando] = useState(false)

  const conectado = agente?.conectado === true

  async function conectar() {
    const t = token.trim()
    if (!t || conectando) return
    setConectando(true)
    try {
      const r = await fetch('/api/conversas/agente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível conectar', mensagemErroRelay(r.status, d))
        return
      }
      setToken('')
      success('Conta conectada', 'Agora você pode responder pelas conversas.')
      onMudou()
    } finally {
      setConectando(false)
    }
  }

  async function desconectar() {
    setDesconectando(true)
    try {
      const r = await fetch('/api/conversas/agente', { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível desconectar', mensagemErroRelay(r.status, d))
        return
      }
      success('Conta desconectada')
      onMudou()
    } finally {
      setDesconectando(false)
    }
  }

  // Estado conectado — faixa compacta.
  if (conectado) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Conectado como {agente?.agentName || 'agente'}
          </p>
          <p className="text-xs text-muted-foreground">Você pode responder e assumir conversas.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={desconectar} loading={desconectando}>
          Desconectar
        </Button>
      </div>
    )
  }

  // Enquanto carrega o estado inicial, evita piscar o banner.
  if (loading && agente === null) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        Verificando conexão…
      </div>
    )
  }

  // Não conectado — banner para colar o token pessoal.
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
      <div className="flex items-start gap-3">
        <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Conecte sua conta do Chatwoot para responder</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A leitura das conversas funciona sem conectar. Para responder, assumir ou resolver, cole o seu
            token de acesso pessoal do Chatwoot (Perfil → Token de acesso).
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="flex-1">
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Cole aqui o seu token pessoal"
                leftIcon={<KeyRound className="h-4 w-4" />}
                aria-label="Token de acesso do Chatwoot"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void conectar()
                  }
                }}
              />
            </div>
            <Button onClick={conectar} loading={conectando} disabled={!token.trim()}>
              Conectar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
