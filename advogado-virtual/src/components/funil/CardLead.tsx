'use client'

import { useDraggable } from '@dnd-kit/core'
import { LABELS_AREA } from '@/types'
import { iniciais } from '@/lib/utils'
import type { LeadData } from './tipos'
import { CORES_ETAPA, corArea, corAvatar, estiloOrigem, tempoRelativo, brl } from './estilos'
import { MessageCircle, User, AlertTriangle, Clock, XCircle, TrendingDown, UserCheck, CalendarDays, CornerDownRight } from 'lucide-react'

const nomeArea = (a: string | null) => (a ? (LABELS_AREA[a as keyof typeof LABELS_AREA] ?? a) : null)
const consultaCurta = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

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
  const ini = iniciais(nome) || nome.replace(/\D/g, '').slice(-2) || '#'
  const dias = diasDesde(lead.updated_at)
  const paradoNovoLead = lead.etapa === 'novo_lead' && dias >= 3
  const clienteAtivo = lead.clientes?.status_cadastro === 'ativo'
  const origem = estiloOrigem(lead.origem)
  const tint = CORES_ETAPA[lead.etapa]?.cardTint ?? ''
  const ehResposta = lead.ultima_mensagem_autor === 'atendente' || lead.ultima_mensagem_autor === 'ia'
  const autorMensagem = lead.ultima_mensagem_autor === 'atendente' ? 'Escritório'
    : lead.ultima_mensagem_autor === 'ia' ? 'Assistente' : 'Cliente'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-xl border p-3 shadow-sm ring-1 ring-transparent transition-all ${tint || 'bg-card border-border/70'} ${isDragging ? 'rotate-1 opacity-60 shadow-lg' : 'hover:-translate-y-0.5 hover:shadow-md hover:ring-border'}`}
    >
      {/* Cabeçalho arrastável: avatar + nome + tempo */}
      <div {...attributes} {...listeners} onClick={() => onAbrir(lead)} className="cursor-grab active:cursor-grabbing">
        <div className="flex items-start gap-2.5">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm ${corAvatar(nome)}`}>
            {ini}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">{nome}</p>
            <p className="text-[11px] text-muted-foreground">{tempoRelativo(lead.updated_at)}</p>
          </div>
        </div>

        {/* Última interação do WhatsApp (sistema fechado, cliente↔escritório) */}
        {lead.ultima_mensagem && (
          <div className={`mt-2 rounded-lg px-2.5 py-1.5 ${ehResposta ? 'bg-primary/10' : 'bg-muted/70'}`}>
            <p className="line-clamp-2 text-[11px] leading-snug text-foreground/85">{lead.ultima_mensagem}</p>
            <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              {ehResposta ? <CornerDownRight className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
              {autorMensagem}{lead.ultima_mensagem_em ? ` · ${tempoRelativo(lead.ultima_mensagem_em)}` : ''}
            </p>
          </div>
        )}

        {/* Linha de contexto: consulta agendada, se houver */}
        {lead.consulta_data && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> {consultaCurta(lead.consulta_data)}{lead.consulta_formato ? ` · ${lead.consulta_formato}` : ''}
          </p>
        )}

        {/* Tags: área · unidade · origem · valor */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {nomeArea(lead.area) && (
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${corArea(lead.area)}`}>{nomeArea(lead.area)}</span>
          )}
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{lead.unidade}</span>
          {origem && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <span className={`h-1.5 w-1.5 rounded-full ${origem.dot}`} /> {origem.label}
            </span>
          )}
          {lead.valor_estimado != null && (
            <span className="ml-auto rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {brl(lead.valor_estimado)}
            </span>
          )}
        </div>

        {/* Badges de estado */}
        {(paradoNovoLead || lead.aguardando_confirmacao || lead.consulta_cancelada || lead.sugerir_perda || clienteAtivo) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {paradoNovoLead && <Badge cor="warning" Icon={AlertTriangle}>parado {dias}d</Badge>}
            {lead.aguardando_confirmacao && <Badge cor="info" Icon={Clock}>aguardando confirmação</Badge>}
            {lead.consulta_cancelada && <Badge cor="destructive" Icon={XCircle}>consulta cancelada</Badge>}
            {lead.sugerir_perda && <Badge cor="warning" Icon={TrendingDown}>sugerir perda</Badge>}
            {clienteAtivo && <Badge cor="success" Icon={UserCheck}>cliente</Badge>}
          </div>
        )}
      </div>

      {/* Ações rápidas (não arrastam) — só ícone, tooltip no hover */}
      <div className="mt-2.5 flex items-center gap-1 border-t border-border/50 pt-2">
        <a
          href={chatwootUrl ?? `https://wa.me/${lead.telefone.replace(/\D/g, '')}`}
          target="_blank" rel="noopener noreferrer" title={chatwootUrl ? 'Abrir no Chatwoot' : 'Abrir no WhatsApp'}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          <MessageCircle className="h-4 w-4" />
        </a>
        {lead.clientes && (
          <a href={`/clientes/${lead.clientes.id}`} title="Abrir cadastro do cliente"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
            onClick={(e) => e.stopPropagation()}>
            <User className="h-4 w-4" />
          </a>
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
