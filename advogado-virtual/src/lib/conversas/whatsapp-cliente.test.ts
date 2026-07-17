import { describe, it, expect } from 'vitest'
import { telefoneEnvioValido } from './whatsapp-cliente'

// Núcleo compartilhado do envio de WhatsApp ao cliente. Só a checagem PURA de
// telefone é testável sem rede (validação de anexos e envio tocam supabase/relay).
describe('telefoneEnvioValido — telefone com dígitos suficientes para envio', () => {
  it('aceita celular BR mascarado (11 dígitos)', () => {
    expect(telefoneEnvioValido('(47) 99118-6787')).toBe(true)
  })

  it('aceita fixo BR (10 dígitos)', () => {
    expect(telefoneEnvioValido('(47) 3333-4444')).toBe(true)
  })

  it('aceita número com DDI (12/13 dígitos)', () => {
    expect(telefoneEnvioValido('+55 47 99118-6787')).toBe(true)
  })

  it('rejeita menos de 10 dígitos', () => {
    expect(telefoneEnvioValido('99118-6787')).toBe(false) // 8 dígitos
    expect(telefoneEnvioValido('471234')).toBe(false)
  })

  it('rejeita vazio, nulo e indefinido', () => {
    expect(telefoneEnvioValido('')).toBe(false)
    expect(telefoneEnvioValido(null)).toBe(false)
    expect(telefoneEnvioValido(undefined)).toBe(false)
  })

  it('ignora texto não numérico (só conta dígitos)', () => {
    expect(telefoneEnvioValido('sem número')).toBe(false)
  })
})
