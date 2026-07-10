'use client'

import * as React from 'react'
import { Check, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, ConfirmDialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import type {
  ClienteRef,
  Pessoa,
  ProcessoRef,
  StatusItem,
  Visibilidade,
} from '@/lib/agenda/tipos'

/**
 * Registro editável de um agenda_evento (fonte 'evento'/'prazo'/'audiencia').
 * `id` é o UUID cru (sem o prefixo "fonte:") usado nas rotas PATCH/DELETE.
 */
export interface AgendaEvento {
  id: string
  tipo: 'evento' | 'prazo' | 'audiencia'
  titulo: string
  descricao?: string | null
  inicio: string
  fim: string | null
  diaTodo: boolean
  local?: string | null
  processo: ProcessoRef | null
  cliente: ClienteRef | null
  responsavel: Pessoa | null
  envolvidos: Pessoa[]
  visibilidade: Visibilidade
  status: StatusItem
  cor?: string | null
}

interface EventoModalProps {
  aberto: boolean
  evento: AgendaEvento | null
  pessoas: Pessoa[]
  onFechar: () => void
  onSalvo: () => void
}

// ─────────────────────────────────────────────────────────────
// Conversões de fuso (America/Sao_Paulo, wall-clock) na borda.
// ISO (UTC) <-> valor de <input type=datetime-local|date> em SP.
// ─────────────────────────────────────────────────────────────
const TZ = 'America/Sao_Paulo'
const _fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
})

function partesSP(d: Date): Record<string, string> {
  const p: Record<string, string> = {}
  for (const part of _fmt.formatToParts(d)) {
    if (part.type !== 'literal') p[part.type] = part.value
  }
  return p
}

function offsetMs(d: Date): number {
  const p = partesSP(d)
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return asUTC - d.getTime()
}

function paredeSPparaISO(y: number, mo: number, da: number, h: number, mi: number): string {
  const guess = Date.UTC(y, mo - 1, da, h, mi, 0, 0)
  let utc = guess - offsetMs(new Date(guess))
  utc = guess - offsetMs(new Date(utc)) // refina p/ transições
  return new Date(utc).toISOString()
}

function isoParaLocalSP(iso: string): string {
  const p = partesSP(new Date(iso))
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

function isoParaDataSP(iso: string): string {
  const p = partesSP(new Date(iso))
  return `${p.year}-${p.month}-${p.day}`
}

function localSPparaISO(local: string): string {
  const [d, t] = local.split('T')
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi] = (t || '00:00').split(':').map(Number)
  return paredeSPparaISO(y, mo, da, h, mi)
}

function dataSPparaISO(data: string, fimDoDia: boolean): string {
  const [y, mo, da] = data.split('-').map(Number)
  return fimDoDia ? paredeSPparaISO(y, mo, da, 23, 59) : paredeSPparaISO(y, mo, da, 0, 0)
}

const TIPO_OPTS = [
  { value: 'evento', label: 'Evento' },
  { value: 'prazo', label: 'Prazo' },
  { value: 'audiencia', label: 'Audiência' },
]
const VISIBILIDADE_OPTS = [
  { value: 'escritorio', label: 'Escritório' },
  { value: 'particular', label: 'Particular' },
]
const STATUS_OPTS = [
  { value: 'a_concluir', label: 'A concluir' },
  { value: 'concluida', label: 'Concluída' },
  { value: 'cancelada', label: 'Cancelada' },
]

export function EventoModal({ aberto, evento, pessoas, onFechar, onSalvo }: EventoModalProps) {
  const toast = useToast()
  const editando = !!evento

  const [tipo, setTipo] = React.useState<AgendaEvento['tipo']>('evento')
  const [titulo, setTitulo] = React.useState('')
  const [descricao, setDescricao] = React.useState('')
  const [diaTodo, setDiaTodo] = React.useState(false)
  const [inicio, setInicio] = React.useState('') // datetime-local ou date (SP)
  const [fim, setFim] = React.useState('')
  const [local, setLocal] = React.useState('')
  const [responsavelId, setResponsavelId] = React.useState('')
  const [envolvidos, setEnvolvidos] = React.useState<string[]>([])
  const [visibilidade, setVisibilidade] = React.useState<Visibilidade>('escritorio')
  const [status, setStatus] = React.useState<StatusItem>('a_concluir')

  const [erro, setErro] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const [confirmarExcluir, setConfirmarExcluir] = React.useState(false)
  const [excluindo, setExcluindo] = React.useState(false)

  // (Re)inicializa o formulário quando abre.
  React.useEffect(() => {
    if (!aberto) return
    setErro(null)
    setConfirmarExcluir(false)
    if (evento) {
      setTipo(evento.tipo)
      setTitulo(evento.titulo)
      setDescricao(evento.descricao ?? '')
      setDiaTodo(evento.diaTodo)
      setInicio(evento.diaTodo ? isoParaDataSP(evento.inicio) : isoParaLocalSP(evento.inicio))
      setFim(
        evento.fim
          ? evento.diaTodo
            ? isoParaDataSP(evento.fim)
            : isoParaLocalSP(evento.fim)
          : ''
      )
      setLocal(evento.local ?? '')
      setResponsavelId(evento.responsavel?.id ?? '')
      setEnvolvidos(evento.envolvidos.map(p => p.id))
      setVisibilidade(evento.visibilidade)
      setStatus(evento.status)
    } else {
      setTipo('evento')
      setTitulo('')
      setDescricao('')
      setDiaTodo(false)
      setInicio('')
      setFim('')
      setLocal('')
      setResponsavelId('')
      setEnvolvidos([])
      setVisibilidade('escritorio')
      setStatus('a_concluir')
    }
  }, [aberto, evento])

  function toggleEnvolvido(id: string) {
    setEnvolvidos(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  async function salvar() {
    setErro(null)
    if (!titulo.trim()) {
      setErro('Informe um título.')
      return
    }
    if (!inicio) {
      setErro('Informe a data/hora de início.')
      return
    }
    const inicioISO = diaTodo ? dataSPparaISO(inicio, false) : localSPparaISO(inicio)
    const fimISO = fim ? (diaTodo ? dataSPparaISO(fim, true) : localSPparaISO(fim)) : null
    if (fimISO && new Date(fimISO).getTime() < new Date(inicioISO).getTime()) {
      setErro('O fim deve ser posterior ao início.')
      return
    }

    // `status` NÃO vai no payload de criar/editar (os schemas o ignoram): a
    // conclusão/cancelamento é persistida pela rota dedicada /status abaixo.
    const payload = {
      tipo,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      dia_todo: diaTodo,
      inicio: inicioISO,
      fim: fimISO,
      local: local.trim() || null,
      responsavel_id: responsavelId || null,
      envolvidos,
      visibilidade,
      process_id: evento?.processo?.id ?? null,
      cliente_id: evento?.cliente?.id ?? null,
    }

    setSalvando(true)
    try {
      const url = editando ? `/api/agenda/eventos/${evento!.id}` : '/api/agenda/eventos'
      const res = await fetch(url, {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Não foi possível salvar o evento.')
      }

      // Persiste mudança de status via rota dedicada, se o status escolhido
      // difere do original (novo evento nasce 'a_concluir').
      const statusOriginal: StatusItem = evento?.status ?? 'a_concluir'
      if (status !== statusOriginal) {
        const dados = (await res.json().catch(() => null)) as { evento?: { id?: string } } | null
        const eventoId = editando ? evento!.id : dados?.evento?.id
        if (eventoId) {
          const acao =
            status === 'concluida' ? 'concluir' : status === 'cancelada' ? 'cancelar' : 'reabrir'
          const resStatus = await fetch(`/api/agenda/eventos/${eventoId}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao }),
          })
          if (!resStatus.ok) {
            const data = await resStatus.json().catch(() => null)
            throw new Error(data?.error || 'Não foi possível atualizar o status.')
          }
        }
      }

      toast.success(editando ? 'Evento atualizado' : 'Evento criado')
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir() {
    if (!evento) return
    setExcluindo(true)
    try {
      const res = await fetch(`/api/agenda/eventos/${evento.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Não foi possível excluir o evento.')
      }
      toast.success('Evento excluído')
      setConfirmarExcluir(false)
      onSalvo()
    } catch (e) {
      toast.error('Erro', e instanceof Error ? e.message : undefined)
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <>
      <Dialog
        open={aberto}
        onClose={onFechar}
        title={editando ? 'Editar evento' : 'Novo evento'}
        size="lg"
        footer={
          <>
            {editando && (
              <Button
                type="button"
                variant="danger"
                size="md"
                onClick={() => setConfirmarExcluir(true)}
                className="mr-auto"
                disabled={salvando}
              >
                <Trash2 className="h-4 w-4" />
                Excluir
              </Button>
            )}
            <Button type="button" variant="secondary" size="md" onClick={onFechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="button" variant="default" size="md" onClick={salvar} loading={salvando}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Tipo"
            options={TIPO_OPTS}
            value={tipo}
            onChange={e => setTipo(e.target.value as AgendaEvento['tipo'])}
          />

          <Input
            label="Título"
            required
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            placeholder="Título do evento"
          />

          <Textarea
            label="Descrição"
            value={descricao}
            onChange={e => setDescricao(e.target.value)}
            placeholder="Detalhes (opcional)"
            className="min-h-[80px]"
          />

          <label className="flex cursor-pointer items-center gap-2 text-base font-medium text-foreground">
            <span
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                diaTodo ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
              )}
              aria-hidden
            >
              {diaTodo && <Check className="h-3 w-3" />}
            </span>
            <input
              type="checkbox"
              className="sr-only"
              checked={diaTodo}
              onChange={e => setDiaTodo(e.target.checked)}
            />
            Dia todo
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="w-full space-y-1.5">
              <label className="block text-base font-medium text-foreground">
                Início<span className="ml-1 text-destructive">*</span>
              </label>
              <input
                type={diaTodo ? 'date' : 'datetime-local'}
                value={inicio}
                onChange={e => setInicio(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="w-full space-y-1.5">
              <label className="block text-base font-medium text-foreground">Fim</label>
              <input
                type={diaTodo ? 'date' : 'datetime-local'}
                value={fim}
                onChange={e => setFim(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <Input
            label="Local"
            value={local}
            onChange={e => setLocal(e.target.value)}
            placeholder="Local (opcional)"
          />

          <Select
            label="Responsável"
            options={[{ value: '', label: 'Ninguém' }, ...pessoas.map(p => ({ value: p.id, label: p.nome }))]}
            value={responsavelId}
            onChange={e => setResponsavelId(e.target.value)}
          />

          <div className="w-full space-y-1.5">
            <label className="block text-base font-medium text-foreground">Envolvidos</label>
            {pessoas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem pessoas disponíveis</p>
            ) : (
              <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-input p-1">
                {pessoas.map(p => {
                  const marcado = envolvidos.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleEnvolvido(p.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted transition-colors"
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                          marcado ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                        )}
                        aria-hidden
                      >
                        {marcado && <Check className="h-3 w-3" />}
                      </span>
                      <span className="flex-1 truncate">{p.nome}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {(evento?.processo || evento?.cliente) && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {evento?.processo && <p>Processo: {evento.processo.titulo || evento.processo.numero}</p>}
              {evento?.cliente && <p>Cliente: {evento.cliente.nome}</p>}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Visibilidade"
              options={VISIBILIDADE_OPTS}
              value={visibilidade}
              onChange={e => setVisibilidade(e.target.value as Visibilidade)}
            />
            <Select
              label="Status"
              options={STATUS_OPTS}
              value={status}
              onChange={e => setStatus(e.target.value as StatusItem)}
            />
          </div>

          {erro && (
            <p className="text-sm text-destructive" role="alert">
              {erro}
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmarExcluir}
        onClose={() => setConfirmarExcluir(false)}
        onConfirm={excluir}
        title="Excluir evento"
        description="Tem certeza que deseja excluir este evento? Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
        loading={excluindo}
      />
    </>
  )
}
