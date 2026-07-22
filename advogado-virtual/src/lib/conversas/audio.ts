// Lógica PURA de áudio das conversas (testável em node): reconhecimento de anexos
// de áudio, dedução do mimetype real para canPlayType e a decisão player nativo ×
// ogv. Sem dependências de DOM aqui — a parte que toca o DOM vive nos componentes.

import type { Anexo } from './tipos'

// Extensões de áudio comuns do WhatsApp/encaminhamentos. Áudio enviado como
// ARQUIVO (documento) chega com tipo 'file' — pela extensão ainda ganha player
// (caso real: áudio da equipe encaminhado não reproduzia, só baixava). Cobre a
// nota de voz do WhatsApp (Ogg/Opus: .ogg/.oga/.opus) além dos formatos usuais.
export const EXT_AUDIO = /\.(ogg|oga|opus|mp3|m4a|aac|amr|wav|weba|webm)(\?|$)/i

/** True se o anexo é (ou parece) áudio: tipo 'audio' do relay, ou 'file' cujo
 *  nome/URL tem extensão de áudio (áudio encaminhado como arquivo). */
export function pareceAudio(a: Anexo): boolean {
  if (a.tipo === 'audio') return true
  if (a.tipo !== 'file' || !a.url) return false
  try {
    return EXT_AUDIO.test(new URL(a.url).pathname)
  } catch {
    return EXT_AUDIO.test(a.url)
  }
}

// Mimetype (com codec, quando relevante) por extensão — o que passamos ao
// canPlayType. As notas de voz do WhatsApp são Ogg/Opus: por isso .ogg/.opus
// declaram explicitamente codecs="opus" (é o teste que o Safari reprova e o
// Chrome aprova).
const MIME_AUDIO_POR_EXT: Record<string, string> = {
  ogg: 'audio/ogg; codecs="opus"',
  oga: 'audio/ogg',
  opus: 'audio/ogg; codecs="opus"',
  weba: 'audio/webm; codecs="opus"',
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
  wav: 'audio/wav',
}

/** Extensão (sem ponto, minúscula) da URL do anexo; '' se não houver. */
function extDoAnexo(a: Anexo): string {
  let caminho = a.url
  try {
    caminho = new URL(a.url).pathname
  } catch {
    // URL relativa/inválida: usa a string crua.
  }
  const m = caminho.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)
  return m ? m[1] : ''
}

/**
 * Mimetype "real" do anexo de áudio para alimentar audio.canPlayType. Deduz pela
 * extensão; quando a URL não tem extensão útil e o tipo é 'audio' (nota de voz do
 * WhatsApp costuma chegar sem extensão pela URL do Chatwoot), assume Ogg/Opus —
 * o formato das notas de voz. '' quando não dá para afirmar nada.
 */
export function mimeAudioDoAnexo(a: Anexo): string {
  const ext = extDoAnexo(a)
  if (ext && MIME_AUDIO_POR_EXT[ext]) return MIME_AUDIO_POR_EXT[ext]
  if (a.tipo === 'audio') return 'audio/ogg; codecs="opus"'
  return ''
}

export type ModoPlayerAudio = 'nativo' | 'ogv'

/**
 * Decide entre o <audio> NATIVO e o player ogv (WASM) a partir do que o navegador
 * declara em canPlayType para o mimetype real. Se o navegador declara QUALQUER
 * suporte ('maybe'/'probably') → nativo; só quando responde '' (não sabe tocar,
 * caso do Safari com Ogg/Opus) → ogv.
 *
 * RESTRIÇÃO CRÍTICA: navegadores que já tocam (ex.: Chrome com Ogg/Opus) NÃO
 * podem mudar de comportamento nem baixar o WASM — por isso qualquer resposta
 * não-vazia mantém o player nativo. Sem mimetype conhecido, também fica no nativo
 * (não há motivo para carregar o ogv às cegas).
 */
export function decidirPlayerAudio(
  mimetype: string,
  canPlayType: (tipo: string) => string,
): ModoPlayerAudio {
  if (!mimetype) return 'nativo'
  return canPlayType(mimetype) ? 'nativo' : 'ogv'
}

/** Formata segundos como "m:ss" (ex.: 65 → "1:05"); entradas inválidas → "0:00". */
export function formatarTempoAudio(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return '0:00'
  const total = Math.floor(segundos)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Classifica uma falha de reprodução consultando o MESMO proxy do anexo: uma
 * leitura de 1 byte (Range) decide honestamente entre TRANSPORTE (proxy/HTTP
 * fora) e bytes que chegam mas são INDECODIFICÁVEIS. Assim não caímos mudos no
 * card de download quando o problema é só rede.
 *
 * BROWSER-ONLY: usa fetch (não é chamada nos testes de unidade).
 */
export async function classificarFalhaAudio(src: string): Promise<'transporte' | 'bytes-ok'> {
  try {
    const r = await fetch(src, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' })
    return r.ok || r.status === 206 ? 'bytes-ok' : 'transporte'
  } catch {
    return 'transporte'
  }
}
