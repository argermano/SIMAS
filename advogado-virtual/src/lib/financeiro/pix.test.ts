import { describe, it, expect } from 'vitest'
import { crc16, gerarPixCopiaECola, normalizarChavePix } from './pix'

describe('crc16 — CRC16-CCITT-FALSE', () => {
  it("check value oficial: '123456789' → 29B1", () => {
    expect(crc16('123456789')).toBe('29B1')
  })
  it('exemplo do Manual BACEN (Anexo do Manual de Padrões p/ Iniciação do Pix) → 1D3D', () => {
    const payload =
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000' +
      '52040000530398' + '65802BR5913Fulano de Tal6008BRASILIA62070503***6304'
    expect(crc16(payload)).toBe('1D3D')
  })
})

describe('gerarPixCopiaECola — BR Code EMV estático', () => {
  it('reproduz EXATAMENTE o exemplo oficial do BACEN (sem valor, txid ***)', () => {
    const codigo = gerarPixCopiaECola({
      chave: '123e4567-e12b-12d1-a456-426655440000',
      nome: 'Fulano de Tal',
      cidade: 'BRASILIA',
    })
    expect(codigo).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000' +
        '5204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
    )
  })

  it('inclui o campo 54 com decimal e ponto quando há valor (centavos → reais)', () => {
    const codigo = gerarPixCopiaECola({
      chave: '123e4567-e12b-12d1-a456-426655440000',
      nome: 'Fulano de Tal',
      cidade: 'BRASILIA',
      valorCentavos: 100,
    })
    expect(codigo).toContain('54041.00')
    // CRC recalculado sobre o payload com valor (algoritmo validado acima)
    expect(codigo.endsWith('6304' + crc16(codigo.slice(0, -4)))).toBe(true)
  })

  it('valor com centavos quebrados: R$ 1.234,56 → 54071234.56', () => {
    const codigo = gerarPixCopiaECola({
      chave: 'a@b.com',
      nome: 'Teste',
      cidade: 'CURITIBA',
      valorCentavos: 123456,
    })
    expect(codigo).toContain('54071234.56')
  })

  it('normaliza acentos (NFD) e trunca nome em 25 e cidade em 15', () => {
    const codigo = gerarPixCopiaECola({
      chave: 'a@b.com',
      nome: 'João da Silva Advocacia e Consultoria', // 25 primeiros sem acento
      cidade: 'São José dos Pinhais',
      valorCentavos: 5000,
    })
    expect(codigo).toContain('5925Joao da Silva Advocacia e')
    expect(codigo).toContain('6015Sao Jose dos Pi')
  })

  it('txid: sanitiza para alfanumérico e trunca em 25', () => {
    const codigo = gerarPixCopiaECola({
      chave: 'a@b.com',
      nome: 'Teste',
      cidade: 'CURITIBA',
      valorCentavos: 100,
      txid: 'parcela-123-abc-XYZ-0123456789',
    })
    expect(codigo).toContain('62290525parcela123abcXYZ012345678')
  })

  it('txid vazio após sanitização cai no ***', () => {
    const codigo = gerarPixCopiaECola({
      chave: 'a@b.com',
      nome: 'Teste',
      cidade: 'CURITIBA',
      txid: '---',
    })
    expect(codigo).toContain('62070503***')
  })

  it('chave vazia lança erro', () => {
    expect(() => gerarPixCopiaECola({ chave: '  ', nome: 'X', cidade: 'Y' })).toThrow()
  })

  it('chave com caractere fora do ASCII lança erro (CRC divergiria do banco)', () => {
    expect(() =>
      gerarPixCopiaECola({ chave: 'joão@exemplo.com', nome: 'X', cidade: 'Y' }),
    ).toThrow()
  })

  it('CRC final sempre confere com o payload gerado', () => {
    const codigo = gerarPixCopiaECola({
      chave: '+5541999998888',
      nome: 'Escritorio Exemplo',
      cidade: 'CURITIBA',
      valorCentavos: 78990,
      txid: 'HONORARIOS0210',
    })
    expect(codigo.slice(-4)).toBe(crc16(codigo.slice(0, -4)))
  })
})

describe('normalizarChavePix — formato que os bancos resolvem', () => {
  it('CPF pontuado → só dígitos', () => {
    expect(normalizarChavePix('123.456.789-00')).toBe('12345678900')
  })
  it('CNPJ pontuado → só dígitos', () => {
    expect(normalizarChavePix('12.345.678/0001-90')).toBe('12345678000190')
  })
  it('CPF/CNPJ já em dígitos passa como está', () => {
    expect(normalizarChavePix('12345678900')).toBe('12345678900')
    expect(normalizarChavePix('12345678000190')).toBe('12345678000190')
  })
  it('telefone visual "(41) 99999-8888" → +55 + dígitos', () => {
    expect(normalizarChavePix('(41) 99999-8888')).toBe('+5541999998888')
  })
  it('telefone com +55 mantém o + e limpa a formatação', () => {
    expect(normalizarChavePix('+55 (41) 99999-8888')).toBe('+5541999998888')
    expect(normalizarChavePix('+5541999998888')).toBe('+5541999998888')
  })
  it('e-mail → lowercase', () => {
    expect(normalizarChavePix('Contato@Escritorio.ADV.br')).toBe('contato@escritorio.adv.br')
  })
  it('EVP (chave aleatória) → lowercase, como está', () => {
    expect(normalizarChavePix('123E4567-E12B-12D1-A456-426655440000')).toBe(
      '123e4567-e12b-12d1-a456-426655440000',
    )
  })
  it('rejeita chave com acento/fora do ASCII', () => {
    expect(normalizarChavePix('joão@exemplo.com')).toBeNull()
  })
  it('rejeita formatos irreconhecíveis', () => {
    expect(normalizarChavePix('')).toBeNull()
    expect(normalizarChavePix('12345')).toBeNull()
    expect(normalizarChavePix('chave qualquer')).toBeNull()
  })
})
