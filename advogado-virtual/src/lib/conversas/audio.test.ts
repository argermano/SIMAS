import { describe, it, expect } from 'vitest'
import {
  EXT_AUDIO,
  pareceAudio,
  mimeAudioDoAnexo,
  decidirPlayerAudio,
  formatarTempoAudio,
} from './audio'
import type { Anexo } from './tipos'

const audio = (url: string): Anexo => ({ tipo: 'audio', url })
const arquivo = (url: string): Anexo => ({ tipo: 'file', url })

describe('EXT_AUDIO — cobertura de extensões', () => {
  it('cobre .opus e .oga (nota de voz do WhatsApp) além dos usuais', () => {
    for (const ext of ['ogg', 'oga', 'opus', 'mp3', 'm4a', 'aac', 'amr', 'wav', 'weba', 'webm']) {
      expect(EXT_AUDIO.test(`/media/nota.${ext}`)).toBe(true)
    }
  })
  it('ignora extensões não-áudio e casa mesmo com query string', () => {
    expect(EXT_AUDIO.test('/doc/peticao.pdf')).toBe(false)
    expect(EXT_AUDIO.test('/media/nota.opus?token=abc')).toBe(true)
  })
})

describe('pareceAudio', () => {
  it('tipo "audio" é sempre áudio', () => {
    expect(pareceAudio(audio('https://x/att/1'))).toBe(true)
    expect(pareceAudio(audio(''))).toBe(true)
  })
  it('tipo "file" com extensão de áudio conta (áudio encaminhado como arquivo)', () => {
    expect(pareceAudio(arquivo('https://x/att/nota.opus'))).toBe(true)
    expect(pareceAudio(arquivo('https://x/att/nota.oga'))).toBe(true)
    expect(pareceAudio(arquivo('https://x/att/gravacao.ogg?dl=1'))).toBe(true)
  })
  it('tipo "file" sem extensão de áudio não conta; url vazia também não', () => {
    expect(pareceAudio(arquivo('https://x/att/contrato.pdf'))).toBe(false)
    expect(pareceAudio(arquivo(''))).toBe(false)
  })
  it('outros tipos (image/location) não são áudio', () => {
    expect(pareceAudio({ tipo: 'image', url: 'https://x/a.png' })).toBe(false)
    expect(pareceAudio({ tipo: 'location', url: '' })).toBe(false)
  })
})

describe('mimeAudioDoAnexo — mimetype real para canPlayType', () => {
  it('.ogg/.opus declaram Opus (o teste que o Safari reprova)', () => {
    expect(mimeAudioDoAnexo(arquivo('/m/nota.ogg'))).toBe('audio/ogg; codecs="opus"')
    expect(mimeAudioDoAnexo(arquivo('/m/nota.opus'))).toBe('audio/ogg; codecs="opus"')
  })
  it('mapeia os demais formatos', () => {
    expect(mimeAudioDoAnexo(arquivo('/m/a.mp3'))).toBe('audio/mpeg')
    expect(mimeAudioDoAnexo(arquivo('/m/a.m4a'))).toBe('audio/mp4')
    expect(mimeAudioDoAnexo(arquivo('/m/a.wav'))).toBe('audio/wav')
    expect(mimeAudioDoAnexo(arquivo('/m/a.oga'))).toBe('audio/ogg')
  })
  it('tipo "audio" sem extensão na URL assume Ogg/Opus (nota de voz do WhatsApp)', () => {
    expect(mimeAudioDoAnexo(audio('https://chatwoot/att/123'))).toBe('audio/ogg; codecs="opus"')
  })
  it('arquivo sem extensão conhecida → sem mimetype', () => {
    expect(mimeAudioDoAnexo(arquivo('https://x/att/desconhecido'))).toBe('')
  })
})

describe('decidirPlayerAudio — nativo × ogv por canPlayType (mockado)', () => {
  const OPUS = 'audio/ogg; codecs="opus"'

  it('Safari (canPlayType retorna "" para Opus) → ogv', () => {
    const canPlayType = (t: string) => (t.includes('opus') ? '' : 'probably')
    expect(decidirPlayerAudio(OPUS, canPlayType)).toBe('ogv')
  })
  it('Chrome (canPlayType "probably"/"maybe") → nativo, JAMAIS baixa o WASM', () => {
    expect(decidirPlayerAudio(OPUS, () => 'probably')).toBe('nativo')
    expect(decidirPlayerAudio(OPUS, () => 'maybe')).toBe('nativo')
  })
  it('sem mimetype conhecido → nativo (não carrega o ogv às cegas)', () => {
    expect(decidirPlayerAudio('', () => '')).toBe('nativo')
  })
})

describe('formatarTempoAudio', () => {
  it('formata "m:ss" com zero-pad nos segundos', () => {
    expect(formatarTempoAudio(0)).toBe('0:00')
    expect(formatarTempoAudio(5)).toBe('0:05')
    expect(formatarTempoAudio(65)).toBe('1:05')
    expect(formatarTempoAudio(3599)).toBe('59:59')
  })
  it('entradas inválidas viram "0:00"', () => {
    expect(formatarTempoAudio(Number.NaN)).toBe('0:00')
    expect(formatarTempoAudio(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatarTempoAudio(-3)).toBe('0:00')
  })
})
