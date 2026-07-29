import { describe, it, expect } from 'vitest'
import {
  LIMITE_ENCAMINHAR_NUMERO_BYTES,
  anexoEncaminhavel,
  dddDoDestino,
  falhaEnvioNumero,
  nomeDaUrlAnexo,
  nomeParaEncaminhar,
  normalizarTelefoneDestino,
  resolverTipoEncaminhado,
  telefoneDestinoValido,
  validarTamanhoParaNumero,
} from './encaminhar'
import { LIMITE_UPLOAD_BYTES } from './anexos'

describe('anexoEncaminhavel (quais anexos oferecem o botão)', () => {
  it('oferece para todo anexo com binário — vídeo e áudio inclusive', () => {
    expect(anexoEncaminhavel('video')).toBe(true)
    expect(anexoEncaminhavel('audio')).toBe(true)
    expect(anexoEncaminhavel('image')).toBe(true)
    expect(anexoEncaminhavel('file')).toBe(true)
  })

  it('não oferece para localização/contato (o relay manda url vazia)', () => {
    expect(anexoEncaminhavel('location')).toBe(false)
    expect(anexoEncaminhavel('contact')).toBe(false)
    expect(anexoEncaminhavel('')).toBe(false)
  })
})

describe('nomeDaUrlAnexo / nomeParaEncaminhar', () => {
  it('usa o último segmento do path (decodificado)', () => {
    expect(nomeDaUrlAnexo('https://cw.exemplo/rails/x/v%C3%ADdeo%20final.mp4')).toBe('vídeo final.mp4')
    expect(nomeDaUrlAnexo('nao-e-url')).toBe('')
  })

  it('prefere o nome informado, cai na URL e por fim em "anexo"', () => {
    expect(nomeParaEncaminhar('  contrato.pdf ', 'https://x/y/z.mp4')).toBe('contrato.pdf')
    expect(nomeParaEncaminhar('   ', 'https://x/y/z.mp4')).toBe('z.mp4')
    expect(nomeParaEncaminhar(undefined, 'https://x/')).toBe('anexo')
  })
})

describe('resolverTipoEncaminhado', () => {
  it('aceita VÍDEO do WhatsApp (caso real do grupo "Escritório pai")', () => {
    const r = resolverTipoEncaminhado({ contentTypeRelay: 'video/mp4', nome: 'v.mp4' })
    expect(r).toEqual({ ok: true, contentType: 'video/mp4' })
  })

  it('aceita ÁUDIO com params de codec (audio/ogg; codecs=opus)', () => {
    const r = resolverTipoEncaminhado({ contentTypeRelay: 'audio/ogg; codecs=opus', nome: 'a.ogg' })
    expect(r).toEqual({ ok: true, contentType: 'audio/ogg' })
  })

  it('aceita subtipo de mídia fora de qualquer lista (audio/x-m4a, video/quicktime)', () => {
    expect(resolverTipoEncaminhado({ contentTypeRelay: 'audio/x-m4a', nome: 'a.m4a' })).toMatchObject({ ok: true })
    expect(resolverTipoEncaminhado({ contentTypeRelay: 'video/quicktime', nome: 'v.mov' })).toMatchObject({ ok: true })
  })

  it('cai na extensão quando o Chatwoot devolve octet-stream (vídeo)', () => {
    const r = resolverTipoEncaminhado({ contentTypeRelay: 'application/octet-stream', nome: 'gravacao.mp4' })
    expect(r).toEqual({ ok: true, contentType: 'video/mp4' })
  })

  it('usa o hint do cliente quando o relay não informa nada', () => {
    const r = resolverTipoEncaminhado({ contentTypeRelay: null, hint: 'application/pdf', nome: 'x' })
    expect(r).toEqual({ ok: true, contentType: 'application/pdf' })
  })

  it('recusa tipo perigoso mesmo com extensão desconhecida (400)', () => {
    expect(resolverTipoEncaminhado({ contentTypeRelay: 'image/svg+xml', nome: 'a.svg' }))
      .toMatchObject({ ok: false, status: 400 })
    expect(resolverTipoEncaminhado({ contentTypeRelay: 'text/html', nome: 'a.html' }))
      .toMatchObject({ ok: false, status: 400 })
    expect(resolverTipoEncaminhado({ contentTypeRelay: 'application/octet-stream', nome: 'a.exe' }))
      .toMatchObject({ ok: false, status: 400 })
  })
})

describe('telefoneDestinoValido / normalizarTelefoneDestino', () => {
  it('aceita celular e fixo BR com DDD, mascarados ou não', () => {
    expect(telefoneDestinoValido('(47) 99118-6787')).toBe(true)
    expect(telefoneDestinoValido('4733334444')).toBe(true)
    expect(normalizarTelefoneDestino('(47) 99118-6787')).toBe('47991186787')
  })

  it('aceita DDI 55 colado e preserva os dígitos', () => {
    expect(telefoneDestinoValido('+55 47 99118-6787')).toBe(true)
    expect(normalizarTelefoneDestino('+55 47 99118-6787')).toBe('5547991186787')
  })

  it('recusa vazio, curto e longo demais (nada é enviado)', () => {
    for (const ruim of ['', '   ', '99118678', '991186787', '551147991186787', 'abc']) {
      expect(telefoneDestinoValido(ruim)).toBe(false)
      expect(normalizarTelefoneDestino(ruim)).toBe('')
    }
  })

  it('não confunde DDD 55 (RS, 11 dígitos) com DDI', () => {
    expect(telefoneDestinoValido('55991186787')).toBe(true)
    expect(dddDoDestino('55991186787')).toBe('55')
  })
})

describe('validarTamanhoParaNumero (teto do caminho por número)', () => {
  it('passa o vídeo típico do WhatsApp (o caso real do dono)', () => {
    expect(validarTamanhoParaNumero(12 * 1024 * 1024)).toEqual({ ok: true })
    expect(validarTamanhoParaNumero(LIMITE_ENCAMINHAR_NUMERO_BYTES)).toEqual({ ok: true })
  })

  it('é MAIS APERTADO que o caminho por conversa (base64 + JSON no VPS)', () => {
    expect(LIMITE_ENCAMINHAR_NUMERO_BYTES).toBeLessThan(LIMITE_UPLOAD_BYTES)
  })

  it('recusa ANTES do envio, com 413 e mensagem que diz a saída', () => {
    const r = validarTamanhoParaNumero(40 * 1024 * 1024)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('esperava recusa')
    expect(r.status).toBe(413)
    expect(r.erro).toContain('40 MB')
    expect(r.erro).toContain('16 MB')
    expect(r.erro).toContain('Conversa')
  })
})

describe('falhaEnvioNumero (mensagem honesta por tipo de falha)', () => {
  it('TIMEOUT nunca manda "tente novamente" — a mídia pode ter saído', () => {
    const f = falhaEnvioNumero({ motivo: 'timeout' })
    expect(f.status).toBe(504)
    expect(f.erro).toContain('CONFIRA')
    expect(f.erro).not.toContain('tente novamente')
  })

  it('413 do VPS vira erro de tamanho (reenviar não resolve)', () => {
    expect(falhaEnvioNumero({ motivo: 'http', status: 413 })).toMatchObject({ status: 413 })
    expect(falhaEnvioNumero({ motivo: 'http', status: 413 }).erro).toContain('tamanho')
  })

  it('sem config é problema de servidor; o resto é 502 genérico', () => {
    expect(falhaEnvioNumero({ motivo: 'sem_config' })).toMatchObject({ status: 500 })
    expect(falhaEnvioNumero({ motivo: 'http', status: 500 })).toMatchObject({ status: 502 })
    expect(falhaEnvioNumero({ motivo: 'erro' })).toMatchObject({ status: 502 })
    expect(falhaEnvioNumero({})).toMatchObject({ status: 502 })
  })
})

describe('dddDoDestino (auditoria LGPD: só o DDD)', () => {
  it('extrai o DDD com e sem DDI', () => {
    expect(dddDoDestino('47991186787')).toBe('47')
    expect(dddDoDestino('5547991186787')).toBe('47')
    expect(dddDoDestino('123')).toBeNull()
  })
})
