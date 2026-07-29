// Lógica PURA do ENCAMINHAR de um anexo recebido (zero rede/DOM), compartilhada
// pelas duas variantes de destino:
//   • CONVERSA  → POST /api/conversas/[id]/encaminhar  (relay → Chatwoot)
//   • NÚMERO    → POST /api/conversas/encaminhar       (Evolution, via ai-attendant)
// As duas baixam os mesmos bytes pelo relay e precisam das mesmas decisões: qual
// é o nome do arquivo, qual é o tipo confiável e se o destino é válido.

import { apenasDigitos } from '@/lib/conversas/telefone'
import { mimePorNomeArquivo, tipoAnexoPermitido, tipoBase } from './anexos'

/**
 * Tipos de anexo (file_type normalizado pelo relay) que podem ser ENCAMINHADOS:
 * todos os que têm binário. Vídeo e áudio entraram em 2026-07-29 — caso real do
 * dono: o vídeo recebido no grupo "Escritório pai" nem oferecia o botão, porque a
 * allowlist antiga só tinha documento/imagem. Localização e contato ficam de fora:
 * o relay manda url vazia (não há arquivo para reenviar).
 */
export function anexoEncaminhavel(tipo: string): boolean {
  return tipo === 'image' || tipo === 'file' || tipo === 'video' || tipo === 'audio'
}

/** Último segmento (nome do arquivo) do path de uma URL; '' quando não dá. */
export function nomeDaUrlAnexo(url: string): string {
  try {
    const p = new URL(url).pathname
    return decodeURIComponent(p.split('/').filter(Boolean).pop() ?? '')
  } catch {
    return ''
  }
}

/** Nome final do arquivo encaminhado: o informado, senão o da URL, senão 'anexo'. */
export function nomeParaEncaminhar(filename: string | null | undefined, anexoUrl: string): string {
  return filename?.trim() || nomeDaUrlAnexo(anexoUrl) || 'anexo'
}

export type TipoEncaminhado =
  | { ok: true; contentType: string }
  | { ok: false; erro: string; status: number }

/**
 * Tipo confiável do anexo baixado: o do relay manda; o hint do cliente é fallback.
 * Quando o Chatwoot guarda o arquivo como application/octet-stream (comum em docs
 * E em vídeo/áudio), cai na extensão do nome — a allowlist ainda gateia, senão
 * .docx/.mp4 legítimos seriam recusados.
 */
export function resolverTipoEncaminhado(args: {
  contentTypeRelay?: string | null
  hint?: string | null
  nome: string
}): TipoEncaminhado {
  let contentType = tipoBase(args.contentTypeRelay ?? args.hint)
  if (!tipoAnexoPermitido(contentType)) {
    const porNome = mimePorNomeArquivo(args.nome)
    if (porNome) contentType = porNome
  }
  if (!tipoAnexoPermitido(contentType)) {
    return { ok: false, erro: 'Tipo de arquivo não permitido', status: 400 }
  }
  return { ok: true, contentType }
}

/**
 * Destino por NÚMERO: celular/fixo BR com DDD (10 ou 11 dígitos), aceitando o DDI
 * 55 colado (12/13). Só o tamanho é checado — não inventamos regra de operadora.
 */
export function telefoneDestinoValido(valor: string | null | undefined): boolean {
  const d = apenasDigitos(valor)
  if (d.length === 10 || d.length === 11) return true
  return (d.length === 12 || d.length === 13) && d.startsWith('55')
}

/**
 * Telefone pronto para o /notify: só dígitos (com o DDI preservado quando veio).
 * '' quando inválido — o chamador devolve 400 e nada é enviado.
 */
export function normalizarTelefoneDestino(valor: string | null | undefined): string {
  return telefoneDestinoValido(valor) ? apenasDigitos(valor) : ''
}

/**
 * DDD do destino (2 dígitos) para a trilha de auditoria. LGPD: guardamos SÓ o DDD
 * — nunca o número completo (regra do módulo: metadata com ids/códigos, sem PII).
 */
export function dddDoDestino(valor: string | null | undefined): string | null {
  const d = apenasDigitos(valor)
  const semDDI = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d
  return semDDI.length >= 10 ? semDDI.slice(0, 2) : null
}

/**
 * Teto do caminho por NÚMERO — MENOR que o do caminho por conversa, de propósito.
 * Os dois transportes não são iguais:
 *  • CONVERSA → relay em multipart (o Chatwoot aceita 40 MB, LIMITE_UPLOAD_BYTES).
 *  • NÚMERO   → o arquivo vira base64 DENTRO de um JSON para o /notify do VPS
 *    (+33% de tamanho, e o ai-attendant — processo que também roda o bot — segura
 *    tudo em memória). O teto real desse endpoint NÃO é verificável a partir
 *    deste repositório (o ai-attendant vive no VPS), então adotamos o número que
 *    o próprio WhatsApp impõe à MÍDIA: 16 MB. Vídeo/áudio recebidos no WhatsApp
 *    já chegam abaixo disso, então o caso real do dono (encaminhar o vídeo do
 *    grupo) passa; o que passar do teto é recusado ANTES do envio, com mensagem
 *    honesta e a saída pela aba "Conversa" — em vez de esperar 30 s e falhar.
 * Se o VPS provar aguentar mais, ESTA constante é o único botão a girar.
 */
export const LIMITE_ENCAMINHAR_NUMERO_BYTES = 16 * 1024 * 1024

/** "16" / "23,5" — tamanho em MB para a mensagem ao usuário (pt-BR). */
function mb(bytes: number): string {
  const v = bytes / (1024 * 1024)
  return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('pt-BR')
}

/** Guard de tamanho do envio por NÚMERO (puro): recusa antes de gastar 30 s. */
export function validarTamanhoParaNumero(
  bytes: number,
): { ok: true } | { ok: false; erro: string; status: number } {
  if (bytes > LIMITE_ENCAMINHAR_NUMERO_BYTES) {
    return {
      ok: false,
      status: 413,
      erro:
        `Anexo de ${mb(bytes)} MB: o envio direto para um número aceita até ` +
        `${mb(LIMITE_ENCAMINHAR_NUMERO_BYTES)} MB (limite de mídia do WhatsApp). ` +
        'Se o destinatário já tiver conversa no SIMAS, encaminhe pela aba "Conversa".',
    }
  }
  return { ok: true }
}

/**
 * Traduz a falha do /notify para o que o atendente precisa OUVIR (puro). O caso
 * que mais importa é o 'timeout': a mídia pode ter saído, então mandar "tente
 * novamente" seria pedir para duplicar o arquivo no WhatsApp do cliente.
 */
export function falhaEnvioNumero(falha: {
  motivo?: 'sem_config' | 'timeout' | 'http' | 'erro'
  status?: number
}): { erro: string; status: number } {
  if (falha.motivo === 'sem_config') {
    return { erro: 'Canal de WhatsApp não configurado no servidor — avise o suporte.', status: 500 }
  }
  if (falha.motivo === 'timeout') {
    return {
      erro:
        'O WhatsApp não confirmou o envio a tempo. CONFIRA a conversa do destinatário ' +
        'antes de reenviar — o anexo pode ter saído mesmo assim.',
      status: 504,
    }
  }
  if (falha.motivo === 'http' && (falha.status === 413 || falha.status === 431)) {
    return {
      erro: 'O canal do WhatsApp recusou o anexo por tamanho. Encaminhe pela aba "Conversa" ou envie um arquivo menor.',
      status: 413,
    }
  }
  return { erro: 'Falha ao enviar o anexo pelo WhatsApp — tente novamente.', status: 502 }
}
