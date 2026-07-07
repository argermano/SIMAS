'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'

interface CategoriaCfg {
  slug: string
  rotulo: string
  notificavel: boolean
}

export function ConfigMovimentacoes() {
  const { success, error: toastError } = useToast()
  const [cats, setCats] = useState<CategoriaCfg[]>([])
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/escritorio/config-processos')
        const d = await r.json()
        if (r.ok) setCats(d.categorias ?? [])
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

  return (
    <div className="space-y-4">
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
