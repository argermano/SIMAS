// Helpers puros de formatação de datas para o módulo Conversas.
// O relay manda epoch em SEGUNDOS. Fuso fixo America/Sao_Paulo, locale pt-BR.
// Todos aceitam number|null|undefined e retornam "" para valor inválido.

const TZ = 'America/Sao_Paulo'

/** Converte epoch(seg) válido em Date, ou null se inválido. */
function paraData(epochSeg: number | null | undefined): Date | null {
  if (epochSeg == null || typeof epochSeg !== 'number' || !Number.isFinite(epochSeg)) {
    return null
  }
  const d = new Date(epochSeg * 1000)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "14:30" */
export function horaCurta(epochSeg: number | null | undefined): string {
  const d = paraData(epochSeg)
  if (!d) return ''
  return d.toLocaleString('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** "15/03 14:30" */
export function dataHoraCurta(epochSeg: number | null | undefined): string {
  const d = paraData(epochSeg)
  if (!d) return ''
  const data = d.toLocaleString('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
  })
  return `${data} ${horaCurta(epochSeg)}`
}

/** "15/03/2024 às 14:30" */
export function dataHoraCompleta(epochSeg: number | null | undefined): string {
  const d = paraData(epochSeg)
  if (!d) return ''
  const data = d.toLocaleString('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return `${data} às ${horaCurta(epochSeg)}`
}

/** "YYYY-MM-DD" no fuso de São Paulo — chave estável p/ agrupar por dia. */
export function agrupadorDia(epochSeg: number | null | undefined): string {
  const d = paraData(epochSeg)
  if (!d) return ''
  // en-CA gera YYYY-MM-DD; aplicamos o timeZone para o dia correto no BR.
  return d.toLocaleDateString('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}
