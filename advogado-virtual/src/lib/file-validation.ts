/**
 * Validação de arquivos por "magic bytes" (assinatura nos primeiros bytes).
 * O `file.type`/extensão são controlados pelo cliente e não são confiáveis —
 * aqui inspecionamos o conteúdo real para impedir uploads disfarçados.
 */

export type TipoArquivo = 'pdf' | 'zip' | 'png' | 'jpeg' | 'desconhecido'

/** Detecta o tipo real a partir dos primeiros bytes do buffer. */
export function detectarTipoReal(buffer: Buffer | Uint8Array): TipoArquivo {
  if (buffer.length >= 4) {
    // %PDF
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'pdf'
    // PK\x03\x04 — ZIP (DOCX/XLSX/PPTX são contêineres ZIP)
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return 'zip'
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
    // JPEG (FF D8 FF)
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  }
  return 'desconhecido'
}

/**
 * Valida que o conteúdo corresponde a um dos tipos reais permitidos.
 * Retorna o tipo detectado ou null se não corresponder.
 */
export function validarConteudo(
  buffer: Buffer | Uint8Array,
  permitidos: TipoArquivo[],
): TipoArquivo | null {
  const tipo = detectarTipoReal(buffer)
  return permitidos.includes(tipo) ? tipo : null
}
