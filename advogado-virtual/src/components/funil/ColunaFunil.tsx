'use client'

import { useDroppable } from '@dnd-kit/core'
import type { EtapaFunil } from '@/lib/funil/regras'
import type { LeadData } from './tipos'
import { CardLead } from './CardLead'
import { CORES_ETAPA, brl } from './estilos'
import { ChevronDown, ChevronRight } from 'lucide-react'

export function ColunaFunil({
  etapa, label, leads, onAbrir, chatwootUrlDe,
  colapsavel = false, aberto = true, onToggle,
}: {
  etapa: EtapaFunil
  label: string
  leads: LeadData[]
  onAbrir: (lead: LeadData) => void
  chatwootUrlDe: (lead: LeadData) => string | null
  colapsavel?: boolean
  aberto?: boolean
  onToggle?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa })
  const soma = leads.reduce((s, l) => s + (l.valor_estimado ?? 0), 0)
  const cores = CORES_ETAPA[etapa]

  return (
    <div className={`flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-border/50 ${cores.body}`}>
      {/* Cabeçalho colorido */}
      <button
        type="button"
        onClick={colapsavel ? onToggle : undefined}
        className={`flex items-center gap-2 px-3 py-2.5 text-white ${cores.header} ${colapsavel ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {colapsavel && (aberto ? <ChevronDown className="h-4 w-4 opacity-90" /> : <ChevronRight className="h-4 w-4 opacity-90" />)}
        <span className="text-sm font-semibold tracking-tight">{label}</span>
        <span className="rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-bold">{leads.length}</span>
        {soma > 0 && (
          <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold tabular-nums">{brl(soma)}</span>
        )}
      </button>

      {/* Corpo droppable */}
      {(!colapsavel || aberto) && (
        <div
          ref={setNodeRef}
          className={`flex-1 space-y-2.5 p-2.5 transition-colors ${isOver ? 'bg-black/[0.03] dark:bg-white/[0.04]' : ''}`}
        >
          {leads.length === 0 ? (
            <p className="px-1 py-8 text-center text-xs text-muted-foreground/50">Nada por aqui</p>
          ) : (
            leads.map((lead) => (
              <CardLead key={lead.id} lead={lead} onAbrir={onAbrir} chatwootUrl={chatwootUrlDe(lead)} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
