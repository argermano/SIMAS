import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { extrairEstiloDocx } from './extrair-estilo-docx'

async function fakeDocx(parts: { document: string; styles?: string; header?: string; footer?: string }): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml', parts.document)
  if (parts.styles) zip.file('word/styles.xml', parts.styles)
  if (parts.header) zip.file('word/header1.xml', parts.header)
  if (parts.footer) zip.file('word/footer1.xml', parts.footer)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

// 1701 twips ≈ 3cm, 1134 ≈ 2cm, 567 ≈ 1cm; sz 28 = 14pt; line 480 = 2.0
const DOCUMENT = `<w:document><w:body><w:sectPr>
  <w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708"/>
</w:sectPr></w:body></w:document>`

const STYLES = `<w:styles><w:docDefaults><w:rPrDefault><w:rPr>
  <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="28"/>
</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>
  <w:spacing w:line="480" w:lineRule="auto"/><w:ind w:firstLine="567"/>
</w:pPr></w:pPrDefault></w:docDefaults></w:styles>`

describe('extrairEstiloDocx', () => {
  it('extrai margens, fonte, tamanho, entrelinha, recuo e cabeçalho/rodapé', async () => {
    const buf = await fakeDocx({
      document: DOCUMENT,
      styles: STYLES,
      header: '<w:hdr><w:p><w:r><w:t>Escritório Exemplo</w:t></w:r></w:p></w:hdr>',
      footer: '<w:ftr><w:p><w:r><w:t>Rua Teste, 100</w:t></w:r></w:p></w:ftr>',
    })
    const e = await extrairEstiloDocx(buf)
    expect(e).not.toBeNull()
    expect(e!.margensCm).toEqual({ topo: 3, baixo: 2, esquerda: 3, direita: 2 })
    expect(e!.fonte).toBe('Arial')
    expect(e!.tamanhoPt).toBe(14)
    expect(e!.entrelinha).toBe(2)
    expect(e!.recuoPrimeiraLinhaCm).toBe(1)
    expect(e!.cabecalho).toBe('Escritório Exemplo')
    expect(e!.rodape).toBe('Rua Teste, 100')
  })

  it('retorna só os campos presentes (sem styles.xml, só margens)', async () => {
    const e = await extrairEstiloDocx(await fakeDocx({ document: DOCUMENT }))
    expect(e!.margensCm).toEqual({ topo: 3, baixo: 2, esquerda: 3, direita: 2 })
    expect(e!.fonte).toBeUndefined()
  })

  it('retorna null para buffer que não é .docx', async () => {
    expect(await extrairEstiloDocx(Buffer.from('isto não é um zip'))).toBeNull()
  })
})
