import { describe, it, expect } from 'vitest'
import { detectarTipoReal, validarConteudo, detectarTipoAudioReal, validarAudio } from './file-validation'

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

const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]) // RIFF..WAVE
const ogg = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) // ID3
const m4a = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]) // ..ftypM4A
const flac = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00, 0x00])

describe('detectarTipoAudioReal', () => {
  it('reconhece webm (MediaRecorder)', () => expect(detectarTipoAudioReal(webm)).toBe('webm'))
  it('reconhece wav', () => expect(detectarTipoAudioReal(wav)).toBe('wav'))
  it('reconhece ogg', () => expect(detectarTipoAudioReal(ogg)).toBe('ogg'))
  it('reconhece mp3 (ID3)', () => expect(detectarTipoAudioReal(mp3)).toBe('mp3'))
  it('reconhece mp4/m4a (ftyp)', () => expect(detectarTipoAudioReal(m4a)).toBe('mp4'))
  it('reconhece flac', () => expect(detectarTipoAudioReal(flac)).toBe('flac'))
  it('não confunde PDF com áudio', () => expect(detectarTipoAudioReal(pdf)).toBe('desconhecido'))
})

describe('validarAudio', () => {
  it('aceita um webm real', () => expect(validarAudio(webm)).toBe('webm'))
  it('rejeita (null) um PDF disfarçado de áudio', () => expect(validarAudio(pdf)).toBe(null))
  it('rejeita (null) conteúdo genérico', () => expect(validarAudio(txt)).toBe(null))
})
