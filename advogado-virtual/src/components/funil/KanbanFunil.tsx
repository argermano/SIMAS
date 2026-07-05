'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { LABELS_AREA } from '@/types'
import { ORDEM_ETAPAS, LABELS_ETAPA, LABELS_MOTIVO_PERDA, type EtapaFunil, type MotivoPerda } from '@/lib/funil/regras'
import { ColunaFunil } from './ColunaFunil'
import { CardLead } from './CardLead'
import { DrawerLead } from './DrawerLead'
import type { LeadData } from './tipos'

const COLUNAS_VISIVEIS: EtapaFunil[] = [...ORDEM_ETAPAS]  // 5 etapas ativas

export type { LeadData } from './tipos'

export function KanbanFunil({
  leadsIniciais, nomeUsuario, chatwootBase, chatwootAccount,
}: {
  leadsIniciais: LeadData[]
  nomeUsuario: string
  chatwootBase: string
  chatwootAccount: string
}) {
  const router = useRouter()
  const { error: toastError, success } = useToast()
  const [leads, setLeads] = useState<LeadData[]>(leadsIniciais)
  const [ativo, setAtivo] = useState<LeadData | null>(null)
  const [selecionado, setSelecionado] = useState<LeadData | null>(null)
  const [perdidoAberto, setPerdidoAberto] = useState(false)

  // Filtros (client-side)
  const [fUnidade, setFUnidade] = useState('all')
  const [fArea, setFArea] = useState('all')
  const [fBusca, setFBusca] = useState('')
  const [fParados, setFParados] = useState(false)

  // Modais de movimentação
  const [modal, setModal] = useState<null | { tipo: 'valor' | 'motivo'; leadId: string; de: EtapaFunil }>(null)
  const [valorInput, setValorInput] = useState('')
  const [motivoInput, setMotivoInput] = useState<MotivoPerda>('sem_retorno')
  const [motivoObs, setMotivoObs] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const areasPresentes = useMemo(
    () => [...new Set(leads.map((l) => l.area).filter(Boolean))] as string[],
    [leads],
  )

  const filtrados = useMemo(() => {
    const q = fBusca.trim().toLowerCase()
    return leads.filter((l) => {
      if (fUnidade !== 'all' && l.unidade !== fUnidade) return false
      if (fArea !== 'all' && l.area !== fArea) return false
      if (fParados) {
        const dias = Math.floor((Date.now() - new Date(l.updated_at).getTime()) / 86_400_000)
        if (dias < 3) return false
      }
      if (q) {
        const alvo = `${l.nome_informado ?? ''} ${l.clientes?.nome ?? ''} ${l.telefone}`.toLowerCase()
        if (!alvo.includes(q)) return false
      }
      return true
    })
  }, [leads, fUnidade, fArea, fBusca, fParados])

  const leadsDe = useCallback((etapa: EtapaFunil) => filtrados.filter((l) => l.etapa === etapa), [filtrados])
  const chatwootUrlDe = useCallback((l: LeadData) =>
    l.chatwoot_conversation_id && chatwootBase
      ? `${chatwootBase}/app/accounts/${chatwootAccount}/conversations/${l.chatwoot_conversation_id}`
      : null,
    [chatwootBase, chatwootAccount])

  async function mover(leadId: string, para: EtapaFunil, extra: Record<string, unknown> = {}) {
    const lead = leads.find((l) => l.id === leadId)
    if (!lead || lead.etapa === para) return
    const de = lead.etapa
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, etapa: para } : l)))  // otimista
    const res = await fetch(`/api/funil/leads/${leadId}/etapa`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paraEtapa: para, ...extra }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toastError('Não foi possível mover', d.error ?? 'Tente novamente')
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, etapa: de } : l)))  // rollback
    } else {
      success('Card movido', `→ ${LABELS_ETAPA[para]}`)
      router.refresh()
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    setAtivo(null)
    const { active, over } = e
    if (!over) return
    const leadId = active.id as string
    const para = over.id as EtapaFunil
    const lead = leads.find((l) => l.id === leadId)
    if (!lead || lead.etapa === para) return

    // Etapas humanas com dados extras → modal.
    if (para === 'perdido') { setModal({ tipo: 'motivo', leadId, de: lead.etapa }); setMotivoInput('sem_retorno'); setMotivoObs(''); return }
    if (para === 'proposta_enviada') { setModal({ tipo: 'valor', leadId, de: lead.etapa }); setValorInput(lead.valor_estimado?.toString() ?? ''); return }
    mover(leadId, para)
  }

  function confirmarModal() {
    if (!modal) return
    if (modal.tipo === 'valor') {
      const valor = parseFloat(valorInput.replace(/\./g, '').replace(',', '.'))
      mover(modal.leadId, 'proposta_enviada', Number.isFinite(valor) ? { valorEstimado: valor } : {})
    } else {
      mover(modal.leadId, 'perdido', { motivoPerda: motivoInput, motivoPerdaObs: motivoObs })
    }
    setModal(null)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
        <input value={fBusca} onChange={(e) => setFBusca(e.target.value)} placeholder="Buscar nome/telefone…"
          className="w-56 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        <select value={fUnidade} onChange={(e) => setFUnidade(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
          <option value="all">Todas as unidades</option><option value="SC">SC</option><option value="DF">DF</option>
        </select>
        <select value={fArea} onChange={(e) => setFArea(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
          <option value="all">Todas as áreas</option>
          {areasPresentes.map((a) => <option key={a} value={a}>{LABELS_AREA[a as keyof typeof LABELS_AREA] ?? a}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={fParados} onChange={(e) => setFParados(e.target.checked)} /> parados +3 dias
        </label>
      </div>

      <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setAtivo(leads.find((l) => l.id === e.active.id) ?? null)} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 gap-4 overflow-x-auto p-6">
          {COLUNAS_VISIVEIS.map((etapa) => (
            <ColunaFunil key={etapa} etapa={etapa} label={LABELS_ETAPA[etapa]} leads={leadsDe(etapa)} onAbrir={setSelecionado} chatwootUrlDe={chatwootUrlDe} />
          ))}
          {/* Perdido — recolhida por padrão */}
          <ColunaFunil
            etapa="perdido" label={LABELS_ETAPA.perdido} leads={leadsDe('perdido')}
            onAbrir={setSelecionado} chatwootUrlDe={chatwootUrlDe}
            colapsavel aberto={perdidoAberto} onToggle={() => setPerdidoAberto((v) => !v)}
          />
        </div>
        <DragOverlay>{ativo ? <CardLead lead={ativo} onAbrir={() => {}} chatwootUrl={null} /> : null}</DragOverlay>
      </DndContext>

      {selecionado && (
        <DrawerLead lead={selecionado} nomeUsuario={nomeUsuario} chatwootUrl={chatwootUrlDe(selecionado)}
          onFechar={() => setSelecionado(null)} onMudou={() => router.refresh()} />
      )}

      {/* Modal de valor (proposta) / motivo (perdido) */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-elevated" onClick={(e) => e.stopPropagation()}>
            {modal.tipo === 'valor' ? (
              <>
                <h2 className="font-semibold text-foreground">Valor estimado da proposta</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Opcional — pode deixar em branco.</p>
                <input value={valorInput} onChange={(e) => setValorInput(e.target.value)} placeholder="Ex.: 3.000,00" autoFocus
                  className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              </>
            ) : (
              <>
                <h2 className="font-semibold text-foreground">Motivo da perda</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Obrigatório.</p>
                <select value={motivoInput} onChange={(e) => setMotivoInput(e.target.value as MotivoPerda)} className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  {(Object.keys(LABELS_MOTIVO_PERDA) as MotivoPerda[]).map((m) => <option key={m} value={m}>{LABELS_MOTIVO_PERDA[m]}</option>)}
                </select>
                <input value={motivoObs} onChange={(e) => setMotivoObs(e.target.value)} placeholder="Observação (opcional)"
                  className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              </>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setModal(null)}>Cancelar</Button>
              <Button size="sm" onClick={confirmarModal}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
