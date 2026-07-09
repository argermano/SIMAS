'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { BellRing, Newspaper, Plus, Trash2 } from 'lucide-react'

const UFS_BR = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']
const MAX_OABS = 10

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

interface OabExtra {
  numero: string
  uf: string
  ativa: boolean
}

interface DjenInfo {
  oabPrincipal: { numero: string; uf: string } | null
  extras: Array<{ numero: string; uf: string; ativa?: boolean }>
}

export function ConfigMovimentacoes() {
  const { success, error: toastError } = useToast()
  const [cats, setCats] = useState<CategoriaCfg[]>([])
  const [vips, setVips] = useState<VipsInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)

  // OABs monitoradas (DJEN)
  const [oabPrincipal, setOabPrincipal] = useState<{ numero: string; uf: string } | null>(null)
  const [oabs, setOabs] = useState<OabExtra[]>([])
  const [novoNumero, setNovoNumero] = useState('')
  const [novaUf, setNovaUf] = useState('')
  const [salvandoOabs, setSalvandoOabs] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/escritorio/config-processos')
        const d = await r.json()
        if (r.ok) {
          setCats(d.categorias ?? [])
          setVips(d.vips ?? null)
          const djen: DjenInfo | undefined = d.djen
          setOabPrincipal(djen?.oabPrincipal ?? null)
          setOabs((djen?.extras ?? []).map((o) => ({ numero: o.numero, uf: o.uf, ativa: o.ativa ?? true })))
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  function toggle(slug: string) {
    setCats((c) => c.map((x) => (x.slug === slug ? { ...x, notificavel: !x.notificavel } : x)))
  }

  function adicionarOab() {
    const numero = novoNumero.trim()
    const uf = novaUf.trim().toUpperCase()
    if (!numero || !UFS_BR.includes(uf)) {
      toastError('Dados incompletos', 'Informe o número e selecione a UF.')
      return
    }
    if (oabs.length >= MAX_OABS) {
      toastError('Limite atingido', `Máximo de ${MAX_OABS} OABs monitoradas.`)
      return
    }
    // Evita duplicar (compara em maiúsculas, ignorando pontuação leve).
    const chave = (n: string, u: string) => `${n.toUpperCase().replace(/[.\s-]/g, '')}:${u}`
    if (oabs.some((o) => chave(o.numero, o.uf) === chave(numero, uf))) {
      toastError('Já cadastrada', 'Essa OAB já está na lista.')
      return
    }
    setOabs((prev) => [...prev, { numero, uf, ativa: true }])
    setNovoNumero('')
    setNovaUf('')
  }

  function removerOab(i: number) {
    setOabs((prev) => prev.filter((_, idx) => idx !== i))
  }

  function toggleOab(i: number) {
    setOabs((prev) => prev.map((o, idx) => (idx === i ? { ...o, ativa: !o.ativa } : o)))
  }

  async function salvarOabs() {
    setSalvandoOabs(true)
    try {
      const r = await fetch('/api/escritorio/config-processos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ djen_oabs: oabs.map((o) => ({ numero: o.numero, uf: o.uf, ativa: o.ativa })) }),
      })
      const d = await r.json()
      if (!r.ok) { toastError('Não foi possível salvar', d.error ?? 'Tente novamente.'); return }
      // Reflete a versão normalizada que o servidor gravou (ex.: '75.503-A' → '75503A').
      if (Array.isArray(d.djen?.extras)) {
        setOabs(d.djen.extras.map((o: { numero: string; uf: string; ativa?: boolean }) => ({ numero: o.numero, uf: o.uf, ativa: o.ativa ?? true })))
      }
      success('OABs atualizadas', 'Lista de OABs monitoradas salva.')
    } finally {
      setSalvandoOabs(false)
    }
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

      {/* OABs monitoradas (DJEN) — captura de publicações/intimações por inscrição */}
      <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-foreground">OABs monitoradas (DJEN)</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          As publicações do Diário de Justiça Eletrônico Nacional são capturadas por número de OAB.
          Número exatamente como registrado no DJEN — inscrição suplementar leva a letra (ex.: 75503A).
        </p>

        {/* OAB principal (readonly, vinda do perfil profissional) */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
          <span className="text-muted-foreground">OAB principal:</span>
          {oabPrincipal ? (
            <span className="font-medium text-foreground">{oabPrincipal.numero} / {oabPrincipal.uf}</span>
          ) : (
            <span className="text-muted-foreground italic">não configurada</span>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">definida no Perfil profissional</span>
        </div>

        {/* Lista de OABs extras */}
        {oabs.length > 0 && (
          <div className="space-y-2">
            {oabs.map((o, i) => (
              <div key={`${o.numero}:${o.uf}:${i}`} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
                <label className="flex items-center gap-2 cursor-pointer" title={o.ativa ? 'Monitorando' : 'Desativada'}>
                  <input type="checkbox" checked={o.ativa} onChange={() => toggleOab(i)} className="h-4 w-4 accent-primary" />
                </label>
                <span className={cn('font-medium', o.ativa ? 'text-foreground' : 'text-muted-foreground line-through')}>
                  {o.numero} / {o.uf}
                </span>
                <Badge variant={o.ativa ? 'success' : 'default'} className="px-1.5 py-0 text-[10px]">
                  {o.ativa ? 'Ativa' : 'Inativa'}
                </Badge>
                <button
                  type="button"
                  onClick={() => removerOab(i)}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  aria-label={`Remover OAB ${o.numero} ${o.uf}`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remover
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Adicionar nova OAB */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <Input
              label="Número"
              placeholder="ex.: 75503A"
              value={novoNumero}
              onChange={(e) => setNovoNumero(e.target.value)}
              disabled={oabs.length >= MAX_OABS}
            />
          </div>
          <div className="w-28">
            <Select
              label="UF"
              placeholder="UF…"
              value={novaUf}
              onChange={(e) => setNovaUf(e.target.value)}
              disabled={oabs.length >= MAX_OABS}
              options={UFS_BR.map((uf) => ({ value: uf, label: uf }))}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={adicionarOab} disabled={oabs.length >= MAX_OABS}>
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
        {oabs.length >= MAX_OABS && (
          <p className="text-[11px] text-muted-foreground">Limite de {MAX_OABS} OABs atingido.</p>
        )}

        <Button size="sm" onClick={salvarOabs} disabled={salvandoOabs}>
          {salvandoOabs ? <><Spinner className="h-4 w-4" /> Salvando…</> : 'Salvar OABs'}
        </Button>
      </div>
    </div>
  )
}
