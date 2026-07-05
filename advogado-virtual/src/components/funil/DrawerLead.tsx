'use client'

import { LABELS_AREA } from '@/types'
import { LABELS_ETAPA } from '@/lib/funil/regras'
import type { LeadData } from './tipos'
import { X, MessageCircle, Calendar, Video } from 'lucide-react'

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })

// Drawer do lead. Base (Lote 3): contato, consulta, valor. O Lote 4 acrescenta
// os blocos Cliente, Documentos, timeline e as ações de geração/promoção.
export function DrawerLead({
  lead, chatwootUrl, onFechar,
}: {
  lead: LeadData
  nomeUsuario: string
  chatwootUrl: string | null
  onFechar: () => void
  onMudou: () => void
}) {
  const nome = lead.nome_informado?.trim() || lead.clientes?.nome?.trim() || lead.telefone
  const area = lead.area ? (LABELS_AREA[lead.area as keyof typeof LABELS_AREA] ?? lead.area) : null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onFechar} />
      <aside className="relative flex w-full max-w-md flex-col overflow-hidden bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-foreground">{nome}</h2>
            <p className="text-xs text-muted-foreground">{LABELS_ETAPA[lead.etapa]}{area ? ` · ${area}` : ''} · {lead.unidade}</p>
          </div>
          <button onClick={onFechar} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {/* Contato */}
          <section className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Contato</p>
            <p className="text-foreground">{lead.telefone}</p>
            {lead.email && <p className="text-muted-foreground">{lead.email}</p>}
            <div className="flex gap-3 pt-1">
              <a href={chatwootUrl ?? `https://wa.me/${lead.telefone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <MessageCircle className="h-3.5 w-3.5" /> {chatwootUrl ? 'Abrir conversa' : 'WhatsApp'}
              </a>
            </div>
          </section>

          {/* Consulta */}
          {(lead.consulta_data || lead.meet_url) && (
            <section className="space-y-1 border-t border-border/60 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Consulta</p>
              {lead.consulta_data && (
                <p className="flex items-center gap-1.5 text-foreground"><Calendar className="h-3.5 w-3.5 text-muted-foreground" /> {dataHora(lead.consulta_data)}{lead.consulta_formato ? ` · ${lead.consulta_formato}` : ''}</p>
              )}
              {lead.consulta_cancelada && <p className="text-xs text-destructive">Consulta cancelada</p>}
              {lead.meet_url && (
                <a href={lead.meet_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <Video className="h-3.5 w-3.5" /> Link da videochamada
                </a>
              )}
            </section>
          )}

          {/* Valor */}
          {lead.valor_estimado != null && (
            <section className="border-t border-border/60 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Proposta</p>
              <p className="text-base font-semibold text-foreground">{brl(lead.valor_estimado)}</p>
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}
