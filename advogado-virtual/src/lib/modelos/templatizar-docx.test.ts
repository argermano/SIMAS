import { describe, it, expect } from 'vitest'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import mammoth from 'mammoth'
import { extrairTextoDocx, templatizarDocx } from './templatizar-docx'
import { preencherTemplateDocx } from '../export/preencher-template-docx'

async function docExemplo(): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        // nome e CPF em negrito (um run cada)
        new Paragraph({
          children: [
            new TextRun('outorgante '),
            new TextRun({ text: 'LUCAS OLIVEIRA DA SILVA', bold: true }),
            new TextRun(', CPF '),
            new TextRun({ text: '058.213.011-57', bold: true }),
            new TextRun('.'),
          ],
        }),
        // endereço DIVIDIDO em vários runs (caso difícil)
        new Paragraph({
          children: [
            new TextRun('residente na '),
            new TextRun('QE 19, '),
            new TextRun('Lote 10, '),
            new TextRun('Guará/DF'),
            new TextRun('.'),
          ],
        }),
      ],
    }],
  })
  return Buffer.from(await Packer.toBuffer(doc))
}

describe('templatizarDocx', () => {
  it('extrai o texto como a IA deve vê-lo', async () => {
    const texto = extrairTextoDocx(await docExemplo())
    expect(texto).toContain('outorgante LUCAS OLIVEIRA DA SILVA, CPF 058.213.011-57.')
    expect(texto).toContain('residente na QE 19, Lote 10, Guará/DF.')
  })

  it('substitui valores por placeholders preservando formatação (inclusive valor em vários runs)', async () => {
    const buf = await docExemplo()
    const { buffer, aplicados } = templatizarDocx(buf, [
      { find: 'LUCAS OLIVEIRA DA SILVA', replace: '{{nome_cliente}}' },
      { find: '058.213.011-57', replace: '{{cpf_cliente}}' },
      { find: 'QE 19, Lote 10, Guará/DF', replace: '{{endereco_cliente}}' },
    ])
    expect(aplicados).toBe(3)

    const { value } = await mammoth.extractRawText({ buffer })
    expect(value).toContain('outorgante {{nome_cliente}}, CPF {{cpf_cliente}}.')
    expect(value).toContain('residente na {{endereco_cliente}}.')
    expect(value).not.toContain('LUCAS OLIVEIRA')
    expect(value).not.toContain('058.213.011-57')
    expect(value).not.toContain('QE 19')

    // formatação preservada: o placeholder do nome continua em negrito
    const { value: html } = await mammoth.convertToHtml({ buffer })
    expect(html).toMatch(/<strong>\{\{nome_cliente\}\}<\/strong>/)
  })

  it('o template gerado é preenchível via docxtemplater (round-trip completo)', async () => {
    const { buffer } = templatizarDocx(await docExemplo(), [
      { find: 'LUCAS OLIVEIRA DA SILVA', replace: '{{nome_cliente}}' },
      { find: '058.213.011-57', replace: '{{cpf_cliente}}' },
      { find: 'QE 19, Lote 10, Guará/DF', replace: '{{endereco_cliente}}' },
    ])
    const preenchido = preencherTemplateDocx(buffer, {
      nome_cliente: 'FULANO DE TAL',
      cpf_cliente: '111.222.333-44',
      endereco_cliente: 'Rua das Flores, 10',
    })
    const { value } = await mammoth.extractRawText({ buffer: preenchido })
    expect(value).toContain('outorgante FULANO DE TAL, CPF 111.222.333-44.')
    expect(value).toContain('residente na Rua das Flores, 10.')
  })
})
