import { describe, it, expect } from 'vitest'
import { rotuloAguardando } from './aguardando'

// Epochs fixos (segundos) para testes determinísticos.
const AGORA = 1_752_150_000

const antes = (segundos: number) => AGORA - segundos
const MIN = 60
const HORA = 60 * MIN
const DIA = 24 * HORA

describe('rotuloAguardando — selo derivado de aguardandoDesde', () => {
  it('null (respondida/sem mensagens) → null', () => {
    expect(rotuloAguardando(null, AGORA)).toBeNull()
  })

  it('< 60min → minutos, nível ok', () => {
    expect(rotuloAguardando(antes(12 * MIN), AGORA)).toEqual({
      texto: 'AGUARDANDO 12MIN',
      nivel: 'ok',
    })
    // < 1min não mostra "0MIN" (lê como bug): vira "AGORA".
    expect(rotuloAguardando(antes(0), AGORA)).toEqual({
      texto: 'AGUARDANDO AGORA',
      nivel: 'ok',
    })
    expect(rotuloAguardando(antes(59), AGORA)).toEqual({
      texto: 'AGUARDANDO AGORA',
      nivel: 'ok',
    })
    expect(rotuloAguardando(antes(MIN), AGORA)).toEqual({
      texto: 'AGUARDANDO 1MIN',
      nivel: 'ok',
    })
    // Arredonda pra baixo: 59min59s ainda é 59MIN.
    expect(rotuloAguardando(antes(59 * MIN + 59), AGORA)).toEqual({
      texto: 'AGUARDANDO 59MIN',
      nivel: 'ok',
    })
  })

  it('>= 1h e < 24h → horas (piso), nível atencao', () => {
    expect(rotuloAguardando(antes(HORA), AGORA)).toEqual({
      texto: 'AGUARDANDO 1H',
      nivel: 'atencao',
    })
    // 2h59 continua "2H".
    expect(rotuloAguardando(antes(2 * HORA + 59 * MIN), AGORA)).toEqual({
      texto: 'AGUARDANDO 2H',
      nivel: 'atencao',
    })
  })

  it('>= 4h → nível critico (ainda em horas até 24h)', () => {
    expect(rotuloAguardando(antes(4 * HORA), AGORA)).toEqual({
      texto: 'AGUARDANDO 4H',
      nivel: 'critico',
    })
    expect(rotuloAguardando(antes(4 * HORA - 1), AGORA)).toEqual({
      texto: 'AGUARDANDO 3H',
      nivel: 'atencao',
    })
    expect(rotuloAguardando(antes(23 * HORA + 59 * MIN), AGORA)).toEqual({
      texto: 'AGUARDANDO 23H',
      nivel: 'critico',
    })
  })

  it('>= 24h → dias (piso), nível critico', () => {
    expect(rotuloAguardando(antes(DIA), AGORA)).toEqual({
      texto: 'AGUARDANDO 1D',
      nivel: 'critico',
    })
    expect(rotuloAguardando(antes(3 * DIA + 5 * HORA), AGORA)).toEqual({
      texto: 'AGUARDANDO 3D',
      nivel: 'critico',
    })
  })

  it('timestamp no futuro (clock skew) → clampa em AGORA, ok', () => {
    expect(rotuloAguardando(AGORA + 120, AGORA)).toEqual({
      texto: 'AGUARDANDO AGORA',
      nivel: 'ok',
    })
  })
})
