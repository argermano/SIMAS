'use client'

import { useDroppable } from '@dnd-kit/core'
import type { EtapaFunil } from '@/lib/funil/regras'
import type { LeadData } from './tipos'
import { CardLead } from './CardLead'

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export function ColunaFunil({
  etapa, label, leads, onAbrir, chatwootUrlDe,
}: {
  etapa: EtapaFunil
  label: string
  leads: LeadData[]
  onAbrir: (lead: LeadData) => void
  chatwootUrlDe: (lead: LeadData) => string | null
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa })
  const soma = leads.reduce((s, l) => s + (l.valor_estimado ?? 0), 0)

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-foreground">{label}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{leads.length}</span>
        </div>
        {soma > 0 && <span className="text-[11px] font-medium text-muted-foreground">{brl(soma)}</span>}
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 rounded-xl border p-2 transition-colors ${isOver ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-muted/20'}`}
      >
        {leads.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground/60">—</p>
        ) : (
          leads.map((lead) => (
            <CardLead key={lead.id} lead={lead} onAbrir={onAbrir} chatwootUrl={chatwootUrlDe(lead)} />
          ))
        )}
      </div>
    </div>
  )
}
