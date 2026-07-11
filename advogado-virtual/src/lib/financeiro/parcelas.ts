// Financeiro L1 — geração de séries de parcelas e seleção de avisos.
// Valores SEMPRE em centavos (integer); datas em ISO yyyy-mm-dd (sem timezone).

export interface ItemSerie {
  descricao: string
  valor_centavos: number
  vencimento: string // yyyy-mm-dd
}

export interface GerarSerieInput {
  valorTotalCentavos: number
  entradaCentavos?: number
  numParcelas: number
  primeiroVencimento: string // yyyy-mm-dd (vencimento da entrada, se houver; senão da parcela 1)
  diaFixo?: number // dia do mês dos vencimentos seguintes (clampado ao fim do mês)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Soma n meses a uma data ISO; dia = diaFixo (ou o dia original), clampado ao fim do mês. */
function addMeses(iso: string, n: number, diaFixo?: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const alvoDia = diaFixo ?? d
  const totalMeses = m - 1 + n
  const ano = y + Math.floor(totalMeses / 12)
  const mes = (totalMeses % 12) + 1
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return `${ano}-${pad2(mes)}-${pad2(Math.min(alvoDia, ultimoDia))}`
}

/** Soma n dias a uma data ISO. */
function addDias(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

/**
 * Gera a série de parcelas: entrada opcional no primeiroVencimento e N parcelas
 * mensais (a 1ª no primeiroVencimento sem entrada, ou 1 mês depois com entrada).
 * Divisão inteira com o RESTO na ÚLTIMA parcela — a soma é sempre exata.
 */
export function gerarSerie({
  valorTotalCentavos,
  entradaCentavos = 0,
  numParcelas,
  primeiroVencimento,
  diaFixo,
}: GerarSerieInput): ItemSerie[] {
  if (!Number.isInteger(valorTotalCentavos) || valorTotalCentavos <= 0) {
    throw new Error('Valor total inválido')
  }
  if (!Number.isInteger(entradaCentavos) || entradaCentavos < 0) {
    throw new Error('Entrada inválida')
  }
  if (!Number.isInteger(numParcelas) || numParcelas < 1) {
    throw new Error('Número de parcelas inválido')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiroVencimento)) {
    throw new Error('Primeiro vencimento inválido (esperado yyyy-mm-dd)')
  }
  const restante = valorTotalCentavos - entradaCentavos
  if (restante < numParcelas) {
    throw new Error('Valor restante insuficiente para o número de parcelas')
  }

  const itens: ItemSerie[] = []
  if (entradaCentavos > 0) {
    itens.push({
      descricao: 'Honorários — entrada',
      valor_centavos: entradaCentavos,
      vencimento: primeiroVencimento,
    })
  }

  const base = Math.floor(restante / numParcelas)
  const offset = entradaCentavos > 0 ? 1 : 0 // com entrada, a parcela 1 vence 1 mês depois
  for (let i = 1; i <= numParcelas; i++) {
    const ehUltima = i === numParcelas
    itens.push({
      descricao: `Honorários — parcela ${i}/${numParcelas}`,
      valor_centavos: ehUltima ? restante - base * (numParcelas - 1) : base,
      vencimento:
        i - 1 + offset === 0
          ? primeiroVencimento
          : addMeses(primeiroVencimento, i - 1 + offset, diaFixo),
    })
  }
  return itens
}

export interface ParcelaComVencimento {
  vencimento: string // yyyy-mm-dd
  status?: string
}

/**
 * Seleciona parcelas para aviso: d3 = vencimento em hoje+3; d0 = vencimento hoje.
 * NUNCA inclui vencidas (só igualdade exata) e ignora status != 'aberta'.
 */
export function proximosAvisos<T extends ParcelaComVencimento>(
  parcelas: T[],
  hojeISO: string,
): { d3: T[]; d0: T[] } {
  const alvoD3 = addDias(hojeISO, 3)
  const abertas = parcelas.filter((p) => p.status === undefined || p.status === 'aberta')
  return {
    d3: abertas.filter((p) => p.vencimento === alvoD3),
    d0: abertas.filter((p) => p.vencimento === hojeISO),
  }
}

/** Formata centavos como moeda: 123456 → "R$ 1.234,56". Formatação só na borda. */
export function formatarValor(centavos: number): string {
  const negativo = centavos < 0
  const abs = Math.abs(Math.round(centavos))
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negativo ? '-' : ''}R$ ${reais},${pad2(abs % 100)}`
}
