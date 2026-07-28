import { describe, it, expect } from 'vitest'
import {
  formatarMovimentoOriginal,
  complementosTexto,
  complementosEmPares,
  humanizarRotulo,
} from './movimento-texto'

describe('formatarMovimentoOriginal — texto íntegro da movimentação', () => {
  it('sem complementos devolve só o nome técnico', () => {
    expect(formatarMovimentoOriginal('Conclusão para Despacho', [])).toBe('Conclusão para Despacho')
    expect(formatarMovimentoOriginal('Juntada de Petição')).toBe('Juntada de Petição')
    expect(formatarMovimentoOriginal('  Trânsito em Julgado  ', null)).toBe('Trânsito em Julgado')
  })

  it('formata o complemento tabelado do DataJud (descricao = rótulo, nome = valor)', () => {
    expect(
      formatarMovimentoOriginal('Expedição de documento', [
        { codigo: 6, valor: 12, nome: 'Ofício', descricao: 'tipo_de_documento' },
      ]),
    ).toBe('Expedição de documento — Tipo de documento: Ofício')
  })

  it('tolera tribunal que inverte nome/descricao no tabelado', () => {
    expect(
      formatarMovimentoOriginal('Expedição de documento', [
        { nome: 'tipo_de_documento', descricao: 'Alvará' },
      ]),
    ).toBe('Expedição de documento — Tipo de documento: Alvará')
  })

  it('junta vários complementos com "; "', () => {
    expect(
      formatarMovimentoOriginal('Ato ordinatório praticado', [
        { nome: 'Intimação', descricao: 'tipo_de_documento' },
        { nome: '15 dias', descricao: 'prazo' },
      ]),
    ).toBe('Ato ordinatório praticado — Tipo de documento: Intimação; Prazo: 15 dias')
  })

  it('formata a publicação do DJEN (objeto livre) no mesmo padrão', () => {
    expect(
      formatarMovimentoOriginal('Publicação no DJEN: Intimação', [
        {
          tribunal: 'TJPR',
          orgao: '1ª Vara Cível de Curitiba',
          tipoComunicacao: 'Intimação',
          tipoDocumento: 'Despacho',
          link: 'https://comunica.pje.jus.br/x',
        },
      ]),
    ).toBe(
      'Publicação no DJEN: Intimação — Tribunal: TJPR; Órgão: 1ª Vara Cível de Curitiba; ' +
        'Tipo de comunicação: Intimação; Tipo de documento: Despacho; Link: https://comunica.pje.jus.br/x',
    )
  })

  it('descarta valores vazios/nulos e o ruído técnico (codigo/valor) do objeto livre', () => {
    expect(
      formatarMovimentoOriginal('Remessa', [
        { codigo: 123, valor: 9, orgao: null, destinatario: 'Contadoria' },
      ]),
    ).toBe('Remessa — Destinatário: Contadoria')
  })

  it('é resiliente a complementos fora do formato esperado', () => {
    expect(formatarMovimentoOriginal('Movimento', 'não é array')).toBe('Movimento')
    expect(formatarMovimentoOriginal('Movimento', [null, {}, []])).toBe('Movimento')
    expect(formatarMovimentoOriginal('Movimento', ['texto solto'])).toBe('Movimento — texto solto')
    expect(formatarMovimentoOriginal(null, [])).toBe('')
  })

  it('mostra o valor sem rótulo quando só um lado do tabelado veio', () => {
    expect(formatarMovimentoOriginal('Expedição de documento', [{ nome: 'Ofício' }]))
      .toBe('Expedição de documento — Ofício')
  })
})

describe('complementosTexto / complementosEmPares', () => {
  it('devolve os complementos isolados, sem o nome do movimento', () => {
    expect(complementosTexto([{ nome: 'Ofício', descricao: 'tipo_de_documento' }]))
      .toBe('Tipo de documento: Ofício')
    expect(complementosTexto([])).toBe('')
  })

  it('expõe os pares rótulo/valor para quem quiser renderizar em partes', () => {
    expect(complementosEmPares([{ nome: 'Ofício', descricao: 'tipo_de_documento' }]))
      .toEqual([{ rotulo: 'Tipo de documento', valor: 'Ofício' }])
  })
})

describe('humanizarRotulo', () => {
  it('humaniza snake_case e camelCase', () => {
    expect(humanizarRotulo('motivo_da_remessa')).toBe('Motivo da remessa')
    expect(humanizarRotulo('tipo_de_documento')).toBe('Tipo de documento')
    expect(humanizarRotulo('tipoComunicacao')).toBe('Tipo de comunicação')
    expect(humanizarRotulo('grauDeParentesco')).toBe('Grau de parentesco')
  })

  it('preserva siglas em caixa alta', () => {
    expect(humanizarRotulo('numero_OAB')).toBe('Numero OAB')
  })
})
