import { describe, it, expect } from 'vitest'
import {
  LIMITE_UPLOAD_BYTES,
  LIMITE_ANEXO_SERVIDOR_BYTES,
  TIPOS_ANEXO_PERMITIDOS,
  ehMidiaInerte,
  extensaoPorMime,
  mimePorNomeArquivo,
  prefixoAnexoEnvio,
  caminhoAnexoEnvio,
  pathAnexoEnvioValido,
  sanitizarNomeArquivo,
  tipoAnexoPermitido,
  validarAnexoParaEnvio,
} from './anexos'

const TENANT = '11111111-1111-1111-1111-111111111111'
const OUTRO_TENANT = '22222222-2222-2222-2222-222222222222'

describe('limites de anexo', () => {
  it('upload = 40 MB e servidor >= upload (coerência)', () => {
    expect(LIMITE_UPLOAD_BYTES).toBe(40 * 1024 * 1024)
    expect(LIMITE_ANEXO_SERVIDOR_BYTES).toBeGreaterThanOrEqual(LIMITE_UPLOAD_BYTES)
  })
})

describe('mídia inerte (vídeo/áudio encaminháveis)', () => {
  it('aceita qualquer subtipo de áudio/vídeo, com ou sem params', () => {
    for (const t of ['video/mp4', 'video/3gpp', 'video/quicktime', 'audio/ogg; codecs=opus', 'audio/x-m4a', 'AUDIO/MPEG']) {
      expect(ehMidiaInerte(t)).toBe(true)
      expect(tipoAnexoPermitido(t)).toBe(true)
    }
  })

  it('não afrouxa nada fora de mídia (SVG/HTML/executável seguem barrados)', () => {
    for (const t of ['image/svg+xml', 'text/html', 'application/x-msdownload', 'application/octet-stream', '']) {
      expect(ehMidiaInerte(t)).toBe(false)
      expect(tipoAnexoPermitido(t)).toBe(false)
    }
  })

  it('mídia entra por REGRA, não pela lista de documentos (que gateia o dossiê)', () => {
    expect(TIPOS_ANEXO_PERMITIDOS.has('video/mp4')).toBe(false)
    expect(tipoAnexoPermitido('application/pdf')).toBe(true)
  })

  it('deduz o MIME pela extensão quando o Chatwoot não informa', () => {
    expect(mimePorNomeArquivo('gravacao.mp4')).toBe('video/mp4')
    expect(mimePorNomeArquivo('antigo.3gp')).toBe('video/3gpp')
    expect(mimePorNomeArquivo('iphone.MOV')).toBe('video/quicktime')
    expect(mimePorNomeArquivo('voz.opus')).toBe('audio/ogg')
    expect(mimePorNomeArquivo('voz.ogg')).toBe('audio/ogg')
    expect(mimePorNomeArquivo('musica.mp3')).toBe('audio/mpeg')
    expect(mimePorNomeArquivo('audio.m4a')).toBe('audio/mp4')
  })

  it('extensaoPorMime devolve a canônica (ogg antes de opus) sem quebrar os docs', () => {
    expect(extensaoPorMime('audio/ogg')).toBe('.ogg')
    expect(extensaoPorMime('video/mp4')).toBe('.mp4')
    expect(extensaoPorMime('application/pdf')).toBe('.pdf')
  })
})

describe('sanitizarNomeArquivo', () => {
  it('troca separadores/caracteres e nunca vazio', () => {
    expect(sanitizarNomeArquivo('a/b\\c d.pdf')).toBe('a_b_c_d.pdf')
    expect(sanitizarNomeArquivo('   ')).toBe('anexo')
    expect(sanitizarNomeArquivo(null)).toBe('anexo')
    expect(sanitizarNomeArquivo('../../etc/passwd')).toBe('.._.._etc_passwd')
  })
})

describe('caminhoAnexoEnvio', () => {
  it('usa o prefixo do tenant + conversa e nome sanitizado', () => {
    const path = caminhoAnexoEnvio(TENANT, '123', 'foto final.png')
    expect(path.startsWith(`${TENANT}/conversas-envio/123/`)).toBe(true)
    expect(path.endsWith('_foto_final.png')).toBe(true)
    // o path gerado é sempre válido para o próprio tenant
    expect(pathAnexoEnvioValido(path, TENANT)).toBe(true)
  })
})

describe('pathAnexoEnvioValido (prefixo do tenant)', () => {
  it('aceita path no prefixo de envio do próprio tenant', () => {
    expect(pathAnexoEnvioValido(`${prefixoAnexoEnvio(TENANT)}123/1_a.pdf`, TENANT)).toBe(true)
  })

  it('recusa path de OUTRO tenant (IDOR)', () => {
    const alheio = `${prefixoAnexoEnvio(OUTRO_TENANT)}123/1_a.pdf`
    expect(pathAnexoEnvioValido(alheio, TENANT)).toBe(false)
  })

  it('recusa prefixo diferente (fora da área de envio) mesmo no tenant certo', () => {
    expect(pathAnexoEnvioValido(`${TENANT}/clientes/x/a.pdf`, TENANT)).toBe(false)
    expect(pathAnexoEnvioValido(`${TENANT}/atendimentos/x/a.pdf`, TENANT)).toBe(false)
  })

  it('recusa traversal, vazio e faltantes', () => {
    expect(pathAnexoEnvioValido(`${prefixoAnexoEnvio(TENANT)}../../segredo`, TENANT)).toBe(false)
    expect(pathAnexoEnvioValido('', TENANT)).toBe(false)
    expect(pathAnexoEnvioValido(`${prefixoAnexoEnvio(TENANT)}a.pdf`, '')).toBe(false)
    expect(pathAnexoEnvioValido(null, TENANT)).toBe(false)
  })
})

describe('validarAnexoParaEnvio (guard de tipo/tamanho do preparar)', () => {
  it('aceita tipo permitido dentro do limite', () => {
    const r = validarAnexoParaEnvio({ filename: 'x.pdf', mimetype: 'application/pdf', tamanho: 1024 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.contentType).toBe('application/pdf')
  })

  it('cai na extensão quando o mimetype vem vazio (.docx)', () => {
    const r = validarAnexoParaEnvio({ filename: 'peticao.docx', mimetype: '', tamanho: 2048 })
    expect(r.ok).toBe(true)
  })

  it('aceita vídeo/áudio do PC (coerente com o WhatsApp; teto de 40 MB vale igual)', () => {
    expect(validarAnexoParaEnvio({ filename: 'v.mp4', mimetype: 'video/mp4', tamanho: 10 * 1024 * 1024 }))
      .toMatchObject({ ok: true, contentType: 'video/mp4' })
    expect(validarAnexoParaEnvio({ filename: 'v.mp4', mimetype: '', tamanho: 1024 }))
      .toMatchObject({ ok: true, contentType: 'video/mp4' })
    expect(validarAnexoParaEnvio({ filename: 'v.mp4', mimetype: 'video/mp4', tamanho: LIMITE_UPLOAD_BYTES + 1 }))
      .toMatchObject({ ok: false, status: 413 })
  })

  it('recusa tipo fora da allowlist (400)', () => {
    const r = validarAnexoParaEnvio({ filename: 'x.exe', mimetype: 'application/x-msdownload', tamanho: 10 })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  it('recusa acima do limite (413)', () => {
    const r = validarAnexoParaEnvio({
      filename: 'x.pdf',
      mimetype: 'application/pdf',
      tamanho: LIMITE_UPLOAD_BYTES + 1,
    })
    expect(r).toMatchObject({ ok: false, status: 413 })
  })

  it('recusa tamanho inválido (0 ou negativo)', () => {
    expect(validarAnexoParaEnvio({ filename: 'x.pdf', mimetype: 'application/pdf', tamanho: 0 }))
      .toMatchObject({ ok: false, status: 400 })
    expect(validarAnexoParaEnvio({ filename: 'x.pdf', mimetype: 'application/pdf', tamanho: -5 }))
      .toMatchObject({ ok: false, status: 400 })
  })
})
