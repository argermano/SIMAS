// Financeiro L1 — Pix "copia e cola" (BR Code EMV estático) gerado à mão,
// sem dependências. Padrão do Manual de Padrões para Iniciação do Pix (BACEN):
// TLV com CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF) sobre payload+"6304".
// QR em imagem fica FORA do L1 — o copia-e-cola é o que o WhatsApp usa.

export interface PixInput {
  chave: string // e-mail, telefone (+55...), CPF/CNPJ (só dígitos) ou EVP
  nome: string // nome do recebedor (até 25 chars, sem acento)
  cidade: string // cidade do recebedor (até 15 chars, sem acento)
  valorCentavos?: number // omitido/0 = BR Code sem valor definido
  txid?: string // até 25 alfanuméricos; default '***'
}

/** CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF), 4 hex maiúsculos. Exportado p/ teste. */
export function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Remove acentos (NFD) e caracteres fora do ASCII imprimível; trunca em max. */
function sanitizar(texto: string, max: number): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas combinantes (acentos)
    .replace(/[^\x20-\x7e]/g, '') // fora do ASCII imprimível
    .trim()
    .slice(0, max)
}

const EVP_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Normaliza a chave Pix para o formato que os bancos resolvem:
 * CPF/CNPJ → só dígitos; telefone → +55DDDNÚMERO; e-mail → lowercase;
 * EVP (chave aleatória) → lowercase. Retorna null para formato inválido
 * (inclusive caracteres fora do ASCII imprimível).
 */
export function normalizarChavePix(entrada: string): string | null {
  const v = entrada.trim()
  if (!v || /[^\x20-\x7e]/.test(v)) return null

  // E-mail
  if (v.includes('@')) {
    const email = v.toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 77 ? email : null
  }

  // EVP (chave aleatória, formato UUID)
  if (EVP_RE.test(v)) return v.toLowerCase()

  const digitos = v.replace(/\D/g, '')

  // Telefone: com +55 explícito, ou no formato visual "(41) 99999-8888"
  if (v.startsWith('+')) {
    return digitos.length >= 12 && digitos.length <= 13 ? `+${digitos}` : null
  }
  if (/[()\s]/.test(v)) {
    return digitos.length === 10 || digitos.length === 11 ? `+55${digitos}` : null
  }

  // CPF (11) / CNPJ (14) — pontuado (123.456.789-00, 12.345.678/0001-90) ou só dígitos
  if ((digitos.length === 11 || digitos.length === 14) && /^[\d./-]+$/.test(v)) {
    return digitos
  }

  return null
}

/** Campo TLV: id (2 dígitos) + tamanho (2 dígitos) + valor. */
function tlv(id: string, valor: string): string {
  if (valor.length > 99) throw new Error(`Campo Pix ${id} excede 99 caracteres`)
  return id + String(valor.length).padStart(2, '0') + valor
}

/**
 * Gera o Pix copia e cola (BR Code EMV estático) oficial BACEN.
 * Valores SEMPRE em centavos na entrada; o payload leva decimal com ponto.
 */
export function gerarPixCopiaECola({ chave, nome, cidade, valorCentavos, txid }: PixInput): string {
  const chaveLimpa = chave.trim()
  if (!chaveLimpa) throw new Error('Chave Pix vazia')
  // Defensivo: chave fora do ASCII imprimível corromperia o CRC (charCodeAt
  // > 255 diverge do CRC sobre bytes UTF-8 que o banco calcula) — melhor
  // falhar aqui do que gerar um BR Code que o banco rejeita na mão do cliente.
  if (/[^\x20-\x7e]/.test(chaveLimpa)) throw new Error('Chave Pix com caracteres inválidos')

  const txidLimpo = (txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'

  let payload =
    tlv('00', '01') + // Payload Format Indicator
    tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', chaveLimpa)) + // Merchant Account Info
    tlv('52', '0000') + // Merchant Category Code
    tlv('53', '986') // moeda BRL

  if (valorCentavos && valorCentavos > 0) {
    payload += tlv('54', (valorCentavos / 100).toFixed(2))
  }

  payload +=
    tlv('58', 'BR') +
    tlv('59', sanitizar(nome, 25)) +
    tlv('60', sanitizar(cidade, 15)) +
    tlv('62', tlv('05', txidLimpo)) +
    '6304'

  return payload + crc16(payload)
}
