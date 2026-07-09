'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatarData } from '@/lib/utils'
import { Ban, CalendarClock, CheckCheck, Plus, Trash2, UserPlus } from 'lucide-react'
import { PRIORIDADE_OPCOES, type Prioridade, type PublicacaoDetalhe, type TeamMember } from './tipos'

/** Uma atribuição de tarefa enviada ao endpoint (acao 'tratar'). */
export interface TarefaTratamento {
  assignee_id: string
  description?: string
  due_date: string | null
  priority: Prioridade
}

export interface TratamentoPayload {
  nota?: string
  tarefas?: TarefaTratamento[]
}

const MAX_TAREFAS = 10

interface Linha {
  key: string
  assigneeId: string
  descricao: string
  prioridade: Prioridade
  dueDate: string
}

function descricaoPadrao(p: PublicacaoDetalhe): string {
  const tipo = p.tipo_documento || p.tipo_comunicacao || 'Publicação'
  const proc = p.numero_mascara || p.numero_processo || 's/ número'
  return `Publicação ${tipo} — proc. ${proc}`
}

let seq = 0
function novaLinha(p: PublicacaoDetalhe): Linha {
  return {
    key: `linha-${seq++}`,
    assigneeId: '',
    descricao: descricaoPadrao(p),
    prioridade: 'media',
    dueDate: '', // VAZIO por padrão — prazo é sempre decisão humana
  }
}

interface Props {
  publicacao: PublicacaoDetalhe
  teamMembers: TeamMember[]
  ocupado: boolean
  onConcluir: (payload: TratamentoPayload) => void
  onDescartar: () => void
}

/**
 * Painel de TRATAMENTO da publicação (estação estilo Astrea): uma nota opcional e
 * 0..10 atribuições de tarefa. "Concluir tratamento" com 0 tarefas marca a
 * publicação como Tratada (sem tarefa); com ≥1, cria as tarefas e vira Tratada
 * c/ tarefa. O prazo NUNCA vem pré-confirmado.
 */
export function PainelTratamento({ publicacao, teamMembers, ocupado, onConcluir, onDescartar }: Props) {
  const [nota, setNota] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([])

  const membroOpcoes = teamMembers.map((m) => ({ value: m.id, label: m.nome ?? 'Sem nome' }))
  const podeAdicionar = linhas.length < MAX_TAREFAS
  const faltaResponsavel = linhas.some((l) => !l.assigneeId)
  const nTarefas = linhas.length

  function adicionar() {
    setLinhas((prev) => (prev.length < MAX_TAREFAS ? [...prev, novaLinha(publicacao)] : prev))
  }
  function remover(key: string) {
    setLinhas((prev) => prev.filter((l) => l.key !== key))
  }
  function atualizar(key: string, patch: Partial<Linha>) {
    setLinhas((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function concluir() {
    if (ocupado || faltaResponsavel) return
    const tarefas: TarefaTratamento[] = linhas.map((l) => ({
      assignee_id: l.assigneeId,
      description: l.descricao.trim() || undefined,
      due_date: l.dueDate || null,
      priority: l.prioridade,
    }))
    onConcluir({ nota: nota.trim() || undefined, tarefas })
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <CheckCheck className="h-4 w-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">Tratar publicação</h3>
      </div>

      {/* Nota de tratamento (opcional) */}
      <div className="w-full space-y-1.5">
        <label htmlFor="tratamento-nota" className="block text-sm font-medium text-foreground">
          Nota de tratamento <span className="text-muted-foreground">(opcional)</span>
        </label>
        <Textarea
          id="tratamento-nota"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Observações da triagem (não vira tarefa)."
        />
      </div>

      {/* Atribuições de tarefa (0..10) */}
      <div className="space-y-3">
        {linhas.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
            Sem tarefas. Concluir assim marca a publicação como <span className="font-medium text-foreground">Tratada</span> (sem tarefa).
          </p>
        ) : (
          linhas.map((l, i) => (
            <div key={l.key} className="space-y-3 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Tarefa {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => remover(l.key)}
                  disabled={ocupado}
                  className="inline-flex items-center gap-1 rounded-md p-1 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                  aria-label={`Remover tarefa ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <Select
                label="Responsável"
                required
                placeholder="Selecione um responsável"
                value={l.assigneeId}
                onChange={(e) => atualizar(l.key, { assigneeId: e.target.value })}
                options={membroOpcoes}
                error={!l.assigneeId ? 'Escolha um responsável' : undefined}
              />

              <div className="w-full space-y-1.5">
                <label className="block text-sm font-medium text-foreground">Descrição</label>
                <Textarea
                  value={l.descricao}
                  onChange={(e) => atualizar(l.key, { descricao: e.target.value })}
                  rows={2}
                  maxLength={2000}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select
                  label="Prioridade"
                  value={l.prioridade}
                  onChange={(e) => atualizar(l.key, { prioridade: e.target.value as Prioridade })}
                  options={PRIORIDADE_OPCOES.map((p) => ({ value: p.value, label: p.label }))}
                />
                <Input
                  label="Prazo"
                  type="date"
                  value={l.dueDate}
                  onChange={(e) => atualizar(l.key, { dueDate: e.target.value })}
                  leftIcon={<CalendarClock className="h-4 w-4" />}
                />
              </div>
            </div>
          ))
        )}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={adicionar}
          disabled={ocupado || !podeAdicionar}
        >
          {linhas.length === 0 ? <UserPlus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {linhas.length === 0 ? 'Atribuir tarefa' : 'Adicionar tarefa'}
          {!podeAdicionar && ' (máx. 10)'}
        </Button>

        {publicacao.data_publicacao_sugerida && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Disponibilizada em {formatarData(publicacao.data_disponibilizacao)}; publicação presumida em{' '}
            <span className="font-medium text-foreground">{formatarData(publicacao.data_publicacao_sugerida)}</span> —
            referência apenas, defina o prazo manualmente.
          </p>
        )}
      </div>

      {/* Ações */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button onClick={concluir} loading={ocupado} disabled={faltaResponsavel}>
          <CheckCheck className="h-4 w-4" />
          Concluir tratamento{nTarefas > 0 ? ` (${nTarefas} tarefa${nTarefas > 1 ? 's' : ''})` : ''}
        </Button>
        <Button variant="ghost" onClick={onDescartar} disabled={ocupado}>
          <Ban className="h-4 w-4" /> Descartar
        </Button>
      </div>
    </section>
  )
}
