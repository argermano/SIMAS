import PizZip from 'pizzip'

// O cabeçalho (logo), a marca d'água e o rodapé do escritório vivem no .docx do
// papel timbrado (no cabeçalho/seção do Word). Para aplicá-los a uma peça gerada,
// injetamos os parágrafos da peça no corpo do timbrado, preservando tudo o mais
// (cabeçalho, rodapé, marca d'água, margens e referências de seção).

function indiceCorpo(xml: string): { ini: number; fim: number } | null {
  const ini = xml.indexOf('<w:body>')
  const fim = xml.lastIndexOf('</w:body>')
  if (ini < 0 || fim < 0 || fim < ini) return null
  return { ini: ini + '<w:body>'.length, fim }
}

/** Parágrafos do corpo (tudo dentro de <w:body>, exceto o <w:sectPr> final). */
function paragrafosDoCorpo(xml: string): string {
  const idx = indiceCorpo(xml)
  if (!idx) return ''
  let inner = xml.slice(idx.ini, idx.fim)
  const sect = inner.lastIndexOf('<w:sectPr')
  if (sect >= 0) inner = inner.slice(0, sect)
  return inner.trim()
}

/** <w:sectPr> final do corpo (margens + referências de cabeçalho/rodapé). */
function sectPrDoCorpo(xml: string): string {
  const idx = indiceCorpo(xml)
  if (!idx) return ''
  const inner = xml.slice(idx.ini, idx.fim)
  const sect = inner.lastIndexOf('<w:sectPr')
  return sect >= 0 ? inner.slice(sect) : ''
}

/**
 * Injeta o corpo do DOCX gerado (`corpoBuffer`) dentro do `timbradoBuffer`,
 * mantendo cabeçalho, marca d'água, rodapé e propriedades de seção do timbrado.
 * Lança em caso de timbrado inválido.
 */
export function aplicarTimbrado(timbradoBuffer: Buffer, corpoBuffer: Buffer): Buffer {
  const corpoZip = new PizZip(corpoBuffer)
  const corpoXml = corpoZip.file('word/document.xml')?.asText()
  if (!corpoXml) throw new Error('Conteúdo da peça inválido (sem word/document.xml)')
  const paragrafos = paragrafosDoCorpo(corpoXml)

  const timZip = new PizZip(timbradoBuffer)
  const timFile = timZip.file('word/document.xml')
  if (!timFile) throw new Error('Papel timbrado inválido (não é um .docx do Word)')
  const timXml = timFile.asText()

  const idx = indiceCorpo(timXml)
  if (!idx) throw new Error('Papel timbrado inválido (corpo não encontrado)')
  const sectPr = sectPrDoCorpo(timXml) // preserva margens + cabeçalho/rodapé do timbrado

  const novoXml =
    timXml.slice(0, idx.ini) + paragrafos + sectPr + timXml.slice(idx.fim)

  timZip.file('word/document.xml', novoXml)
  return timZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
