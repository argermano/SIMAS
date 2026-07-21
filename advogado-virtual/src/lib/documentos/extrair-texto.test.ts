import { describe, it, expect } from 'vitest'
import { extrairTexto, MAX_EXTRACT_BYTES } from './extrair-texto'

// Só exercita os caminhos que não dependem de parsers externos (pdf-parse/mammoth)
// nem do SDK Anthropic: teto de tamanho, tipo não suportado e texto puro.

describe('extrairTexto', () => {
  it('MAX_EXTRACT_BYTES é 50 MB (maior teto já em produção)', () => {
    expect(MAX_EXTRACT_BYTES).toBe(50 * 1024 * 1024)
  })

  it('trunca (pula) o arquivo acima do teto sem tocar no parser', async () => {
    const buffer = Buffer.alloc(21) // 21 bytes
    // mime PDF de propósito: o teto barra ANTES de chamar o pdf-parse.
    const r = await extrairTexto(buffer, { mime: 'application/pdf', fileName: 'x.pdf', maxBytes: 20 })
    expect(r.texto).toBe('')
    expect(r.erro).toMatch(/excede o limite/i)
  })

  it('retorna erro para tipo não suportado', async () => {
    const r = await extrairTexto(Buffer.from([0x00, 0x01, 0x02]), {
      mime: 'application/octet-stream',
      fileName: 'arquivo.bin',
    })
    expect(r.texto).toBe('')
    expect(r.erro).toMatch(/não suportado/i)
  })

  it('extrai TXT direto (trim)', async () => {
    const r = await extrairTexto(Buffer.from('  olá mundo  ', 'utf-8'), {
      mime: 'text/plain',
      fileName: 'nota.txt',
    })
    expect(r.texto).toBe('olá mundo')
    expect(r.erro).toBeUndefined()
  })

  it('fallbackTxt decodifica tipo desconhecido como texto puro', async () => {
    const r = await extrairTexto(Buffer.from('conteúdo cru', 'utf-8'), {
      mime: 'application/rtf',
      fileName: 'modelo.rtf',
      fallbackTxt: true,
    })
    expect(r.texto).toBe('conteúdo cru')
    expect(r.erro).toBeUndefined()
  })
})
