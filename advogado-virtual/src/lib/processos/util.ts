/**
 * Helpers puros do módulo de Processos/Publicações.
 * Sem dependências de rede/DB — fáceis de testar (ver util.test.ts).
 */

/**
 * Data de hoje (YYYY-MM-DD) no fuso America/Sao_Paulo.
 *
 * Usa `Intl.DateTimeFormat('en-CA')`, cujo formato de data já é o ISO
 * `YYYY-MM-DD`, com `timeZone` explícito — evita o bug de usar
 * `new Date().toISOString().slice(0,10)`, que retorna o dia em UTC e
 * "vira o dia" à noite no Brasil (UTC-3).
 */
export function hojeSaoPauloISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Próximo dia ÚTIL após `dataISO` (YYYY-MM-DD).
 *
 * Pula APENAS sábado e domingo — NÃO considera feriados nem suspensões de
 * expediente forense. O resultado é uma SUGESTÃO de data de publicação
 * presumida (data_publicacao_sugerida), NUNCA um prazo processual — o prazo
 * é sempre decisão humana.
 *
 * Opera em "meio-dia UTC" (T12:00:00Z) para que somar dias com
 * setUTCDate/getUTCDate nunca escorregue de dia por horário de verão ou
 * conversão de fuso.
 */
export function proximoDiaUtil(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  // Âncora no meio-dia UTC do dia informado (imune a DST e a bordas de fuso).
  const d = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0))
  do {
    d.setUTCDate(d.getUTCDate() + 1)
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6) // 0 = domingo, 6 = sábado
  return d.toISOString().slice(0, 10)
}

/**
 * Normaliza um número de OAB para consulta na API Comunica (DJEN).
 *
 * Remove APENAS pontos, espaços e hífens e faz uppercase — PRESERVA letras
 * de sufixo (inscrição suplementar). Ex.: '75.503-A' → '75503A'.
 *
 * ⚠️ A OAB suplementar leva o sufixo LITERAL na API (numeroOab=75503A retorna
 * itens; sem o "A" retorna 0). Por isso NÃO se pode fazer replace(/\D/g,'').
 */
export function normalizarOab(numero: string): string {
  return numero.toUpperCase().replace(/[.\s-]/g, '')
}
