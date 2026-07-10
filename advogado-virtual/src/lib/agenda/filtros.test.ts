import { describe, it, expect } from 'vitest'
import { aplicaFiltros } from './filtros'
import type { EventoCalendario, FiltroAgenda } from './tipos'

const ME = 'me'

function ev(over: Partial<EventoCalendario>): EventoCalendario {
  return {
    id: 'x',
    fonte: 'tarefa',
    titulo: 'Item',
    inicio: '2026-07-09T12:00:00.000Z',
    fim: null,
    diaTodo: true,
    status: 'a_concluir',
    prioridade: null,
    responsavel: null,
    envolvidos: [],
    processo: null,
    cliente: null,
    cor: '#000',
    tags: [],
    visibilidade: 'escritorio',
    criadoPor: null,
    meetUrl: null,
    link: '#',
    ...over,
  }
}

function filtro(over: Partial<FiltroAgenda>): FiltroAgenda {
  return {
    de: '2026-07-01T00:00:00.000Z',
    ate: '2026-07-31T23:59:59.999Z',
    vista: 'mes',
    tipos: [],
    status: 'todas',
    atribuicao: [],
    pessoas: [],
    equipes: [],
    tags: [],
    q: '',
    ...over,
  }
}

const ids = (l: EventoCalendario[]) => l.map(e => e.id)

describe('aplicaFiltros — visibilidade particular (invariante dura)', () => {
  const particularDeOutro = ev({ id: 'p1', visibilidade: 'particular', criadoPor: 'outro' })
  const particularMeu = ev({ id: 'p2', visibilidade: 'particular', criadoPor: ME })
  const escritorio = ev({ id: 'e1', visibilidade: 'escritorio', criadoPor: 'outro' })

  it('esconde particular de terceiros mesmo sem filtros', () => {
    const out = aplicaFiltros([particularDeOutro, particularMeu, escritorio], filtro({}), ME)
    expect(ids(out)).toEqual(['p2', 'e1'])
  })

  it('particular de terceiro não vaza nem quando filtra equipe particular', () => {
    const out = aplicaFiltros(
      [particularDeOutro, particularMeu], filtro({ equipes: ['particular'] }), ME,
    )
    expect(ids(out)).toEqual(['p2'])
  })
})

describe('aplicaFiltros — tipos e status', () => {
  const tarefa = ev({ id: 't', fonte: 'tarefa' })
  const prazo = ev({ id: 'pz', fonte: 'prazo' })
  const consulta = ev({ id: 'co', fonte: 'consulta', status: 'cancelada' })
  const todos = [tarefa, prazo, consulta]

  it('tipos vazio => todos', () => {
    expect(ids(aplicaFiltros(todos, filtro({ tipos: [] }), ME))).toEqual(['t', 'pz', 'co'])
  })

  it('filtra por tipo', () => {
    expect(ids(aplicaFiltros(todos, filtro({ tipos: ['prazo', 'consulta'] }), ME)))
      .toEqual(['pz', 'co'])
  })

  it('status específico', () => {
    expect(ids(aplicaFiltros(todos, filtro({ status: 'cancelada' }), ME))).toEqual(['co'])
    expect(ids(aplicaFiltros(todos, filtro({ status: 'a_concluir' }), ME))).toEqual(['t', 'pz'])
  })
})

describe('aplicaFiltros — pessoas × atribuição', () => {
  const comResp = ev({ id: 'r', responsavel: { id: 'u1', nome: 'Ana' } })
  const comEnv = ev({ id: 'e', envolvidos: [{ id: 'u2', nome: 'Bruno' }] })
  const criadoPor = ev({ id: 'c', criadoPor: 'u3' })
  const todos = [comResp, comEnv, criadoPor]

  it('pessoas vazio => todos (atribuição irrelevante)', () => {
    expect(ids(aplicaFiltros(todos, filtro({ pessoas: [], atribuicao: ['responsavel'] }), ME)))
      .toEqual(['r', 'e', 'c'])
  })

  it('só responsáveis de u1', () => {
    expect(ids(aplicaFiltros(todos, filtro({ pessoas: ['u1'], atribuicao: ['responsavel'] }), ME)))
      .toEqual(['r'])
  })

  it('atribuição vazia considera as três dimensões', () => {
    expect(ids(aplicaFiltros(todos, filtro({ pessoas: ['u2', 'u3'], atribuicao: [] }), ME)))
      .toEqual(['e', 'c'])
  })

  it('envolvido não bate quando dimensão é só criador', () => {
    expect(ids(aplicaFiltros(todos, filtro({ pessoas: ['u2'], atribuicao: ['criador'] }), ME)))
      .toEqual([])
  })
})

describe('aplicaFiltros — equipes, tags e busca', () => {
  it('equipes filtra visibilidade', () => {
    const escr = ev({ id: 'e', visibilidade: 'escritorio' })
    const part = ev({ id: 'p', visibilidade: 'particular', criadoPor: ME })
    expect(ids(aplicaFiltros([escr, part], filtro({ equipes: ['escritorio'] }), ME))).toEqual(['e'])
    expect(ids(aplicaFiltros([escr, part], filtro({ equipes: ['particular'] }), ME))).toEqual(['p'])
  })

  it('tags por nome', () => {
    const a = ev({ id: 'a', tags: [{ nome: 'Urgente', cor: '#f00' }] })
    const b = ev({ id: 'b', tags: [{ nome: 'Rotina', cor: '#0f0' }] })
    expect(ids(aplicaFiltros([a, b], filtro({ tags: ['Urgente'] }), ME))).toEqual(['a'])
  })

  it('busca textual sem acento/caixa em título, processo, cliente e responsável', () => {
    const porTitulo = ev({ id: 'ti', titulo: 'Audiência de Instrução' })
    const porCliente = ev({ id: 'cl', cliente: { id: 'c', nome: 'José António' } })
    const porProcesso = ev({ id: 'pr', processo: { id: 'p', titulo: 'Ação', numero: '0007-88' } })
    const outro = ev({ id: 'no', titulo: 'nada a ver' })
    const todos = [porTitulo, porCliente, porProcesso, outro]

    expect(ids(aplicaFiltros(todos, filtro({ q: 'audiencia' }), ME))).toEqual(['ti'])
    expect(ids(aplicaFiltros(todos, filtro({ q: 'jose antonio' }), ME))).toEqual(['cl'])
    expect(ids(aplicaFiltros(todos, filtro({ q: '0007' }), ME))).toEqual(['pr'])
  })

  it('combina múltiplas dimensões', () => {
    const alvo = ev({
      id: 'alvo', fonte: 'prazo', status: 'a_concluir',
      responsavel: { id: 'u1', nome: 'Ana' }, tags: [{ nome: 'Prazo', cor: '#f00' }],
      titulo: 'Contestação',
    })
    const ruido = ev({ id: 'ruido', fonte: 'tarefa', titulo: 'Contestação' })
    const out = aplicaFiltros([alvo, ruido], filtro({
      tipos: ['prazo'], status: 'a_concluir', pessoas: ['u1'],
      atribuicao: ['responsavel'], tags: ['Prazo'], q: 'contesta',
    }), ME)
    expect(ids(out)).toEqual(['alvo'])
  })
})
