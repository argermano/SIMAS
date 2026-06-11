import { describe, it, expect } from 'vitest'
import { detectarTipoReal, validarConteudo } from './file-validation'

const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])       // %PDF-1
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])       // PK\x03\x04 (docx)
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])       // PNG
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])      // JPEG
const txt = Buffer.from('apenas texto comum', 'utf-8')

describe('detectarTipoReal', () => {
  it('reconhece PDF pelos magic bytes', () => expect(detectarTipoReal(pdf)).toBe('pdf'))
  it('reconhece ZIP/DOCX', () => expect(detectarTipoReal(zip)).toBe('zip'))
  it('reconhece PNG', () => expect(detectarTipoReal(png)).toBe('png'))
  it('reconhece JPEG', () => expect(detectarTipoReal(jpeg)).toBe('jpeg'))
  it('retorna desconhecido para conteúdo genérico', () => expect(detectarTipoReal(txt)).toBe('desconhecido'))
  it('retorna desconhecido para buffer curto', () => expect(detectarTipoReal(Buffer.from([0x25]))).toBe('desconhecido'))
})

describe('validarConteudo', () => {
  it('aceita quando o tipo real está na lista permitida', () => {
    expect(validarConteudo(pdf, ['pdf', 'zip'])).toBe('pdf')
  })
  it('rejeita (null) quando o tipo real não é permitido', () => {
    expect(validarConteudo(png, ['pdf', 'zip'])).toBe(null)
  })
  it('rejeita conteúdo disfarçado (txt declarado como pdf)', () => {
    expect(validarConteudo(txt, ['pdf'])).toBe(null)
  })
})
