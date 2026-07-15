'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  MoreVertical, Loader2, Lock, Unlock, ArrowRightLeft, Printer, Trash2, Link2, Settings2,
} from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { VinculoPicker, type VinculoSelecionado } from '@/components/tarefas/VinculoPicker'

interface AcoesAtendimentoProps {
  atendimentoId: string
  clienteId: string
  estagio: 'atendimento' | 'caso'
  encerrado: boolean
  /** Vínculo atual (057) para pré-carregar o mini-modal de "Vincular…". */
  vinculoAtual?: VinculoSelecionado | null
  /**
   * 'menu' (padrão): botão ⋮ com popover. 'lista': card "Ações" com os mesmos
   * itens em coluna vertical (sidebar do caso, layout 2 colunas / Astrea).
   */
  variant?: 'menu' | 'lista'
}

// Menu de ações do atendimento/caso (encerrar/reabrir, transformar em caso,
// vincular, imprimir ficha, excluir). As transições passam pelo PATCH { acao } — o
// servidor centraliza as validações (não encerrar já-encerrado, estágio one-way).
export function AcoesAtendimento({ atendimentoId, clienteId, estagio, encerrado, vinculoAtual, variant = 'menu' }: AcoesAtendimentoProps) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [vincOpen, setVincOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora
  useEffect(() => {
    if (!aberto) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [aberto])

  async function acao(acao: 'encerrar' | 'reabrir' | 'transformar_caso', confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      })
      if (res.ok) {
        setAberto(false)
        router.refresh()
      }
    } catch { /* silencioso */ } finally {
      setBusy(false)
    }
  }

  async function excluir() {
    if (!window.confirm('Excluir este atendimento? Ele sairá das listagens (as peças, documentos e o áudio são preservados). Confirmar?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/atendimentos/${atendimentoId}`, { method: 'DELETE' })
      if (res.ok) {
        router.push(`/clientes/${clienteId}`)
      }
    } catch { /* silencioso */ } finally {
      setBusy(false)
    }
  }

  const itemCls =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors'

  // Itens compartilhados entre o popover (variant 'menu') e o card vertical
  // (variant 'lista'). O `fecharDepois` só é relevante no popover.
  const itens = (fecharDepois: () => void) => (
    <>
      {/* Encerrar / Reabrir */}
      {encerrado ? (
        <button className={itemCls} disabled={busy} onClick={() => acao('reabrir')}>
          <Unlock className="h-4 w-4 text-muted-foreground" /> Reabrir atendimento
        </button>
      ) : (
        <button className={itemCls} disabled={busy} onClick={() => acao('encerrar', 'Encerrar este atendimento?')}>
          <Lock className="h-4 w-4 text-muted-foreground" /> Encerrar
        </button>
      )}

      {/* Transformar em caso — só quando ainda é atendimento (one-way) */}
      {estagio === 'atendimento' && (
        <button
          className={itemCls}
          disabled={busy}
          onClick={() => acao('transformar_caso', 'Transformar este atendimento em caso? Esta ação não pode ser desfeita.')}
        >
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" /> Transformar em caso
        </button>
      )}

      {/* Vincular a outro caso/atendimento ou processo (057) */}
      <button
        className={itemCls}
        disabled={busy}
        onClick={() => { fecharDepois(); setVincOpen(true) }}
      >
        <Link2 className="h-4 w-4 text-muted-foreground" /> {vinculoAtual ? 'Editar vínculo' : 'Vincular…'}
      </button>

      {/* Imprimir ficha */}
      <Link
        href={`/clientes/${clienteId}/casos/${atendimentoId}/ficha`}
        className={itemCls}
        onClick={fecharDepois}
      >
        <Printer className="h-4 w-4 text-muted-foreground" /> Imprimir ficha
      </Link>

      <div className="my-1 border-t border-border" />

      {/* Excluir — confirmação forte */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
        disabled={busy}
        onClick={excluir}
      >
        <Trash2 className="h-4 w-4" /> Excluir atendimento
      </button>
    </>
  )

  const modal = vincOpen && (
    <VincularModal
      atendimentoId={atendimentoId}
      vinculoAtual={vinculoAtual ?? null}
      onClose={() => setVincOpen(false)}
      onSaved={() => { setVincOpen(false); router.refresh() }}
    />
  )

  // Variant 'lista': card "Ações" com os itens em coluna (sidebar do caso).
  if (variant === 'lista') {
    return (
      <>
        {modal}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Ações</p>
            {busy && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex flex-col py-1">
            {itens(() => {})}
          </div>
        </Card>
      </>
    )
  }

  // Variant 'menu' (padrão): botão ⋮ com popover.
  return (
    <div className="relative" ref={ref}>
      {modal}
      <button
        onClick={() => setAberto((v) => !v)}
        disabled={busy}
        aria-label="Ações do atendimento"
        title="Ações"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </button>

      {aberto && (
        <div className="absolute right-0 z-40 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg">
          {itens(() => setAberto(false))}
        </div>
      )}
    </div>
  )
}

// Mini-modal de vínculo (057): escolhe outro caso/atendimento ou processo e
// aplica via PATCH { vinculo }. "Remover vínculo" envia null.
function VincularModal({
  atendimentoId, vinculoAtual, onClose, onSaved,
}: {
  atendimentoId: string
  vinculoAtual: VinculoSelecionado | null
  onClose: () => void
  onSaved: () => void
}) {
  const [sel, setSel] = useState<VinculoSelecionado | null>(vinculoAtual)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function patch(vinculo: { tipo: string; id: string } | null) {
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vinculo }),
      })
      if (res.ok) { onSaved(); return }
      const j = await res.json().catch(() => null)
      setErro(j?.error ?? 'Não foi possível salvar o vínculo.')
    } catch {
      setErro('Verifique a conexão e tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Vincular atendimento"
      description="Relacione este caso a outro atendimento ou a um processo."
      footer={
        <>
          {vinculoAtual && (
            <Button variant="secondary" size="md" onClick={() => patch(null)} disabled={salvando}>
              Remover vínculo
            </Button>
          )}
          <Button
            size="md"
            loading={salvando}
            disabled={salvando || !sel || (sel.tipo === vinculoAtual?.tipo && sel.id === vinculoAtual?.id)}
            onClick={() => sel && patch({ tipo: sel.tipo, id: sel.id })}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <VinculoPicker
          label="Caso, atendimento ou processo"
          value={sel}
          onChange={setSel}
          tipos={['atendimento', 'processo']}
        />
        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </div>
    </Dialog>
  )
}
