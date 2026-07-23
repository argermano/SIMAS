import { describe, it, expect } from 'vitest'
import {
  criterioDaTarefa,
  combinaComCriterio,
  atendimentoVinculado,
  tituloDaPeca,
} from './semelhantes'

describe('criterioDaTarefa', () => {
  it('peça: guarda a ação + o tipo detectado', () => {
    expect(criterioDaTarefa('MARIA x INSS: APELAÇÃO. PUB 12/03')).toEqual({
      acao: 'peca',
      tipoPeca: 'apelacao',
    })
    expect(criterioDaTarefa('JOÃO x EMPRESA: CONTRARRAZÕES')).toEqual({
      acao: 'peca',
      tipoPeca: 'contrarrazoes',
    })
  })

  it('peça genérica (sem tipo no mapa): tipoPeca = null', () => {
    expect(criterioDaTarefa('BELTRANO x INSS: MANIFESTAR. PUB 10/05')).toEqual({
      acao: 'peca',
      tipoPeca: null,
    })
  })

  it('não-peça: tipoPeca sempre null', () => {
    expect(criterioDaTarefa('AGENDAR PERÍCIA MÉDICA')).toEqual({ acao: 'agendamento', tipoPeca: null })
    expect(criterioDaTarefa('JUNTAR COMPROVANTES')).toEqual({ acao: 'documento', tipoPeca: null })
    expect(criterioDaTarefa('RETIRAR RPV')).toEqual({ acao: 'processo', tipoPeca: null })
  })

  it('indefinido/trivial: sem critério (null)', () => {
    expect(criterioDaTarefa('xyz')).toBeNull()
    expect(criterioDaTarefa('')).toBeNull()
  })
})

describe('combinaComCriterio', () => {
  it('peça: só casa o MESMO tipo (APELAÇÃO com APELAÇÃO)', () => {
    const crit = criterioDaTarefa('MARIA x INSS: APELAÇÃO')!
    expect(combinaComCriterio(crit, 'PEDRO x INSS: APELAÇÃO. PUB 01/02')).toBe(true)
    expect(combinaComCriterio(crit, 'ANA x INSS: CONTRARRAZÕES')).toBe(false)
    expect(combinaComCriterio(crit, 'LIGAR PARA CLIENTE')).toBe(false)
  })

  it('peça genérica casa com peça genérica (null === null)', () => {
    const crit = criterioDaTarefa('X x Y: MANIFESTAR')!
    expect(combinaComCriterio(crit, 'A x B: MANIFESTAR. PUB 03/03')).toBe(true)
    // genérica NÃO casa com uma de tipo específico
    expect(combinaComCriterio(crit, 'A x B: APELAÇÃO')).toBe(false)
  })

  it('não-peça: casa a família inteira, sem tipo', () => {
    const crit = criterioDaTarefa('AGENDAR PERÍCIA')!
    expect(combinaComCriterio(crit, 'LIGAÇÃO COM O CLIENTE')).toBe(true)
    expect(combinaComCriterio(crit, 'JUNTAR DOCUMENTOS')).toBe(false)
  })
})

describe('atendimentoVinculado', () => {
  it('só o vínculo de caso (process_id) rende atendimento', () => {
    expect(atendimentoVinculado({ process_id: 'at-1' })).toBe('at-1')
    expect(atendimentoVinculado({ cliente_id: 'cli-1' })).toBeNull()
    expect(atendimentoVinculado({ processo_id: 'proc-1' })).toBeNull()
    expect(atendimentoVinculado({})).toBeNull()
  })
})

describe('tituloDaPeca', () => {
  it('usa o nome de TIPOS_PECA quando conhecido', () => {
    expect(tituloDaPeca('apelacao')).toBe('Apelação')
    expect(tituloDaPeca('contrarrazoes')).toBe('Contrarrazões')
  })

  it('fallback: humaniza o slug desconhecido', () => {
    expect(tituloDaPeca('peca_custom')).toBe('peca custom')
  })
})
