// Integração Banco Inter — EXTRATO completo (Pix recebidos) + conciliação.
// SERVER-ONLY, INERTE. O extrato/completo é a ÚNICA fonte de Pix recebido por
// CHAVE ESTÁTICA (a API Pix /pix/v2 e o webhook Pix não cobrem chave estática).
// Sistema é centavos: converte reais->centavos aqui, na borda.

import { interFetch, type ResultadoInter } from './cliente'
import { reaisParaCentavos, soDigitos } from './boleto'

const BASE_EXTRATO = '/banking/v2/extrato/completo'
// Trava de segurança da paginação (não confiar cegamente no totalPaginas do banco).
const MAX_PAGINAS = 50

// Lançamento Pix normalizado para conciliação.
export interface LancamentoPix {
  endToEndId: string
  valorCentavos: number
  dataISO: string // yyyy-mm-dd
  cpfCnpjPagador?: string
  nomePagador?: string
}

function strOuUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

// Aceita 'yyyy-mm-dd' ou 'yyyy-mm-ddThh:mm:ss' e devolve só a data.
function soData(v: string): string {
  return v.slice(0, 10)
}

/**
 * Normaliza a resposta do extrato -> só lançamentos Pix com e2e e data (o
 * mínimo para conciliar). PURA: parse defensivo de campos opcionais; ignora
 * não-Pix e Pix sem os dados essenciais. Aceita a lista de transações em
 * `transacoes` (com ou sem envelope de página).
 */
export function normalizarExtrato(dados: unknown): LancamentoPix[] {
  const transacoes = extrairTransacoes(dados)
  const out: LancamentoPix[] = []
  for (const item of transacoes) {
    const tr = (item ?? {}) as Record<string, unknown>
    if (String(tr.tipoTransacao ?? '').toUpperCase() !== 'PIX') continue

    const valorCentavos = reaisParaCentavos(tr.valor)
    if (valorCentavos === undefined) continue

    // Detalhes do Pix podem vir aninhados em `detalhes` ou (defensivo) no topo.
    const det = (tr.detalhes ?? {}) as Record<string, unknown>
    const endToEndId = strOuUndef(det.endToEndId) ?? strOuUndef(tr.endToEndId)
    const dataBruta = strOuUndef(tr.dataEntrada) ?? strOuUndef(tr.dataInclusao)
    if (!endToEndId || !dataBruta) continue // sem e2e ou data não dá para conciliar

    const cpfCnpjBruto = strOuUndef(det.cpfCnpjPagador) ?? strOuUndef(tr.cpfCnpjPagador)
    out.push({
      endToEndId,
      valorCentavos,
      dataISO: soData(dataBruta),
      cpfCnpjPagador: cpfCnpjBruto ? soDigitos(cpfCnpjBruto) : undefined,
      nomePagador: strOuUndef(det.nomePagador) ?? strOuUndef(tr.nomePagador),
    })
  }
  return out
}

// Encontra o array de transações em várias formas possíveis do envelope.
function extrairTransacoes(dados: unknown): unknown[] {
  if (Array.isArray(dados)) return dados
  const d = (dados ?? {}) as Record<string, unknown>
  if (Array.isArray(d.transacoes)) return d.transacoes
  if (Array.isArray(d.transacaoList)) return d.transacaoList
  return []
}

function lerTotalPaginas(dados: unknown): number | undefined {
  const d = (dados ?? {}) as Record<string, unknown>
  const v = d.totalPaginas
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Consulta o extrato completo (janela <= 90d) e devolve os Pix normalizados,
 * seguindo a paginação. Se a página 0 falhar, retorna o erro; se uma página
 * posterior falhar, retorna o que já acumulou (ok:true, parcial).
 */
export async function consultarExtratoCompleto(params: {
  dataInicioISO: string
  dataFimISO: string
  maxPaginas?: number
}): Promise<ResultadoInter<LancamentoPix[]>> {
  const maxPaginas = params.maxPaginas ?? MAX_PAGINAS
  const acumulado: LancamentoPix[] = []
  let pagina = 0
  let ultimoStatus = 200

  while (pagina < maxPaginas) {
    const qs = new URLSearchParams({
      dataInicio: params.dataInicioISO,
      dataFim: params.dataFimISO,
      pagina: String(pagina),
    }).toString()

    const r = await interFetch<unknown>(`${BASE_EXTRATO}?${qs}`)
    if (!r.ok) {
      if (pagina === 0) return { ok: false, status: r.status, erro: r.erro }
      break // página posterior falhou: entrega o parcial
    }
    ultimoStatus = r.status
    acumulado.push(...normalizarExtrato(r.dados))

    const totalPaginas = lerTotalPaginas(r.dados)
    if (totalPaginas === undefined || pagina + 1 >= totalPaginas) break
    pagina += 1
  }

  return { ok: true, status: ultimoStatus, dados: acumulado }
}

// ---- Conciliação (PURA, sem rede) ----

export interface AlvoComprovante {
  endToEndId?: string
  valorCentavos: number
  dataISO: string
  cpfCnpj?: string
}

export type CriterioMatch = 'e2e' | 'valor_data_cpf' | 'nenhum'

export interface ResultadoMatch {
  casou: boolean
  lancamento?: LancamentoPix
  criterio: CriterioMatch
}

/**
 * Casa um comprovante com um lançamento do extrato. PURA (para teste):
 *  1) primário: endToEndId EXATO;
 *  2) fallback: mesmo valorCentavos + mesmo dia + cpf/cnpj (quando informado).
 * Valor DIFERENTE nunca casa. Sem match -> { casou:false, criterio:'nenhum' }.
 */
export function casarComprovante(alvo: AlvoComprovante, lancamentos: LancamentoPix[]): ResultadoMatch {
  // 1) e2e exato.
  if (alvo.endToEndId) {
    const porE2e = lancamentos.find((l) => l.endToEndId === alvo.endToEndId)
    if (porE2e) return { casou: true, lancamento: porE2e, criterio: 'e2e' }
  }

  // 2) fallback por valor + dia + (cpf, se informado).
  const alvoData = alvo.dataISO.slice(0, 10)
  const alvoCpf = alvo.cpfCnpj ? soDigitos(alvo.cpfCnpj) : undefined
  const porValor = lancamentos.find(
    (l) =>
      l.valorCentavos === alvo.valorCentavos &&
      l.dataISO.slice(0, 10) === alvoData &&
      (!alvoCpf || (l.cpfCnpjPagador ? soDigitos(l.cpfCnpjPagador) === alvoCpf : false)),
  )
  if (porValor) return { casou: true, lancamento: porValor, criterio: 'valor_data_cpf' }

  return { casou: false, criterio: 'nenhum' }
}
