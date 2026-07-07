'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { formatarData } from '@/lib/utils'
import { BellRing, Send, X, AlertTriangle } from 'lucide-react'

interface Notif {
  id: string
  nome: string
  resumo_ia: string | null
  categoria: string | null
  data_hora: string | null
  notif_status: 'pendente' | 'erro'
  notif_texto: string | null
  processo: {
    id: string
    numero_cnj: string
    apelido: string | null
    cliente: { id: string; nome: string | null; telefone: string | null } | null
  } | null
}

function formatarCNJ(d: string): string {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length !== 20) return d
  return `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16, 20)}`
}

export function FilaNotificacoes() {
  const { success, error: toastError } = useToast()
  const [itens, setItens] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)
  const [textos, setTextos] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/processos/notificacoes')
      const d = await r.json()
      if (r.ok) {
        const lista: Notif[] = d.notificacoes ?? []
        setItens(lista)
        setTextos(Object.fromEntries(lista.map((n) => [n.id, n.notif_texto ?? ''])))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  async function agir(id: string, acao: 'aprovar' | 'descartar') {
    setOcupado(id)
    try {
      const r = await fetch(`/api/processos/notificacoes/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acao === 'aprovar' ? { acao, texto: textos[id] } : { acao }),
      })
      const d = await r.json()
      if (!r.ok) { toastError(acao === 'aprovar' ? 'Falha ao enviar' : 'Falha', d.error ?? 'Tente novamente.'); return }
      success(acao === 'aprovar' ? 'Aviso enviado ✅' : 'Aviso descartado', '')
      setItens((l) => l.filter((n) => n.id !== id))
    } finally {
      setOcupado(null)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Carregando fila…</div>
  }

  if (itens.length === 0) {
    return (
      <EmptyState
        icon={<BellRing className="h-8 w-8" />}
        title="Nenhum aviso pendente"
        description="Quando houver um movimento importante em um cliente com avisos em modo 'Fila de aprovação', ele aparece aqui para você revisar e enviar."
      />
    )
  }

  return (
    <div className="space-y-3">
      {itens.map((n) => (
        <Card key={n.id}>
          <CardContent className="py-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{n.processo?.cliente?.nome ?? 'Cliente'}</span>
              {n.notif_status === 'erro' && (
                <Badge variant="danger" className="gap-1"><AlertTriangle className="h-3 w-3" /> Falha no envio</Badge>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {n.processo?.apelido || (n.processo ? formatarCNJ(n.processo.numero_cnj) : '')}
              </span>
            </div>

            <div className="rounded-md bg-muted/30 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">
                {n.data_hora ? formatarData(n.data_hora) : ''} · {n.nome}
              </p>
              {n.resumo_ia && <p className="text-foreground mt-1">{n.resumo_ia}</p>}
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Mensagem que será enviada ao WhatsApp do cliente</label>
              <Textarea
                value={textos[n.id] ?? ''}
                onChange={(e) => setTextos((t) => ({ ...t, [n.id]: e.target.value }))}
                rows={5}
                className="mt-1 font-normal"
              />
              {!n.processo?.cliente?.telefone && (
                <p className="mt-1 text-xs text-destructive">⚠ Cliente sem telefone no cadastro — não é possível enviar.</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={ocupado === n.id || !n.processo?.cliente?.telefone || !(textos[n.id] ?? '').trim()}
                onClick={() => agir(n.id, 'aprovar')}
              >
                {ocupado === n.id ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                Aprovar e enviar
              </Button>
              <Button variant="ghost" size="sm" disabled={ocupado === n.id} onClick={() => agir(n.id, 'descartar')}>
                <X className="h-4 w-4" /> Descartar
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
