'use client'

import { useEffect, useRef, useState } from 'react'
import { KeyRound, PlugZap, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { AgenteMe } from '@/lib/conversas/tipos'
import { mensagemErroRelay } from './erros'

/**
 * Conexão da conta do Chatwoot — agora um INDICADOR discreto (pontinho
 * verde/âmbar) em vez de faixa full-width, para não roubar altura da tela em
 * notebooks. O detalhe e as ações (conectar/desconectar) vivem num popover
 * aberto no clique; nada de banner ocupando linha inteira quando está tudo bem.
 * Âmbar (com pulso) = ação necessária: cole o token para responder.
 * A lógica de rede (conectar/desconectar via 428) é idêntica à versão anterior.
 */
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
  const [aberto, setAberto] = useState(false)
  const raizRef = useRef<HTMLDivElement>(null)

  const conectado = agente?.conectado === true
  const carregandoInicial = loading && agente === null

  // Fecha o popover ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!aberto) return
    function onDoc(e: MouseEvent) {
      if (raizRef.current && !raizRef.current.contains(e.target as Node)) setAberto(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [aberto])

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
      setAberto(false)
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
      setAberto(false)
      success('Conta desconectada')
      onMudou()
    } finally {
      setDesconectando(false)
    }
  }

  const estado: 'loading' | 'on' | 'off' = carregandoInicial ? 'loading' : conectado ? 'on' : 'off'
  const rotulo = carregandoInicial
    ? 'Verificando conexão…'
    : conectado
      ? `Conectado como ${agente?.agentName || 'agente'}`
      : 'Não conectado — clique para conectar e responder'

  return (
    <div ref={raizRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title={rotulo}
        aria-label={rotulo}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
          estado === 'on' && 'border-success/30 bg-success/5 hover:bg-success/10',
          estado === 'off' && 'border-warning/40 bg-warning/10 hover:bg-warning/15',
          estado === 'loading' && 'border-border bg-card hover:bg-muted',
        )}
      >
        <span className="relative flex h-2.5 w-2.5">
          {estado === 'off' && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning/60" aria-hidden />
          )}
          <span
            className={cn(
              'relative inline-flex h-2.5 w-2.5 rounded-full',
              estado === 'on' && 'bg-success',
              estado === 'off' && 'bg-warning',
              estado === 'loading' && 'animate-pulse bg-muted-foreground/50',
            )}
            aria-hidden
          />
        </span>
      </button>

      {aberto && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-card p-4 shadow-card"
          role="dialog"
          aria-label="Conexão da conta"
        >
          {carregandoInicial ? (
            <p className="text-sm text-muted-foreground">Verificando conexão…</p>
          ) : conectado ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Conectado como {agente?.agentName || 'agente'}
                  </p>
                  <p className="text-xs text-muted-foreground">Você pode responder e assumir conversas.</p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={desconectar}
                loading={desconectando}
              >
                Desconectar
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Conecte sua conta do Chatwoot</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    A leitura funciona sem conectar. Para responder, assumir ou resolver, cole o seu token de
                    acesso pessoal do Chatwoot (Perfil → Token de acesso).
                  </p>
                </div>
              </div>
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
              <Button className="w-full" onClick={conectar} loading={conectando} disabled={!token.trim()}>
                Conectar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
