import { describe, it, expect } from 'vitest'
import {
  LIMITE_UPLOAD_BYTES,
  LIMITE_ANEXO_SERVIDOR_BYTES,
  prefixoAnexoEnvio,
  caminhoAnexoEnvio,
  pathAnexoEnvioValido,
  sanitizarNomeArquivo,
  validarAnexoParaEnvio,
} from './anexos'

const TENANT = '11111111-1111-1111-1111-111111111111'
const OUTRO_TENANT = '22222222-2222-2222-2222-222222222222'

describe('limites de anexo', () => {
  it('upload = 20 MB e servidor >= upload (coerência)', () => {
    expect(LIMITE_UPLOAD_BYTES).toBe(20 * 1024 * 1024)
    expect(LIMITE_ANEXO_SERVIDOR_BYTES).toBeGreaterThanOrEqual(LIMITE_UPLOAD_BYTES)
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
