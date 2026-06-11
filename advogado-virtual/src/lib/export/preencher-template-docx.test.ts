import { describe, it, expect } from 'vitest'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import mammoth from 'mammoth'
import { preencherTemplateDocx } from './preencher-template-docx'

async function templateBuffer(): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun('Contratante: {{nome_cliente}}, CPF {{cpf_cliente}}.')] }),
        new Paragraph({ children: [new TextRun('Valor: R$ {{valor}}. Campo: {{inexistente}}.')] }),
      ],
    }],
  })
  return Buffer.from(await Packer.toBuffer(doc))
}

describe('preencherTemplateDocx', () => {
  it('preenche placeholders {{...}} e remove os sem valor', async () => {
    const tpl = await templateBuffer()
    const out = preencherTemplateDocx(tpl, {
      nome_cliente: 'FULANO DE TAL',
      cpf_cliente: '123.456.789-00',
      valor: '5.000,00',
    })
    const { value } = await mammoth.extractRawText({ buffer: out })
    expect(value).toContain('FULANO DE TAL')
    expect(value).toContain('123.456.789-00')
    expect(value).toContain('5.000,00')
    expect(value).not.toContain('{{nome_cliente}}')
    expect(value).not.toContain('{{inexistente}}') // nullGetter → vazio
  })
})
