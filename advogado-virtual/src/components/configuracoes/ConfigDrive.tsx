'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { RefreshCw, CheckCircle2, AlertTriangle, CircleOff } from 'lucide-react'

interface Estado {
  configurado: boolean
  raizOk: boolean
  pendentes: number
}

// Card "Google Drive" das Configurações (admin): mostra o estado do espelho do
// dossiê (inativo sem envs / ativo com a raiz acessível), quantos clientes estão
// na fila e um botão para drenar AGORA. Não expõe ids do Drive.
export function ConfigDrive() {
  const { success, error: toastError } = useToast()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [loading, setLoading] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)

  async function carregar() {
    try {
      const r = await fetch('/api/escritorio/drive-sync')
      const d = await r.json()
      if (r.ok) setEstado({ configurado: !!d.configurado, raizOk: !!d.raizOk, pendentes: d.pendentes ?? 0 })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [])

  async function sincronizar() {
    setSincronizando(true)
    try {
      const r = await fetch('/api/escritorio/drive-sync', { method: 'POST' })
      const d = await r.json()
      if (!r.ok) { toastError('Não foi possível sincronizar', d.error ?? 'Tente novamente.'); return }
      const partes = [
        `${d.clientes} cliente${d.clientes === 1 ? '' : 's'} processado${d.clientes === 1 ? '' : 's'}`,
        `${d.arquivos} arquivo${d.arquivos === 1 ? '' : 's'} enviado${d.arquivos === 1 ? '' : 's'}`,
      ]
      if (d.erros > 0) partes.push(`${d.erros} erro${d.erros === 1 ? '' : 's'}`)
      success('Sincronização concluída', partes.join(' · '))
      await carregar() // atualiza a contagem de pendentes
    } finally {
      setSincronizando(false)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Carregando…</div>
  }

  // Sem as envs → espelho INERTE (nada a fazer neste ambiente).
  if (!estado?.configurado) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
          <CircleOff className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">Espelho no Google Drive inativo neste ambiente.</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Para ativar, configure a conta de serviço e a pasta raiz compartilhada do escritório. Enquanto isso, os documentos continuam guardados normalmente no SIMAS.
        </p>
      </div>
    )
  }

  const ativo = estado.raizOk

  return (
    <div className="space-y-3">
      {/* Estado do espelho */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
        {ativo ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        )}
        <span className="font-medium text-foreground">Espelho no Google Drive</span>
        <Badge variant={ativo ? 'success' : 'warning'} className="px-1.5 py-0 text-[10px]">
          {ativo ? 'Ativo' : 'Pasta raiz indisponível'}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {estado.pendentes > 0
            ? `${estado.pendentes} cliente${estado.pendentes === 1 ? '' : 's'} na fila`
            : 'Fila vazia'}
        </span>
      </div>

      {!ativo && (
        <p className="text-[11px] text-warning">
          A conta de serviço não conseguiu abrir a pasta raiz. Verifique se ela existe e está compartilhada com a conta de serviço do escritório.
        </p>
      )}

      <Button size="sm" onClick={sincronizar} disabled={sincronizando || !ativo}>
        {sincronizando ? <><Spinner className="h-4 w-4" /> Sincronizando…</> : <><RefreshCw className="h-4 w-4" /> Sincronizar agora</>}
      </Button>

      <p className="text-[11px] text-muted-foreground">
        O SIMAS é a fonte da verdade: a estrutura de pastas do cliente (Gerais, Casos e Processos) é copiada para o Drive em <strong>via única</strong> — alterações feitas direto no Drive não voltam. A cópia é <strong>sob demanda</strong> (só clientes com movimentação de documentos) e <strong>sem retroativo</strong>. A sincronização também roda sozinha uma vez por dia.
      </p>
    </div>
  )
}
