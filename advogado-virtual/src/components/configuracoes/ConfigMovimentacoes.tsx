'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { BellRing } from 'lucide-react'

interface CategoriaCfg {
  slug: string
  rotulo: string
  notificavel: boolean
}

interface VipsInfo {
  total: number
  max: number
  clientes: Array<{ id: string; nome: string | null; modo: 'fila' | 'automatico' }>
}

export function ConfigMovimentacoes() {
  const { success, error: toastError } = useToast()
  const [cats, setCats] = useState<CategoriaCfg[]>([])
  const [vips, setVips] = useState<VipsInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/escritorio/config-processos')
        const d = await r.json()
        if (r.ok) {
          setCats(d.categorias ?? [])
          setVips(d.vips ?? null)
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  function toggle(slug: string) {
    setCats((c) => c.map((x) => (x.slug === slug ? { ...x, notificavel: !x.notificavel } : x)))
  }

  async function salvar() {
    setSalvando(true)
    try {
      const processos_notificar = cats.filter((c) => c.notificavel).map((c) => c.slug)
      const r = await fetch('/api/escritorio/config-processos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processos_notificar }),
      })
      const d = await r.json()
      if (!r.ok) { toastError('Não foi possível salvar', d.error ?? 'Tente novamente.'); return }
      success('Configuração salva', 'Categorias notificáveis atualizadas.')
    } finally {
      setSalvando(false)
    }
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Carregando…</div>

  const ocupacao = vips ? Math.min(100, Math.round((vips.total / Math.max(1, vips.max)) * 100)) : 0
  const restantes = vips ? Math.max(0, vips.max - vips.total) : 0

  return (
    <div className="space-y-4">
      {/* Contador de vagas VIP (aviso proativo) */}
      {vips && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <BellRing className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-foreground">
              Clientes com aviso automático: {vips.total} de {vips.max}
            </span>
            <span className={cn('ml-auto text-sm', restantes === 0 ? 'text-destructive font-medium' : 'text-muted-foreground')}>
              {restantes === 0 ? 'Limite atingido' : `${restantes} vaga${restantes === 1 ? '' : 's'} disponíve${restantes === 1 ? 'l' : 'is'}`}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all', ocupacao >= 100 ? 'bg-destructive' : 'bg-primary')}
              style={{ width: `${ocupacao}%` }}
            />
          </div>
          {vips.clientes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {vips.clientes.map((c) => (
                <Link key={c.id} href={`/clientes/${c.id}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted/50">
                  {c.nome ?? 'Cliente'}
                  <Badge variant={c.modo === 'automatico' ? 'success' : 'warning'} className="px-1.5 py-0 text-[10px]">
                    {c.modo === 'automatico' ? 'Automático' : 'Fila'}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            O aviso proativo é ativado na ficha do cliente (seção Processos). Clientes fora da lista continuam podendo consultar o andamento pelo WhatsApp.
          </p>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Escolha quais tipos de movimentação podem gerar aviso ao cliente. O envio ainda depende de cada
        cliente estar em modo <strong>Fila</strong> ou <strong>Automático</strong> (na ficha do cliente).
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cats.map((c) => (
          <label key={c.slug} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm cursor-pointer hover:bg-muted/30">
            <input type="checkbox" checked={c.notificavel} onChange={() => toggle(c.slug)} className="h-4 w-4 accent-primary" />
            <span className="text-foreground">{c.rotulo}</span>
          </label>
        ))}
      </div>
      <Button size="sm" onClick={salvar} disabled={salvando}>
        {salvando ? <><Spinner className="h-4 w-4" /> Salvando…</> : 'Salvar categorias'}
      </Button>
    </div>
  )
}
