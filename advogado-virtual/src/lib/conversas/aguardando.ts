// Selo de "tempo aguardando" da lista de conversas. DERIVADO do campo
// aguardandoDesde do relay (epoch em SEGUNDOS) — NÃO é SLA configurado.
// Módulo PURO: recebe o "agora" por parâmetro para ser testável.

export type NivelAguardando = 'ok' | 'atencao' | 'critico'

export interface SeloAguardando {
  /** Rótulo em caixa alta pronto para exibir, ex.: "AGUARDANDO 12MIN". */
  texto: string
  /** ok < 1h, atencao >= 1h, critico >= 4h. */
  nivel: NivelAguardando
}

const MINUTO = 60
const HORA = 60 * MINUTO
const DIA = 24 * HORA

/**
 * Calcula o selo de espera de uma conversa.
 * - null (respondida/sem mensagens) → null.
 * - < 1min → "AGUARDANDO AGORA" (evita o rótulo "0MIN", que lê como bug);
 *   < 60min → "AGUARDANDO XMIN"; < 24h → "AGUARDANDO XH"; >= 24h → "AGUARDANDO XD".
 *   Sempre arredondando PARA BAIXO.
 * - nivel: ok (< 1h), atencao (>= 1h), critico (>= 4h).
 */
export function rotuloAguardando(
  aguardandoDesde: number | null,
  agoraEpochSeg: number
): SeloAguardando | null {
  if (aguardandoDesde === null) return null

  // Relógio adiantado/dado futuro: trata como "acabou de chegar".
  const decorrido = Math.max(0, agoraEpochSeg - aguardandoDesde)

  let texto: string
  if (decorrido < MINUTO) {
    texto = 'AGUARDANDO AGORA'
  } else if (decorrido < HORA) {
    texto = `AGUARDANDO ${Math.floor(decorrido / MINUTO)}MIN`
  } else if (decorrido < DIA) {
    texto = `AGUARDANDO ${Math.floor(decorrido / HORA)}H`
  } else {
    texto = `AGUARDANDO ${Math.floor(decorrido / DIA)}D`
  }

  const nivel: NivelAguardando =
    decorrido >= 4 * HORA ? 'critico' : decorrido >= HORA ? 'atencao' : 'ok'

  return { texto, nivel }
}
