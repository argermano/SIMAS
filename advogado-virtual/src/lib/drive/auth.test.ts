import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, verify } from 'node:crypto'
import { parseServiceAccount, montarJwtAssertion, type ServiceAccount } from './auth'

// Chave RSA de teste (gerada localmente — sem rede) para exercitar a assinatura RS256.
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const sa: ServiceAccount = {
  client_email: 'simas@projeto.iam.gserviceaccount.com',
  private_key: privateKey,
  token_uri: 'https://oauth2.googleapis.com/token',
}

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64')

describe('parseServiceAccount — base64 → JSON validado', () => {
  it('decodifica os campos essenciais', () => {
    const parsed = parseServiceAccount(b64(sa))
    expect(parsed.client_email).toBe(sa.client_email)
    expect(parsed.private_key).toBe(sa.private_key)
    expect(parsed.token_uri).toBe(sa.token_uri)
  })

  it('token_uri ausente cai no endpoint padrão do Google', () => {
    const parsed = parseServiceAccount(b64({ client_email: 'x@y.z', private_key: 'k' }))
    expect(parsed.token_uri).toBe('https://oauth2.googleapis.com/token')
  })

  it('lança em base64/JSON inválido', () => {
    expect(() => parseServiceAccount('não-é-base64-json!!')).toThrow(/inválida/)
  })

  it('lança quando faltam campos obrigatórios', () => {
    expect(() => parseServiceAccount(b64({ client_email: 'x@y.z' }))).toThrow(/client_email\/private_key/)
  })
})

describe('montarJwtAssertion — bearer grant RS256 (node:crypto)', () => {
  const agora = 1_700_000_000_000
  const jwt = montarJwtAssertion(sa, { agora })
  const [h, c, s] = jwt.split('.')
  const decode = (seg: string) => JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'))

  it('header é RS256/JWT', () => {
    expect(decode(h)).toEqual({ alg: 'RS256', typ: 'JWT' })
  })

  it('claims trazem iss/aud/scope/iat/exp corretos', () => {
    const claims = decode(c)
    expect(claims.iss).toBe(sa.client_email)
    expect(claims.aud).toBe(sa.token_uri)
    expect(claims.scope).toBe('https://www.googleapis.com/auth/drive')
    expect(claims.iat).toBe(Math.floor(agora / 1000))
    expect(claims.exp).toBe(Math.floor(agora / 1000) + 3600)
  })

  it('assinatura verifica com a chave pública', () => {
    const ok = verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url'))
    expect(ok).toBe(true)
  })
})
