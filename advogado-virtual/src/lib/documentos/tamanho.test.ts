import { describe, it, expect } from 'vitest'
import { formatarBytes } from './tamanho'

describe('formatarBytes', () => {
  it('trata valores inválidos ou não-positivos como 0 B', () => {
    expect(formatarBytes(0)).toBe('0 B')
    expect(formatarBytes(-10)).toBe('0 B')
    expect(formatarBytes(NaN)).toBe('0 B')
    expect(formatarBytes(Infinity)).toBe('0 B')
  })

  it('mostra bytes puros sem casa decimal', () => {
    expect(formatarBytes(1)).toBe('1 B')
    expect(formatarBytes(500)).toBe('500 B')
    expect(formatarBytes(1023)).toBe('1023 B')
  })

  it('escala para KB/MB/GB com 1 casa decimal', () => {
    expect(formatarBytes(1024)).toBe('1.0 KB')
    expect(formatarBytes(1536)).toBe('1.5 KB')
    expect(formatarBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatarBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatarBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
  })

  it('satura na maior unidade (TB) sem estourar', () => {
    expect(formatarBytes(5 * 1024 ** 4)).toBe('5.0 TB')
    expect(formatarBytes(1024 ** 5)).toBe('1024.0 TB')
  })
})
