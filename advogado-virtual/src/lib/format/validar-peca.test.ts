import { describe, it, expect } from 'vitest'
import { validarFormatacaoPeca } from './validar-peca'

const tipos = (avisos: { tipo: string }[]) => avisos.map((a) => a.tipo)

describe('validarFormatacaoPeca', () => {
  it('peça bem formatada gera poucos/nenhum aviso', () => {
    const peca = [
      'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 1ª VARA CÍVEL',
      '',
      '**FULANO DE TAL**, brasileiro, vem propor a presente',
      '',
      '## **I – DOS FATOS**',
      '',
      'Trata-se de exemplo de parágrafo dos fatos.',
      '',
      '## **III – DOS PEDIDOS**',
      '',
      'Ante o exposto, requer-se a citação do réu.',
    ].join('\n')
    const avisos = validarFormatacaoPeca(peca)
    expect(tipos(avisos)).not.toContain('enderecamento')
    expect(tipos(avisos)).not.toContain('titulo_arabico')
    expect(tipos(avisos)).not.toContain('pedidos')
  })

  it('detecta título com numeração arábica', () => {
    const avisos = validarFormatacaoPeca('## **1 – DOS FATOS**')
    expect(tipos(avisos)).toContain('titulo_arabico')
  })

  it('detecta linha divisória proibida', () => {
    const avisos = validarFormatacaoPeca('texto\n\n---\n\nmais texto')
    expect(tipos(avisos)).toContain('divisoria')
  })

  it('detecta [PREENCHER] e [VERIFICAR] pendentes', () => {
    const avisos = validarFormatacaoPeca('valor de R$ [PREENCHER]; conforme [VERIFICAR]')
    expect(tipos(avisos)).toContain('preencher')
    expect(tipos(avisos)).toContain('verificar')
  })

  it('aponta ausência de endereçamento e de pedidos', () => {
    const avisos = validarFormatacaoPeca('Um texto qualquer sem preâmbulo nem seção final.')
    expect(tipos(avisos)).toContain('enderecamento')
    expect(tipos(avisos)).toContain('pedidos')
  })

  it('detecta negrito desbalanceado', () => {
    const avisos = validarFormatacaoPeca('texto com **negrito aberto sem fechar')
    expect(tipos(avisos)).toContain('negrito_desbalanceado')
  })
})
