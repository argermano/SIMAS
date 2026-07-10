'use client'

// Orquestrador da tela /agenda: mantém filtro + data de referência + vista,
// busca /api/agenda no intervalo da vista e renderiza barra + grade.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarX2 } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { intervaloDaVista, rotuloPeriodo, chaveDia } from '@/lib/agenda/grade'
import type { EventoCalendario, FiltroAgenda, Vista, Pessoa } from '@/lib/agenda/tipos'
import { BarraTopo } from './BarraTopo'
import { GradeDia } from './GradeDia'
import { GradeSemana } from './GradeSemana'
import { GradeMes } from './GradeMes'
import { EventoModal, type AgendaEvento } from './EventoModal'

const DIA_MS = 86_400_000

/** Instante ancorado ao meio-dia de SP do dia `key` ('YYYY-MM-DD') — seguro contra virada de dia. */
function refDeChave(key: string): string {
  return new Date(`${key}T12:00:00-03:00`).toISOString()
}

function refHoje(): string {
  return refDeChave(chaveDia(new Date().toISOString()))
}

/** Desloca a data de referência conforme a vista (± um período). */
function deslocar(dataRef: string, vista: Vista, dir: number): string {
  if (vista === 'dia') return new Date(new Date(dataRef).getTime() + dir * DIA_MS).toISOString()
  if (vista === 'semana') return new Date(new Date(dataRef).getTime() + dir * 7 * DIA_MS).toISOString()
  // mês: preserva o dia (clampado ao último dia do mês alvo)
  const key = chaveDia(dataRef)
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7)) // 1..12
  const d = Number(key.slice(8, 10))
  const alvo = new Date(Date.UTC(y, m - 1 + dir, 1))
  const ay = alvo.getUTCFullYear()
  const am = alvo.getUTCMonth() // 0..11
  const ultimoDia = new Date(Date.UTC(ay, am + 1, 0)).getUTCDate()
  const dia = Math.min(d, ultimoDia)
  return refDeChave(`${ay}-${String(am + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`)
}

/** Aplica o intervalo [de,ate] da vista ao filtro. */
function comIntervalo(filtro: FiltroAgenda, vista: Vista, dataRef: string): FiltroAgenda {
  const { de, ate } = intervaloDaVista(vista, dataRef)
  return { ...filtro, vista, de, ate }
}

/** Evento repassado ao EventoModal para edição (deriva do EventoCalendario já normalizado). */
function paraEdicao(ev: EventoCalendario): AgendaEvento {
  return {
    id: ev.id.substring(ev.id.indexOf(':') + 1),
    tipo: ev.fonte as 'evento' | 'prazo' | 'audiencia',
    titulo: ev.titulo,
    descricao: ev.descricao ?? null,
    inicio: ev.inicio,
    fim: ev.fim,
    diaTodo: ev.diaTodo,
    local: ev.local ?? null,
    processo: ev.processo,
    cliente: ev.cliente,
    responsavel: ev.responsavel,
    envolvidos: ev.envolvidos,
    visibilidade: ev.visibilidade,
    status: ev.status,
    cor: ev.cor,
  }
}

const FILTRO_BASE: FiltroAgenda = {
  de: '', ate: '', vista: 'semana',
  tipos: [], status: 'todas', atribuicao: [],
  pessoas: [], equipes: [], tags: [], q: '',
}

type EstadoModal =
  | { modo: 'novo' }
  | { modo: 'editar'; evento: ReturnType<typeof paraEdicao> }
  | null

interface AgendaCalendarioProps {
  meUserId: string
  pessoas: Pessoa[]
}

export function AgendaCalendario({ meUserId, pessoas }: AgendaCalendarioProps) {
  const router = useRouter()
  const { error: toastErro } = useToast()

  const [dataRef, setDataRef] = useState<string>(() => refHoje())
  const [filtro, setFiltro] = useState<FiltroAgenda>(() => comIntervalo(FILTRO_BASE, 'semana', refHoje()))
  const [eventos, setEventos] = useState<EventoCalendario[]>([])
  const [carregando, setCarregando] = useState(false)
  const [modal, setModal] = useState<EstadoModal>(null)

  const carregar = useCallback(async (f: FiltroAgenda) => {
    setCarregando(true)
    const params = new URLSearchParams()
    params.set('de', f.de)
    params.set('ate', f.ate)
    if (f.tipos.length) params.set('tipos', f.tipos.join(','))
    params.set('status', f.status)
    if (f.atribuicao.length) params.set('atribuicao', f.atribuicao.join(','))
    if (f.pessoas.length) params.set('pessoas', f.pessoas.join(','))
    if (f.equipes.length) params.set('equipes', f.equipes.join(','))
    if (f.tags.length) params.set('tags', f.tags.join(','))
    if (f.q.trim()) params.set('q', f.q.trim())
    try {
      const res = await fetch(`/api/agenda?${params.toString()}`)
      if (!res.ok) throw new Error('Falha ao carregar a agenda')
      const dados = (await res.json()) as { eventos: EventoCalendario[] }
      setEventos(dados.eventos ?? [])
    } catch {
      toastErro('Não foi possível carregar a agenda')
    } finally {
      setCarregando(false)
    }
  }, [toastErro])

  // Debounce da busca (recarrega ~250ms após a última mudança do filtro).
  const filtroRef = useRef(filtro)
  filtroRef.current = filtro
  useEffect(() => {
    const t = setTimeout(() => { void carregar(filtroRef.current) }, 250)
    return () => clearTimeout(t)
  }, [filtro, carregar])

  // --- Navegação / vista ---
  function mudarVista(v: Vista) {
    setFiltro(f => comIntervalo(f, v, dataRef))
  }
  function irHoje() {
    const d = refHoje()
    setDataRef(d)
    setFiltro(f => comIntervalo(f, f.vista, d))
  }
  function navegar(dir: number) {
    const d = deslocar(dataRef, filtro.vista, dir)
    setDataRef(d)
    setFiltro(f => comIntervalo(f, f.vista, d))
  }

  // --- Filtros ---
  const aplicarFiltro = (patch: Partial<FiltroAgenda>) => setFiltro(f => ({ ...f, ...patch }))
  const aplicarTags = (tags: string[]) => setFiltro(f => ({ ...f, tags }))
  const buscar = (q: string) => setFiltro(f => ({ ...f, q }))

  // --- Itens ---
  function aoClicarItem(ev: EventoCalendario) {
    if (ev.fonte === 'tarefa' || ev.fonte === 'consulta') {
      router.push(ev.link)
      return
    }
    setModal({ modo: 'editar', evento: paraEdicao(ev) })
  }

  function aoSalvarEvento() {
    setModal(null)
    void carregar(filtroRef.current)
  }

  const rotulo = rotuloPeriodo(filtro.vista, dataRef)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BarraTopo
        vista={filtro.vista}
        onVista={mudarVista}
        rotulo={rotulo}
        filtro={filtro}
        pessoas={pessoas}
        onAplicarFiltro={aplicarFiltro}
        onAplicarTags={aplicarTags}
        onBusca={buscar}
        onHoje={irHoje}
        onPrev={() => navegar(-1)}
        onProx={() => navegar(1)}
        onAtualizar={() => carregar(filtro)}
        onNovo={() => setModal({ modo: 'novo' })}
        carregando={carregando}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden p-4">
        {eventos.length === 0 && !carregando && (
          <div className="pointer-events-none absolute inset-x-0 top-6 z-10 flex justify-center text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2 rounded-full bg-card/90 px-3 py-1 shadow-sm">
              <CalendarX2 className="h-4 w-4" /> Nenhum item neste período
            </span>
          </div>
        )}
        {filtro.vista === 'dia' && (
          <GradeDia dataRef={dataRef} eventos={eventos} meUserId={meUserId} onItemClick={aoClicarItem} />
        )}
        {filtro.vista === 'semana' && (
          <GradeSemana dataRef={dataRef} eventos={eventos} meUserId={meUserId} onItemClick={aoClicarItem} />
        )}
        {filtro.vista === 'mes' && (
          <GradeMes dataRef={dataRef} eventos={eventos} meUserId={meUserId} onItemClick={aoClicarItem} />
        )}
      </div>

      <EventoModal
        aberto={modal !== null}
        evento={modal?.modo === 'editar' ? modal.evento : null}
        pessoas={pessoas}
        onFechar={() => setModal(null)}
        onSalvo={aoSalvarEvento}
      />
    </div>
  )
}
