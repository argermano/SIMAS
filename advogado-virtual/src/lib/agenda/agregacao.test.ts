import { describe, it, expect } from 'vitest'
import {
  tarefaParaEvento,
  eventoParaEvento,
  consultaParaEvento,
  type TarefaRow,
  type AgendaEventoRow,
  type ConsultaRow,
} from './agregacao'

const baseTarefa: TarefaRow = {
  id: 't1',
  description: 'Protocolar petição',
  due_date: '2026-07-10T12:00:00.000Z',
  priority: 'alta',
  completed_at: null,
  created_by: 'u1',
  origin_reference: null,
  responsavel: { id: 'u2', nome: 'Sara' },
  envolvidos: [{ id: 'u3', nome: 'Bruno' }],
  processo: { id: 'p1', titulo: 'Ação X', numero: '0001' },
  cliente: { id: 'c1', nome: 'Cliente A' },
  tags: [],
}

describe('tarefaParaEvento', () => {
  it('id prefixado, all-day, link e cor por prioridade quando sem tag', () => {
    const ev = tarefaParaEvento(baseTarefa)
    expect(ev.id).toBe('tarefa:t1')
    expect(ev.fonte).toBe('tarefa')
    expect(ev.diaTodo).toBe(true)
    expect(ev.fim).toBeNull()
    expect(ev.inicio).toBe('2026-07-10T12:00:00.000Z')
    expect(ev.status).toBe('a_concluir')
    expect(ev.cor).toBe('#f59e0b') // alta
    expect(ev.link).toBe('/tarefas?tarefa=t1')
    expect(ev.visibilidade).toBe('escritorio')
    expect(ev.meetUrl).toBeNull()
    expect(ev.prioridade).toBe('alta')
  })

  it('cor da 1ª tag tem prioridade sobre a cor de prioridade', () => {
    const ev = tarefaParaEvento({
      ...baseTarefa,
      tags: [{ nome: 'urgente-cliente', cor: '#123456' }, { nome: 'outra', cor: '#000' }],
    })
    expect(ev.cor).toBe('#123456')
    expect(ev.tags).toHaveLength(2)
  })

  it('sem prioridade e sem tag usa cor neutra', () => {
    const ev = tarefaParaEvento({ ...baseTarefa, priority: null, tags: [] })
    expect(ev.cor).toBe('#6b7280')
    expect(ev.prioridade).toBeNull()
  })

  it('completed_at => concluida', () => {
    const ev = tarefaParaEvento({ ...baseTarefa, completed_at: '2026-07-11T00:00:00.000Z' })
    expect(ev.status).toBe('concluida')
  })
})

describe('eventoParaEvento', () => {
  const base: AgendaEventoRow = {
    id: 'e1',
    tipo: 'prazo',
    titulo: 'Prazo recurso',
    inicio: '2026-07-15T13:00:00.000Z',
    fim: '2026-07-15T14:00:00.000Z',
    dia_todo: false,
    status: 'a_concluir',
    cor: null,
    visibilidade: 'particular',
    created_by: 'u9',
    responsavel: { id: 'u9', nome: 'Ana' },
    envolvidos: [],
    processo: null,
    cliente: null,
  }

  it('fonte = tipo; id = "tipo:rawId"; cor padrão quando null', () => {
    const ev = eventoParaEvento(base)
    expect(ev.id).toBe('prazo:e1')
    expect(ev.fonte).toBe('prazo')
    expect(ev.cor).toBe('#3b82f6')
    expect(ev.visibilidade).toBe('particular')
    expect(ev.criadoPor).toBe('u9')
    expect(ev.prioridade).toBeNull()
    expect(ev.tags).toEqual([])
    expect(ev.link).toBe('/agenda?evento=e1')
    expect(ev.fim).toBe('2026-07-15T14:00:00.000Z')
  })

  it('respeita cor explícita e dia_todo', () => {
    const ev = eventoParaEvento({ ...base, tipo: 'audiencia', cor: '#abcabc', dia_todo: true })
    expect(ev.fonte).toBe('audiencia')
    expect(ev.id).toBe('audiencia:e1')
    expect(ev.cor).toBe('#abcabc')
    expect(ev.diaTodo).toBe(true)
  })
})

describe('consultaParaEvento', () => {
  const base: ConsultaRow = {
    id: 'l1',
    nome: 'João da Silva',
    area: 'Trabalhista',
    consulta_data: '2026-07-20T18:00:00.000Z',
    consulta_formato: 'online',
    meet_url: 'https://meet.example/abc',
    consulta_cancelada: false,
    cliente: { id: 'c9', nome: 'João da Silva' },
  }

  it('normaliza consulta ativa', () => {
    const ev = consultaParaEvento(base)
    expect(ev.id).toBe('consulta:l1')
    expect(ev.fonte).toBe('consulta')
    expect(ev.titulo).toBe('João da Silva')
    expect(ev.status).toBe('a_concluir')
    expect(ev.meetUrl).toBe('https://meet.example/abc')
    expect(ev.link).toBe('/funil?lead=l1')
    expect(ev.cor).toBe('#8b5cf6')
    expect(ev.diaTodo).toBe(false)
    expect(ev.responsavel).toBeNull()
  })

  it('cancelada => status cancelada', () => {
    const ev = consultaParaEvento({ ...base, consulta_cancelada: true })
    expect(ev.status).toBe('cancelada')
  })

  it('sem nome usa fallback "Consulta"', () => {
    const ev = consultaParaEvento({ ...base, nome: null })
    expect(ev.titulo).toBe('Consulta')
  })
})
