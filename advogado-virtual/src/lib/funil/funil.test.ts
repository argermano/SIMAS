import { describe, it, expect } from 'vitest'
import { normalizarE164, chaveTelefone, mesmoTelefone, apenasDigitos } from './telefone'
import { podeMover } from './regras'

describe('telefone — normalização e matching', () => {
  it('normaliza para E.164 assumindo Brasil', () => {
    expect(normalizarE164('(47) 99118-6787')).toBe('+5547991186787')
    expect(normalizarE164('47 3333-4444')).toBe('+554733334444')
    expect(normalizarE164('+55 47 99118-6787')).toBe('+5547991186787')
  })

  it('apenasDigitos limpa a máscara', () => {
    expect(apenasDigitos('(47) 99118-6787')).toBe('47991186787')
  })

  it('mesmo telefone com máscaras diferentes casa', () => {
    expect(mesmoTelefone('(47) 99118-6787', '+5547991186787')).toBe(true)
    expect(mesmoTelefone('47991186787', '4799118-6787')).toBe(true)
  })

  it('tolera presença/ausência do 9º dígito', () => {
    expect(mesmoTelefone('+5547991186787', '4791186787')).toBe(true)
  })

  it('telefones diferentes NÃO casam', () => {
    expect(mesmoTelefone('47991186787', '11988887777')).toBe(false)
    expect(mesmoTelefone('', '47991186787')).toBe(false)
  })

  it('chaveTelefone remove DDI', () => {
    expect(chaveTelefone('+5547991186787')).toBe('47991186787')
  })
})

describe('podeMover — regras do funil (spec §5)', () => {
  it('HUMANO move qualquer coisa, inclusive voltar', () => {
    expect(podeMover('humano', 'novo_lead', 'contrato_fechado')).toBe(true)
    expect(podeMover('humano', 'proposta_enviada', 'novo_lead')).toBe(true)
    expect(podeMover('humano', 'novo_lead', 'perdido')).toBe(true)
  })

  it('IA só AVANÇA na ordem', () => {
    expect(podeMover('ia', 'novo_lead', 'consulta_agendada')).toBe(true)
    expect(podeMover('ia', 'consulta_agendada', 'consulta_realizada')).toBe(true)
    expect(podeMover('ia', 'consulta_realizada', 'consulta_agendada')).toBe(false) // não volta
  })

  it('IA NUNCA marca perdido/proposta/fechado', () => {
    expect(podeMover('ia', 'novo_lead', 'perdido')).toBe(false)
    expect(podeMover('ia', 'consulta_realizada', 'proposta_enviada')).toBe(false)
    expect(podeMover('ia', 'consulta_realizada', 'contrato_fechado')).toBe(false)
  })

  it('IA NUNCA tira card de proposta/fechado/perdido (conflito humano×automação)', () => {
    expect(podeMover('ia', 'proposta_enviada', 'consulta_agendada')).toBe(false)
    expect(podeMover('sistema', 'contrato_fechado', 'consulta_realizada')).toBe(false)
    expect(podeMover('ia', 'perdido', 'novo_lead')).toBe(false)
  })

  it('mesma etapa nunca é movimento (IA/sistema)', () => {
    expect(podeMover('ia', 'novo_lead', 'novo_lead')).toBe(false)
  })
})
