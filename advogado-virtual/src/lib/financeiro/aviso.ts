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
  escritorioNome: string | null
  ehHoje: boolean // true = vence hoje (D-0); false = vence em 3 dias (D-3)
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

/** Monta o texto do aviso de parcela (cordial, factual, sem cobrança agressiva). */
export function montarTextoAvisoParcela(a: AvisoParcelaInput): string {
  const nome = primeiroNome(a.nomeCliente)
  const saud = nome ? `Olá, ${nome}!` : 'Olá!'
  const data = formatarDataISO(a.vencimentoISO)
  const quando = a.ehHoje ? `vence hoje (${data})` : `vence em ${data}`
  const assinatura = a.escritorioNome ? `— Equipe ${a.escritorioNome}` : '— Equipe do escritório'

  const linhas = [
    saud,
    ``,
    `Passando para lembrar que a parcela abaixo ${quando}:`,
    ``,
    `${a.descricao} — ${formatarValor(a.valorCentavos)}`,
  ]

  if (a.pixCopiaECola && a.pixCopiaECola.trim()) {
    linhas.push(
      ``,
      `Se preferir, é só pagar pelo Pix copia e cola abaixo:`,
      ``,
      a.pixCopiaECola.trim(),
    )
  }

  linhas.push(
    ``,
    `Se tiver qualquer dúvida, é só responder por aqui que a gente te ajuda. 🙂`,
    assinatura,
  )
  return linhas.join('\n')
}
