'use client'

import { useDraggable } from '@dnd-kit/core'
import { LABELS_AREA } from '@/types'
import type { LeadData } from './tipos'
import { MessageCircle, User, AlertTriangle, Clock, XCircle, TrendingDown, UserCheck } from 'lucide-react'

const nomeArea = (a: string | null) => (a ? (LABELS_AREA[a as keyof typeof LABELS_AREA] ?? a) : null)

function diasDesde(iso: string | null): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export function CardLead({
  lead, onAbrir, chatwootUrl,
}: {
  lead: LeadData
  onAbrir: (lead: LeadData) => void
  chatwootUrl: string | null
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id })
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined

  const nome = lead.nome_informado?.trim() || lead.clientes?.nome?.trim() || lead.telefone
  const dias = diasDesde(lead.updated_at)
  const paradoNovoLead = lead.etapa === 'novo_lead' && dias >= 3
  const clienteAtivo = lead.clientes?.status_cadastro === 'ativo'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow ${isDragging ? 'opacity-50' : 'hover:shadow-card-hover'}`}
    >
      {/* Área de arraste + abrir */}
      <div {...attributes} {...listeners} onClick={() => onAbrir(lead)} className="cursor-grab active:cursor-grabbing">
        <p className="truncate text-sm font-semibold text-foreground">{nome}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {nomeArea(lead.area) && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{nomeArea(lead.area)}</span>
          )}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{lead.unidade}</span>
          <span className="text-[10px] text-muted-foreground">{dias}d</span>
        </div>

        {/* Badges */}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {paradoNovoLead && <Badge cor="warning" Icon={AlertTriangle}>parado {dias}d</Badge>}
          {lead.aguardando_confirmacao && <Badge cor="info" Icon={Clock}>aguardando confirmação</Badge>}
          {lead.consulta_cancelada && <Badge cor="destructive" Icon={XCircle}>consulta cancelada</Badge>}
          {lead.sugerir_perda && <Badge cor="warning" Icon={TrendingDown}>sugerir perda</Badge>}
          {clienteAtivo && <Badge cor="success" Icon={UserCheck}>cliente existente</Badge>}
        </div>
      </div>

      {/* Ações rápidas (não arrastam) */}
      <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2">
        {chatwootUrl ? (
          <a href={chatwootUrl} target="_blank" rel="noopener noreferrer" title="Abrir conversa"
            className="text-muted-foreground hover:text-primary" onClick={(e) => e.stopPropagation()}>
            <MessageCircle className="h-4 w-4" />
          </a>
        ) : (
          <a href={`https://wa.me/${lead.telefone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" title="WhatsApp"
            className="text-muted-foreground hover:text-primary" onClick={(e) => e.stopPropagation()}>
            <MessageCircle className="h-4 w-4" />
          </a>
        )}
        {lead.clientes && (
          <a href={`/clientes/${lead.clientes.id}`} title="Abrir cadastro do cliente"
            className="text-muted-foreground hover:text-primary" onClick={(e) => e.stopPropagation()}>
            <User className="h-4 w-4" />
          </a>
        )}
        {lead.valor_estimado != null && (
          <span className="ml-auto text-xs font-semibold text-foreground">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.valor_estimado)}
          </span>
        )}
      </div>
    </div>
  )
}

function Badge({ cor, Icon, children }: { cor: 'warning' | 'info' | 'destructive' | 'success'; Icon: typeof AlertTriangle; children: React.ReactNode }) {
  const cores = {
    warning: 'bg-warning/10 text-warning',
    info: 'bg-info/10 text-info',
    destructive: 'bg-destructive/10 text-destructive',
    success: 'bg-success/10 text-success',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${cores[cor]}`}>
      <Icon className="h-3 w-3" /> {children}
    </span>
  )
}
