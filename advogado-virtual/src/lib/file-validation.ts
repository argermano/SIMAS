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

export type TipoAudio = 'webm' | 'wav' | 'mp3' | 'ogg' | 'mp4' | 'flac' | 'aac' | 'desconhecido'

/**
 * Detecta o formato de áudio real pelos magic bytes. Cobre os formatos que o
 * gravador do navegador produz (webm/mp4) e os de upload manual comuns
 * (wav, mp3, ogg, m4a/mp4, flac, aac).
 */
export function detectarTipoAudioReal(buffer: Buffer | Uint8Array): TipoAudio {
  const b = buffer
  if (b.length < 12) return 'desconhecido'
  // WebM / Matroska (EBML) — MediaRecorder padrão
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm'
  // RIFF ... WAVE
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return 'wav'
  // OggS
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg'
  // fLaC
  if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return 'flac'
  // ID3 (mp3 com tag) ou frame sync MPEG (0xFFEx)
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'mp3'
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3'
  // ftyp (mp4 / m4a) na posição 4
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'mp4'
  // ADTS AAC (0xFFF1 / 0xFFF9)
  if (b[0] === 0xff && (b[1] === 0xf1 || b[1] === 0xf9)) return 'aac'
  return 'desconhecido'
}

/**
 * Confere que o conteúdo é MESMO um áudio reconhecido (impede que um PDF/ZIP/
 * executável disfarçado de .webm/.mp3 seja enviado ao transcritor). Retorna o
 * formato detectado ou null se não for áudio conhecido.
 */
export function validarAudio(buffer: Buffer | Uint8Array): TipoAudio | null {
  const tipo = detectarTipoAudioReal(buffer)
  return tipo === 'desconhecido' ? null : tipo
}
