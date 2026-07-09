'use client'

import { useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { formatarData } from '@/lib/utils'
import { CalendarClock } from 'lucide-react'
import { PRIORIDADE_OPCOES, type PublicacaoDetalhe, type TeamMember } from './tipos'

interface Props {
  open: boolean
  onClose: () => void
  publicacao: PublicacaoDetalhe
  teamMembers: TeamMember[]
  onCriada: (taskId?: string) => void
}

function descricaoPadrao(p: PublicacaoDetalhe): string {
  const tipo = p.tipo_documento || p.tipo_comunicacao || 'Publicação'
  const proc = p.numero_mascara || p.numero_processo || 's/ número'
  return `Publicação ${tipo} — proc. ${proc}`
}

export function CriarTarefaModal({ open, onClose, publicacao, teamMembers, onCriada }: Props) {
  const { success, error: toastError } = useToast()
  const [descricao, setDescricao] = useState(() => descricaoPadrao(publicacao))
  const [assigneeId, setAssigneeId] = useState('')
  const [prioridade, setPrioridade] = useState<string>('media')
  const [dueDate, setDueDate] = useState('') // vazia por padrão — prazo é decisão humana
  const [salvando, setSalvando] = useState(false)

  async function criar() {
    if (!assigneeId) return
    setSalvando(true)
    try {
      const r = await fetch(`/api/publicacoes/${publicacao.id}/triar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'tarefa',
          tarefa: {
            assignee_id: assigneeId,
            description: descricao.trim() || undefined,
            due_date: dueDate || null,
            priority: prioridade,
          },
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível criar a tarefa', d.error ?? 'Tente novamente.')
        return
      }
      success('Tarefa criada no Kanban', 'Acompanhe em Tarefas (/tarefas).')
      onCriada(d.task_id)
    } finally {
      setSalvando(false)
    }
  }

  const membroOpcoes = teamMembers.map((m) => ({ value: m.id, label: m.nome ?? 'Sem nome' }))

  return (
    <Dialog
      open={open}
      onClose={salvando ? () => {} : onClose}
      title="Criar tarefa a partir da publicação"
      description="Defina o responsável e o prazo. O prazo NÃO é calculado automaticamente."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={criar} loading={salvando} disabled={!assigneeId}>
            Criar tarefa
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="w-full space-y-1.5">
          <label htmlFor="tarefa-descricao" className="block text-base font-medium text-foreground">
            Descrição
          </label>
          <Textarea
            id="tarefa-descricao"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={2}
          />
        </div>

        <Select
          label="Responsável"
          required
          placeholder="Selecione um responsável"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          options={membroOpcoes}
        />

        <Select
          label="Prioridade"
          value={prioridade}
          onChange={(e) => setPrioridade(e.target.value)}
          options={PRIORIDADE_OPCOES.map((p) => ({ value: p.value, label: p.label }))}
        />

        <Input
          label="Data-limite (prazo)"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          hint="Deixe em branco e defina o prazo manualmente. O sistema não calcula prazos."
          leftIcon={<CalendarClock className="h-4 w-4" />}
        />

        {publicacao.data_publicacao_sugerida && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Disponibilizada em {formatarData(publicacao.data_disponibilizacao)}; publicação presumida em{' '}
            <span className="font-medium text-foreground">{formatarData(publicacao.data_publicacao_sugerida)}</span> —
            referência apenas, defina o prazo manualmente.
          </p>
        )}
      </div>
    </Dialog>
  )
}
