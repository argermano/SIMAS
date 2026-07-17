// Financeiro L1 — dados extraídos de comprovante (IA) e sugestão de parcela.
// INVARIANTE: a IA APENAS SUGERE — a baixa é sempre confirmada por humano.

import { z } from 'zod'

/** Schema dos dados extraídos do comprovante pela IA (completionJSON).
 * recebedorNome/recebedorDoc/chaveDestino são OPCIONAIS e novos (filtro por
 * recebedor): comprovantes antigos sem eles seguem válidos. */
export const dadosComprovanteSchema = z.object({
  valorCentavos: z.number().int().positive(),
  dataISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pagadorNome: z.string().optional(),
  banco: z.string().optional(),
  endToEndId: z.string().optional(),
  recebedorNome: z.string().optional(), // favorecido/beneficiário (quem RECEBE)
  recebedorDoc: z.string().optional(),  // CPF/CNPJ do recebedor, como aparecer (mascarado ok)
  chaveDestino: z.string().optional(),  // chave Pix de destino, se visível
})

export type DadosComprovante = z.infer<typeof dadosComprovanteSchema>

export interface ParcelaCandidata {
  valor_centavos: number
  vencimento: string // yyyy-mm-dd
}

/** Distância absoluta em dias entre duas datas ISO. */
function distanciaDias(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number)
  const [by, bm, bd] = bISO.split('-').map(Number)
  return Math.abs((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000)
}

/**
 * Sugere a parcela aberta que melhor casa com o comprovante:
 * 1) valor EXATO primeiro; 2) senão, valor dentro de ±1% do pago;
 * desempate pelo vencimento mais próximo da data do pagamento; null se nada casa.
 */
export function sugerirParcela<T extends ParcelaCandidata>(
  dados: DadosComprovante,
  parcelasAbertas: T[],
): T | null {
  const porProximidade = (candidatas: T[]): T =>
    [...candidatas].sort((a, b) => {
      const diff =
        distanciaDias(a.vencimento, dados.dataISO) - distanciaDias(b.vencimento, dados.dataISO)
      return diff !== 0 ? diff : a.vencimento.localeCompare(b.vencimento)
    })[0]

  const exatas = parcelasAbertas.filter((p) => p.valor_centavos === dados.valorCentavos)
  if (exatas.length > 0) return porProximidade(exatas)

  const tolerancia = Math.round(dados.valorCentavos * 0.01)
  const aproximadas = parcelasAbertas.filter(
    (p) => Math.abs(p.valor_centavos - dados.valorCentavos) <= tolerancia,
  )
  if (aproximadas.length > 0) return porProximidade(aproximadas)

  return null
}
