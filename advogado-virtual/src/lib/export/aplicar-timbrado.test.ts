import { describe, it, expect } from 'vitest'
import { Document, Packer, Paragraph, Header, Footer } from 'docx'
import PizZip from 'pizzip'
import mammoth from 'mammoth'
import { markdownToDocx } from './docx-generator'
import { aplicarTimbrado } from './aplicar-timbrado'

async function timbradoFalso(): Promise<Buffer> {
  // Simula o .docx do escritório: cabeçalho (logo/marca) + rodapé + corpo de exemplo
  const doc = new Document({
    sections: [{
      headers: { default: new Header({ children: [new Paragraph('TIMBRADO KNG — CABEÇALHO')] }) },
      footers: { default: new Footer({ children: [new Paragraph('RODAPÉ — BRASÍLIA / BLUMENAU / FLORIANÓPOLIS')] }) },
      children: [new Paragraph('TEXTO DE EXEMPLO DO TIMBRADO QUE DEVE SER SUBSTITUÍDO')],
    }],
  })
  return Buffer.from(await Packer.toBuffer(doc))
}

describe('aplicarTimbrado', () => {
  it('injeta a peça no timbrado, preservando cabeçalho/rodapé e trocando o corpo', async () => {
    const timbrado = await timbradoFalso()
    const corpo = await markdownToDocx('## I – DOS FATOS\n\nConteúdo real da peça gerada pela IA.')

    const merged = aplicarTimbrado(timbrado, corpo)

    // Corpo trocado
    const { value } = await mammoth.extractRawText({ buffer: merged })
    expect(value).toContain('Conteúdo real da peça gerada')
    expect(value).not.toContain('TEXTO DE EXEMPLO DO TIMBRADO')

    // Cabeçalho e rodapé preservados (arquivos continuam no pacote)
    const zip = new PizZip(merged)
    const arquivos = Object.keys(zip.files)
    expect(arquivos.some((f) => /word\/header\d*\.xml/.test(f))).toBe(true)
    expect(arquivos.some((f) => /word\/footer\d*\.xml/.test(f))).toBe(true)
    // A seção do timbrado (com refs de cabeçalho/rodapé) foi mantida no corpo
    expect(zip.file('word/document.xml')!.asText()).toContain('<w:sectPr')
  })

  it('lança erro para timbrado inválido', () => {
    expect(() => aplicarTimbrado(Buffer.from('não é docx'), Buffer.from('também não'))).toThrow()
  })
})
