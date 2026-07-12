// Integração Banco Inter — BolePix v3 (emitir / consultar / cancelar).
// SERVER-ONLY, INERTE (ninguém chama ainda). O RESTO DO SISTEMA É CENTAVOS: a
// conversão centavos<->reais acontece SÓ na borda com o Inter (valorNominal em
// reais com 2 casas na ida; reais->centavos na volta).

import { interFetch, type ResultadoInter } from './cliente'

const BASE_COBRANCA = '/cobranca/v3/cobrancas'

// ---- Dinheiro (fonte única; extrato.ts reusa reaisParaCentavos/soDigitos) ----

/** Centavos (inteiro) -> reais (number com 2 casas), como o Inter espera em valorNominal. */
export function centavosParaReais(centavos: number): number {
  return Number((centavos / 100).toFixed(2))
}

/**
 * reais -> centavos (inteiro), parse DEFENSIVO. Aceita number ou string; string
 * com vírgula é tratada como decimal BR ("1.234,56" -> 123456). undefined/NaN -> undefined.
 */
export function reaisParaCentavos(valor: unknown): number | undefined {
  let n: number | undefined
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    n = valor
  } else if (typeof valor === 'string') {
    const s = valor.trim()
    if (!s) return undefined
    // Com vírgula: ponto é separador de milhar -> remove; vírgula vira decimal.
    const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
    const f = Number(normal)
    n = Number.isFinite(f) ? f : undefined
  }
  return n === undefined ? undefined : Math.round(n * 100)
}

/** Só dígitos — para CPF/CNPJ/CEP nos payloads. */
export function soDigitos(v: string): string {
  return v.replace(/\D/g, '')
}

// ---- Situação: enum interno ESTÁVEL (desacopla o vocabulário do Inter) ----

export type SituacaoCobranca =
  | 'a_receber'
  | 'atrasado'
  | 'recebido'
  | 'cancelado'
  | 'expirado'
  | 'protestado'
  | 'em_processamento'
  | 'desconhecida'

// Mapa dos valores conhecidos do Inter -> enum interno. Qualquer valor novo/não
// mapeado cai em 'desconhecida' (parse defensivo, não quebra).
const MAPA_SITUACAO: Record<string, SituacaoCobranca> = {
  A_RECEBER: 'a_receber',
  ATRASADO: 'atrasado',
  RECEBIDO: 'recebido',
  MARCADO_RECEBIDO: 'recebido',
  CANCELADO: 'cancelado',
  EXPIRADO: 'expirado',
  PROTESTO: 'protestado',
  EM_PROCESSAMENTO: 'em_processamento',
}

export function mapearSituacao(situacao?: string | null): SituacaoCobranca {
  if (!situacao) return 'desconhecida'
  return MAPA_SITUACAO[situacao.toUpperCase()] ?? 'desconhecida'
}

// ---- Tipos de entrada/saída ----

// Pagador com os campos garantidos pela doc do Inter para BolePix v3. Não
// inventamos campos extras: o corpo enviado leva exatamente estes.
export interface PagadorInter {
  cpfCnpj: string
  tipoPessoa: 'FISICA' | 'JURIDICA'
  nome: string
  endereco: string
  cidade: string
  uf: string
  cep: string
}

export interface EmitirBoletoInput {
  seuNumero: string // id de conciliação do escritório (ex.: id da parcela)
  valorCentavos: number // sistema é centavos; convertido p/ reais na borda
  dataVencimentoISO: string // yyyy-mm-dd
  numDiasAgenda?: number // dias para baixa automática após o vencimento
  pagador: PagadorInter
}

// Consulta normalizada (campos opcionais parseados defensivamente).
export interface BoletoInter {
  codigoSolicitacao: string
  situacao: SituacaoCobranca
  situacaoInter?: string // valor cru do Inter, para diagnóstico
  valorCentavos?: number
  nossoNumero?: string
  linhaDigitavel?: string
  codigoBarras?: string
  txid?: string
  pixCopiaECola?: string
}

// ---- Montagem PURA do corpo de emissão (testável sem rede) ----

function strOuUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

/**
 * Monta o corpo do POST /cobrancas a partir do input (centavos -> valorNominal
 * em reais). PURA: sem rede, para teste do payload. Valida valorCentavos.
 */
export function montarCorpoBolePix(input: EmitirBoletoInput): Record<string, unknown> {
  if (!Number.isInteger(input.valorCentavos) || input.valorCentavos <= 0) {
    throw new Error('valorCentavos deve ser inteiro positivo')
  }
  const corpo: Record<string, unknown> = {
    seuNumero: input.seuNumero,
    valorNominal: centavosParaReais(input.valorCentavos),
    dataVencimento: input.dataVencimentoISO,
    pagador: {
      cpfCnpj: soDigitos(input.pagador.cpfCnpj),
      tipoPessoa: input.pagador.tipoPessoa,
      nome: input.pagador.nome,
      endereco: input.pagador.endereco,
      cidade: input.pagador.cidade,
      uf: input.pagador.uf.toUpperCase(),
      cep: soDigitos(input.pagador.cep),
    },
  }
  if (input.numDiasAgenda !== undefined) corpo.numDiasAgenda = input.numDiasAgenda
  return corpo
}

/**
 * Normaliza a resposta de GET /cobrancas/{codigo}. PURA (para teste): parse
 * defensivo de cobranca/boleto/pix, que podem faltar dependendo da situação.
 */
export function normalizarBoleto(codigoSolicitacao: string, dados: unknown): BoletoInter {
  const raiz = (dados ?? {}) as Record<string, unknown>
  const cob = (raiz.cobranca ?? {}) as Record<string, unknown>
  const bol = (raiz.boleto ?? {}) as Record<string, unknown>
  const pix = (raiz.pix ?? {}) as Record<string, unknown>
  const situacaoInter = strOuUndef(cob.situacao)
  return {
    codigoSolicitacao,
    situacao: mapearSituacao(situacaoInter),
    situacaoInter,
    valorCentavos: reaisParaCentavos(cob.valorNominal),
    nossoNumero: strOuUndef(bol.nossoNumero),
    linhaDigitavel: strOuUndef(bol.linhaDigitavel),
    codigoBarras: strOuUndef(bol.codigoBarras),
    txid: strOuUndef(pix.txid),
    pixCopiaECola: strOuUndef(pix.pixCopiaECola),
  }
}

// ---- Funções de API (usam interFetch; retornam ResultadoInter) ----

/** Emite um BolePix. Sucesso -> { codigoSolicitacao } (guardar em parcelas.cobranca_externa_id). */
export async function emitirBolePix(
  input: EmitirBoletoInput,
): Promise<ResultadoInter<{ codigoSolicitacao: string }>> {
  const corpo = montarCorpoBolePix(input)
  return interFetch<{ codigoSolicitacao: string }>(BASE_COBRANCA, { method: 'POST', body: corpo })
}

/** Consulta uma cobrança pelo codigoSolicitacao (uuid) e devolve o boleto normalizado. */
export async function consultarCobranca(codigoSolicitacao: string): Promise<ResultadoInter<BoletoInter>> {
  const r = await interFetch<unknown>(`${BASE_COBRANCA}/${encodeURIComponent(codigoSolicitacao)}`)
  if (!r.ok) return { ok: false, status: r.status, erro: r.erro }
  return { ok: true, status: r.status, dados: normalizarBoleto(codigoSolicitacao, r.dados) }
}

/** Cancela uma cobrança (motivo obrigatório). */
export async function cancelarCobranca(
  codigoSolicitacao: string,
  motivo: string,
): Promise<ResultadoInter<unknown>> {
  return interFetch(`${BASE_COBRANCA}/${encodeURIComponent(codigoSolicitacao)}/cancelar`, {
    method: 'POST',
    body: { motivoCancelamento: motivo },
  })
}
