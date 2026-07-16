import { describe, it, expect } from 'vitest'
import { documentoNasceuNoCadastro } from './origem'

describe('documentoNasceuNoCadastro', () => {
  const tenant = '11111111-1111-1111-1111-111111111111'
  const cliente = '22222222-2222-2222-2222-222222222222'
  const atendimento = '33333333-3333-3333-3333-333333333333'

  it('doc do dossiê (pasta clientes) = do cadastro', () => {
    expect(documentoNasceuNoCadastro(`${tenant}/clientes/${cliente}/abc.pdf`)).toBe(true)
  })

  it('doc enviado/gerado no caso (pasta do atendimento) = não é do cadastro', () => {
    expect(documentoNasceuNoCadastro(`${tenant}/${atendimento}/docs/123_arquivo.pdf`)).toBe(false)
  })

  it('nulo/vazio não é do cadastro', () => {
    expect(documentoNasceuNoCadastro(null)).toBe(false)
    expect(documentoNasceuNoCadastro(undefined)).toBe(false)
    expect(documentoNasceuNoCadastro('')).toBe(false)
  })
})
