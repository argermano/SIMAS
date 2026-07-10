import { describe, it, expect } from 'vitest'
import { gerarICS, escaparICS, dobrarLinha, uidICS } from './ics'
import type { EventoCalendario } from './tipos'

function evento(sobrescreve: Partial<EventoCalendario> = {}): EventoCalendario {
  return {
    id: 'evento:abc-123',
    fonte: 'evento',
    titulo: 'Reunião com cliente',
    inicio: '2026-07-10T18:00:00.000Z',
    fim: '2026-07-10T19:00:00.000Z',
    diaTodo: false,
    status: 'a_concluir',
    prioridade: null,
    responsavel: { id: 'u1', nome: 'Katlen' },
    envolvidos: [],
    processo: null,
    cliente: null,
    cor: '#3b82f6',
    tags: [],
    visibilidade: 'escritorio',
    criadoPor: 'u1',
    meetUrl: null,
    link: '/agenda?evento=abc-123',
    descricao: null,
    local: null,
    ...sobrescreve,
  }
}

const OPTS = { nomeCal: 'SIMAS — Katlen', agora: '2026-07-10T12:00:00.000Z' }

describe('gerarICS — evento normal', () => {
  const ics = gerarICS([evento()], OPTS)

  it('estrutura VCALENDAR/VEVENT com CRLF e METHOD:PUBLISH default', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('METHOD:PUBLISH')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
    expect(ics).not.toContain('\n\r') // só CRLF, nunca LF solto invertido
  })

  it('UID estável por linha: agenda_eventos usa prefixo constante "agenda-"', () => {
    // O `tipo` (evento/prazo/audiencia) é editável — o UID NÃO pode segui-lo,
    // senão um update de convite viraria evento novo (duplicata) no calendário.
    expect(ics).toContain('UID:agenda-abc-123@simas.app')
    expect(uidICS('evento:abc-123')).toBe('agenda-abc-123@simas.app')
    expect(uidICS('prazo:abc-123')).toBe('agenda-abc-123@simas.app')
    expect(uidICS('audiencia:abc-123')).toBe('agenda-abc-123@simas.app')
    // Outras fontes mantêm o id lógico completo.
    expect(uidICS('tarefa:t1')).toBe('tarefa:t1@simas.app')
    expect(uidICS('consulta:c1')).toBe('consulta:c1@simas.app')
  })

  it('DTSTART/DTEND em UTC e DTSTAMP determinístico', () => {
    expect(ics).toContain('DTSTART:20260710T180000Z')
    expect(ics).toContain('DTEND:20260710T190000Z')
    expect(ics).toContain('DTSTAMP:20260710T120000Z')
  })

  it('SUMMARY, STATUS:CONFIRMED e SEQUENCE default 0', () => {
    expect(ics).toContain('SUMMARY:Reunião com cliente')
    expect(ics).toContain('STATUS:CONFIRMED')
    expect(ics).toContain('SEQUENCE:0')
  })

  it('DESCRIPTION inclui o link SIMAS absoluto quando urlBase é dada', () => {
    const comBase = gerarICS([evento()], { ...OPTS, urlBase: 'https://simas.app/' })
    expect(comBase).toContain('SIMAS: https://simas.app/agenda?evento=abc-123')
  })
})

describe('gerarICS — dia todo', () => {
  it('usa VALUE=DATE com o dia civil de SP (UTC-3)', () => {
    // 02:00Z do dia 11 ainda é 23:00 SP do dia 10.
    const ics = gerarICS(
      [evento({ diaTodo: true, inicio: '2026-07-11T02:00:00.000Z', fim: null })],
      OPTS,
    )
    expect(ics).toContain('DTSTART;VALUE=DATE:20260710')
    expect(ics).not.toContain('DTEND')
  })

  it('tarefa ancorada ao meio-dia UTC cai no próprio dia', () => {
    const ics = gerarICS(
      [evento({ id: 'tarefa:t1', diaTodo: true, inicio: '2026-07-10T12:00:00.000Z', fim: null })],
      OPTS,
    )
    expect(ics).toContain('UID:tarefa:t1@simas.app')
    expect(ics).toContain('DTSTART;VALUE=DATE:20260710')
  })
})

describe('gerarICS — cancelado / METHOD / SEQUENCE', () => {
  it('status cancelada => STATUS:CANCELLED', () => {
    const ics = gerarICS([evento({ status: 'cancelada' })], OPTS)
    expect(ics).toContain('STATUS:CANCELLED')
    expect(ics).not.toContain('STATUS:CONFIRMED')
  })

  it('METHOD:CANCEL força STATUS:CANCELLED mesmo em evento ativo', () => {
    const ics = gerarICS([evento()], { ...OPTS, metodo: 'CANCEL' })
    expect(ics).toContain('METHOD:CANCEL')
    expect(ics).toContain('STATUS:CANCELLED')
  })

  it('SEQUENCE vem de sequencePorEvento (convite atualizado)', () => {
    const ics = gerarICS([evento()], {
      ...OPTS,
      metodo: 'REQUEST',
      sequencePorEvento: { 'evento:abc-123': 3 },
    })
    expect(ics).toContain('METHOD:REQUEST')
    expect(ics).toContain('SEQUENCE:3')
  })
})

describe('gerarICS — iTIP (ORGANIZER/ATTENDEE em REQUEST/CANCEL)', () => {
  const ITIP = {
    organizador: { nome: 'SIMAS', email: 'contato@simas.app' },
    participantes: [{ nome: 'Katlen', email: 'katlen@ex.com' }],
  }

  it('REQUEST emite ORGANIZER e ATTENDEE (RFC 5546 §3.2.2)', () => {
    const ics = gerarICS([evento()], { ...OPTS, metodo: 'REQUEST', ...ITIP })
    expect(ics).toContain('ORGANIZER;CN=SIMAS:mailto:contato@simas.app')
    expect(ics).toContain(
      'ATTENDEE;CN=Katlen;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:katlen@ex.com'
        .slice(0, 60), // linha dobrada em 75 octetos — confere o prefixo
    )
    // Conteúdo completo após desdobrar (CRLF + espaço).
    expect(ics.replace(/\r\n /g, '')).toContain(
      'ATTENDEE;CN=Katlen;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:katlen@ex.com',
    )
  })

  it('CANCEL emite ORGANIZER e ATTENDEE (RFC 5546 §3.2.5)', () => {
    const ics = gerarICS([evento()], { ...OPTS, metodo: 'CANCEL', ...ITIP })
    const desdobrado = ics.replace(/\r\n /g, '')
    expect(desdobrado).toContain('ORGANIZER;CN=SIMAS:mailto:contato@simas.app')
    expect(desdobrado).toContain('ATTENDEE;CN=Katlen')
    expect(desdobrado).toContain(':mailto:katlen@ex.com')
  })

  it('múltiplos participantes => uma linha ATTENDEE por pessoa', () => {
    const ics = gerarICS([evento()], {
      ...OPTS,
      metodo: 'REQUEST',
      organizador: ITIP.organizador,
      participantes: [
        { nome: 'Katlen', email: 'katlen@ex.com' },
        { nome: 'Anderson', email: 'anderson@ex.com' },
      ],
    })
    expect(ics.replace(/\r\n /g, '').match(/ATTENDEE;/g)?.length).toBe(2)
  })

  it('CN com vírgula/; vai entre aspas (valor de parâmetro, RFC 5545 §3.2)', () => {
    const ics = gerarICS([evento()], {
      ...OPTS,
      metodo: 'REQUEST',
      organizador: ITIP.organizador,
      participantes: [{ nome: 'Silva, Katlen', email: 'katlen@ex.com' }],
    })
    expect(ics.replace(/\r\n /g, '')).toContain('ATTENDEE;CN="Silva, Katlen";')
  })

  it('PUBLISH (feed) NUNCA emite ORGANIZER/ATTENDEE, mesmo se fornecidos', () => {
    const ics = gerarICS([evento()], { ...OPTS, ...ITIP })
    expect(ics).not.toContain('ORGANIZER')
    expect(ics).not.toContain('ATTENDEE')
  })
})

describe('gerarICS — caracteres especiais', () => {
  it('escapa ; , \\ e quebras de linha em SUMMARY/DESCRIPTION/LOCATION', () => {
    const ics = gerarICS(
      [evento({
        titulo: 'Audiência; vara 2, sala B\\anexo',
        descricao: 'linha 1\nlinha 2',
        local: 'Fórum, Blumenau',
      })],
      OPTS,
    )
    expect(ics).toContain('SUMMARY:Audiência\\; vara 2\\, sala B\\\\anexo')
    expect(ics).toContain('DESCRIPTION:linha 1\\nlinha 2')
    expect(ics).toContain('LOCATION:Fórum\\, Blumenau')
  })

  it('escaparICS cobre CRLF', () => {
    expect(escaparICS('a\r\nb')).toBe('a\\nb')
  })
})

describe('dobrarLinha — folding em 75 octetos', () => {
  it('linha curta fica intacta', () => {
    expect(dobrarLinha('SUMMARY:oi')).toBe('SUMMARY:oi')
  })

  it('nenhum segmento excede 75 octetos e o conteúdo é preservado', () => {
    const longa = 'DESCRIPTION:' + 'x'.repeat(300)
    const dobrada = dobrarLinha(longa)
    const segmentos = dobrada.split('\r\n')
    expect(segmentos.length).toBeGreaterThan(1)
    for (const s of segmentos) {
      expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(75)
    }
    // Desdobrar (remover CRLF+espaço) devolve a linha original.
    expect(dobrada.replace(/\r\n /g, '')).toBe(longa)
  })

  it('não parte caractere multi-byte no meio (UTF-8 válido em cada segmento)', () => {
    const longa = 'SUMMARY:' + 'ç'.repeat(120) // 2 bytes cada
    const dobrada = dobrarLinha(longa)
    for (const s of dobrada.split('\r\n')) {
      const bytes = new TextEncoder().encode(s.startsWith(' ') ? s.slice(1) : s)
      // decode estrito lança se houver byte órfão
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow()
      expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(75)
    }
    expect(dobrada.replace(/\r\n /g, '')).toBe(longa)
  })

  it('gerarICS dobra DESCRIPTION longa no documento final', () => {
    const ics = gerarICS([evento({ descricao: 'y'.repeat(400) })], OPTS)
    for (const s of ics.split('\r\n')) {
      expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(75)
    }
  })
})
