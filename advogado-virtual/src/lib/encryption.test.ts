import { describe, it, expect } from 'vitest'
import {
  encryptField,
  decryptField,
  encryptClienteFields,
  decryptClienteFields,
  encryptTranscricaoFields,
  decryptTranscricaoFields,
  isEncryptionConfigured,
} from './encryption'

describe('encryption', () => {
  it('chave está configurada no ambiente de teste', () => {
    expect(isEncryptionConfigured()).toBe(true)
  })

  it('cifra e decifra (round-trip) preserva o valor original', () => {
    const original = '123.456.789-00'
    const cifrado = encryptField(original)
    expect(cifrado).not.toBe(original)
    expect(cifrado).toMatch(/^enc:v1:/)
    expect(decryptField(cifrado)).toBe(original)
  })

  it('produz ciphertext diferente a cada chamada (IV aleatório)', () => {
    const a = encryptField('mesmo-valor')
    const b = encryptField('mesmo-valor')
    expect(a).not.toBe(b)
    expect(decryptField(a)).toBe('mesmo-valor')
    expect(decryptField(b)).toBe('mesmo-valor')
  })

  it('decifra texto-plano legado (sem prefixo) devolvendo intacto', () => {
    expect(decryptField('texto puro legado')).toBe('texto puro legado')
  })

  it('é idempotente: não cifra valor já cifrado', () => {
    const cifrado = encryptField('abc')
    expect(encryptField(cifrado)).toBe(cifrado)
  })

  it('passa null/undefined/vazio adiante sem alteração', () => {
    expect(encryptField(null)).toBe(null)
    expect(encryptField(undefined)).toBe(undefined)
    expect(encryptField('')).toBe('')
    expect(decryptField(null)).toBe(null)
  })

  it('cifra/decifra campos cpf e rg de um cliente', () => {
    const cliente = { nome: 'Fulano', cpf: '111', rg: '222', email: 'x@y.z' }
    const cifrado = encryptClienteFields(cliente)
    expect(cifrado.cpf).toMatch(/^enc:v1:/)
    expect(cifrado.rg).toMatch(/^enc:v1:/)
    expect(cifrado.nome).toBe('Fulano') // não-sensível inalterado
    expect(cifrado.email).toBe('x@y.z')

    const decifrado = decryptClienteFields(cifrado)
    expect(decifrado.cpf).toBe('111')
    expect(decifrado.rg).toBe('222')
  })

  it('decryptClienteFields lida com null', () => {
    expect(decryptClienteFields(null)).toBe(null)
  })

  it('cifra e decifra os campos de transcrição (round-trip)', () => {
    const at = {
      id: 'abc',
      transcricao_raw: 'Cliente relatou dor no joelho desde 2020.',
      transcricao_editada: 'Relato revisado pelo advogado.',
      area: 'medico',
    }
    const cifrado = encryptTranscricaoFields(at)
    expect(cifrado.transcricao_raw).toMatch(/^enc:v1:/)
    expect(cifrado.transcricao_editada).toMatch(/^enc:v1:/)
    // campos não sensíveis ficam intactos
    expect(cifrado.area).toBe('medico')
    expect(cifrado.id).toBe('abc')

    const decifrado = decryptTranscricaoFields(cifrado)
    expect(decifrado.transcricao_raw).toBe('Cliente relatou dor no joelho desde 2020.')
    expect(decifrado.transcricao_editada).toBe('Relato revisado pelo advogado.')
  })

  it('decryptTranscricaoFields devolve texto-plano legado intacto', () => {
    const legado = { transcricao_raw: 'texto sem prefixo (dado antigo)' }
    expect(decryptTranscricaoFields(legado).transcricao_raw).toBe('texto sem prefixo (dado antigo)')
  })

  it('decryptTranscricaoFields lida com null', () => {
    expect(decryptTranscricaoFields(null)).toBe(null)
  })
})
