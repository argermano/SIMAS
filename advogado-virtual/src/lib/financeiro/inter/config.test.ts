import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ambiente, baseUrl, certPem, envsFaltando, estaConfigurado, keyPem, webhookCaPem } from './config'

// Certificado/chave FALSOS (só a forma PEM importa para os testes; nada real).
const CERT_PEM = '-----BEGIN CERTIFICATE-----\nZm9v\n-----END CERTIFICATE-----\n'
const KEY_PEM = '-----BEGIN PRIVATE KEY-----\nYmFy\n-----END PRIVATE KEY-----\n'
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

const ESSENCIAIS = ['INTER_CLIENT_ID', 'INTER_CLIENT_SECRET', 'INTER_CERT_BASE64', 'INTER_KEY_BASE64']
const OPCIONAIS = ['INTER_AMBIENTE', 'INTER_CONTA_CORRENTE', 'INTER_WEBHOOK_CA_BASE64']

function limpar() {
  for (const n of [...ESSENCIAIS, ...OPCIONAIS]) delete process.env[n]
}

function configurar() {
  process.env.INTER_CLIENT_ID = 'client-id-real'
  process.env.INTER_CLIENT_SECRET = 'client-secret-real'
  process.env.INTER_CERT_BASE64 = b64(CERT_PEM)
  process.env.INTER_KEY_BASE64 = b64(KEY_PEM)
}

beforeEach(limpar)
afterEach(limpar)

describe('estaConfigurado / envsFaltando', () => {
  it('false com nenhuma env; lista todas as essenciais faltando', () => {
    expect(estaConfigurado()).toBe(false)
    expect(envsFaltando().sort()).toEqual([...ESSENCIAIS].sort())
  })

  it('true com todas as essenciais presentes e reais', () => {
    configurar()
    expect(estaConfigurado()).toBe(true)
    expect(envsFaltando()).toEqual([])
  })

  it('trata placeholder/vazio como faltando (sem vazar o valor)', () => {
    configurar()
    process.env.INTER_CLIENT_ID = 'CHANGEME'
    process.env.INTER_CLIENT_SECRET = '<coloque_aqui>'
    expect(estaConfigurado()).toBe(false)
    expect(envsFaltando().sort()).toEqual(['INTER_CLIENT_ID', 'INTER_CLIENT_SECRET'])
  })
})

describe('ambiente / baseUrl', () => {
  it('default é produção', () => {
    expect(ambiente()).toBe('producao')
    expect(baseUrl()).toBe('https://cdpj.partners.bancointer.com.br')
  })
  it('sandbox quando INTER_AMBIENTE=sandbox (case-insensitive)', () => {
    process.env.INTER_AMBIENTE = 'SANDBOX'
    expect(ambiente()).toBe('sandbox')
    expect(baseUrl()).toBe('https://cdpj-sandbox.partners.uatinter.co')
  })
  it('valor desconhecido cai em produção', () => {
    process.env.INTER_AMBIENTE = 'homolog'
    expect(baseUrl()).toBe('https://cdpj.partners.bancointer.com.br')
  })
})

describe('decode PEM', () => {
  it('decodifica cert/key válidos', () => {
    configurar()
    expect(certPem()).toContain('BEGIN CERTIFICATE')
    expect(keyPem()).toContain('BEGIN PRIVATE KEY')
  })
  it('base64 que não vira PEM lança citando a env, sem o conteúdo', () => {
    configurar()
    process.env.INTER_CERT_BASE64 = b64('isto nao e um PEM')
    expect(() => certPem()).toThrow(/INTER_CERT_BASE64/)
    try {
      certPem()
    } catch (e) {
      expect((e as Error).message).not.toContain('isto nao e um PEM')
    }
  })
  it('env ausente lança citando a env', () => {
    expect(() => keyPem()).toThrow(/INTER_KEY_BASE64/)
  })
})

describe('webhookCaPem (só guardado, uso vem depois)', () => {
  it('null quando não configurado', () => {
    expect(webhookCaPem()).toBeNull()
  })
  it('devolve o PEM quando presente', () => {
    process.env.INTER_WEBHOOK_CA_BASE64 = b64('-----BEGIN CERTIFICATE-----\nY2E=\n-----END CERTIFICATE-----')
    expect(webhookCaPem()).toContain('BEGIN CERTIFICATE')
  })
})
