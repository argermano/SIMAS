// Financeiro L1 — texto do aviso de cobrança por WhatsApp (D-3 e D-0).
// Mesmo tom e fecho do aviso de movimentação (src/lib/processos/notificar.ts).
// O envio em si reusa enviarAvisoWhatsApp de @/lib/processos/notificar.

import { formatarValor } from './parcelas'

export interface AvisoParcelaInput {
  nomeCliente: string | null
  descricao: string // ex.: "Honorários — parcela 2/10"
  valorCentavos: number
  vencimentoISO: string // yyyy-mm-dd
  pixCopiaECola?: string | null // incluído quando o escritório tem Pix configurado
  /** Chave Pix do escritório — vira a 3ª mensagem ("Chave Pix: ..."). */
  chavePix?: string | null
  escritorioNome: string | null
  ehHoje: boolean // true = vence hoje (D-0); false = vence em 3 dias (D-3)
  /** Envio manual de parcela já vencida: "venceu em DD/MM" (tem precedência sobre ehHoje). */
  ehVencida?: boolean
}

/** Primeiro nome, capitalizado, para a saudação (mesmo padrão do notificar.ts). */
function primeiroNome(nome: string | null): string {
  const p = (nome ?? '').trim().split(/\s+/)[0]
  if (!p) return ''
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
}

/** yyyy-mm-dd → dd/mm/yyyy sem passar por Date (evita deslizes de fuso). */
function formatarDataISO(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/**
 * Monta a SEQUÊNCIA de mensagens do aviso (formato aprovado pelo dono, 2026-07-11):
 *  [0] o aviso — com o convite pra enviar o comprovante por aqui (sempre) e, com Pix
 *      configurado, o anúncio das 2 mensagens seguintes;
 *  [1] SÓ o Pix copia e cola (mensagem limpa: tocar-e-segurar copia sem sujeira);
 *  [2] "Chave Pix: <chave>" (pra quem prefere o Pix manual pela chave).
 * Sem Pix configurado, a sequência tem só a mensagem [0].
 */
export function montarMensagensAvisoParcela(a: AvisoParcelaInput): string[] {
  const nome = primeiroNome(a.nomeCliente)
  const saud = nome ? `Olá, ${nome}!` : 'Olá!'
  const data = formatarDataISO(a.vencimentoISO)
  const quando = a.ehVencida ? `venceu em ${data}` : a.ehHoje ? `vence hoje (${data})` : `vence em ${data}`
  const assinatura = a.escritorioNome ? `— Equipe ${a.escritorioNome}` : '— Equipe do escritório'

  const temPix = !!(a.pixCopiaECola && a.pixCopiaECola.trim())

  const linhas = [
    saud,
    ``,
    `Passando para lembrar que a parcela abaixo ${quando}:`,
    ``,
    `${a.descricao} — ${formatarValor(a.valorCentavos)}`,
  ]

  if (temPix) {
    linhas.push(
      ``,
      `Para facilitar, vou te enviar nas próximas duas mensagens o Pix copia e cola (é só copiar e colar no aplicativo do seu banco) e também a chave Pix do escritório.`,
    )
  }

  linhas.push(
    ``,
    `✅ Já realizou o pagamento? Então é só enviar o comprovante por aqui mesmo que a gente confirma e dá baixa rapidinho.`,
    ``,
    `Se tiver qualquer dúvida, é só responder por aqui que a gente te ajuda. 🙂`,
    assinatura,
  )

  const mensagens = [linhas.join('\n')]
  if (temPix) {
    mensagens.push(a.pixCopiaECola!.trim())
    if (a.chavePix && a.chavePix.trim()) mensagens.push(`Chave Pix: ${a.chavePix.trim()}`)
  }
  return mensagens
}

/** Compat: texto único (junta a sequência) — preferir montarMensagensAvisoParcela. */
export function montarTextoAvisoParcela(a: AvisoParcelaInput): string {
  return montarMensagensAvisoParcela(a).join('\n\n')
}
