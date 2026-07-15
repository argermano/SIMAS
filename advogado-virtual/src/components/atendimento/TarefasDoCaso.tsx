'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TaskFormModal } from '@/components/tarefas/TaskFormModal'
import { ListChecks, Plus, User, CalendarClock } from 'lucide-react'

export interface TarefaDoCaso {
  id: string
  description: string
  due_date: string | null
  priority: string
  completed_at: string | null
  assignee: { id: string; nome: string | null } | null
  coluna: { id: string; name: string } | null
}

interface TeamMember { id: string; nome: string }

interface TarefasDoCasoProps {
  atendimentoId: string
  /** Rótulo/sub p/ pré-vincular a nova tarefa a ESTE caso (vínculo 'atendimento', 054). */
  vinculoLabel: string
  vinculoSublabel: string | null
  teamMembers: TeamMember[]
  currentUserId: string
  currentUserName: string
  tarefas: TarefaDoCaso[]
}

const PRIORIDADE: Record<string, { label: string; variant: 'secondary' | 'warning' | 'danger' }> = {
  baixa:   { label: 'Baixa',   variant: 'secondary' },
  media:   { label: 'Média',   variant: 'secondary' },
  alta:    { label: 'Alta',    variant: 'warning'   },
  urgente: { label: 'Urgente', variant: 'danger'    },
}

function formatarPrazo(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function TarefasDoCaso({
  atendimentoId, vinculoLabel, vinculoSublabel,
  teamMembers, currentUserId, currentUserName, tarefas,
}: TarefasDoCasoProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)

  // Incompletas primeiro; dentro de cada grupo, por prazo (mais próximo antes).
  const ordenadas = [...tarefas].sort((a, b) => {
    const ca = a.completed_at ? 1 : 0
    const cb = b.completed_at ? 1 : 0
    if (ca !== cb) return ca - cb
    const da = a.due_date ? new Date(a.due_date).getTime() : Infinity
    const db = b.due_date ? new Date(b.due_date).getTime() : Infinity
    return da - db
  })

  const hoje = Date.now()

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListChecks className="h-5 w-5 text-muted-foreground" />
          Tarefas
          {tarefas.length > 0 && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">({tarefas.length})</span>
          )}
        </CardTitle>
        <button
          onClick={() => setFormOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Nova tarefa
        </button>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {ordenadas.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">Nenhuma tarefa vinculada a este caso.</p>
        ) : (
          ordenadas.map((t) => {
            const concluida = !!t.completed_at
            const atrasada = !concluida && t.due_date && new Date(t.due_date).getTime() < hoje
            const prio = PRIORIDADE[t.priority] ?? PRIORIDADE.media
            return (
              <div
                key={t.id}
                className="flex items-start justify-between gap-3 rounded-lg border bg-card px-3 py-2.5"
              >
                <div className="min-w-0 space-y-1">
                  <p className={`text-sm font-medium ${concluida ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                    {t.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {t.assignee?.nome && (
                      <span className="flex items-center gap-1"><User className="h-3 w-3" /> {t.assignee.nome}</span>
                    )}
                    {t.due_date && (
                      <span className={`flex items-center gap-1 ${atrasada ? 'font-semibold text-destructive' : ''}`}>
                        <CalendarClock className="h-3 w-3" /> {formatarPrazo(t.due_date)}
                      </span>
                    )}
                  </div>
                </div>
                <Badge
                  variant={concluida ? 'success' : prio.variant}
                  className="shrink-0 px-1.5 py-0 text-[10px]"
                >
                  {concluida ? 'Concluída' : (t.coluna?.name ?? prio.label)}
                </Badge>
              </div>
            )
          })
        )}
      </CardContent>

      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); router.refresh() }}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        teamMembers={teamMembers}
        // Pré-vincula a nova tarefa a ESTE caso (vínculo 'atendimento', migr. 054).
        defaultVinculo={{ tipo: 'atendimento', id: atendimentoId, label: vinculoLabel, sublabel: vinculoSublabel }}
      />
    </Card>
  )
}
