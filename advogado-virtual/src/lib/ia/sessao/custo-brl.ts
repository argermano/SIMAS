// Custo da sessão em REAIS — a ponte entre o medidor (USD, custo.ts) e a tela.
//
// O servidor mede em dólar porque é o que a Anthropic cobra de nós; o advogado
// nunca vê dólar nem token (§10 do plano). A cotação vem de
// `NEXT_PUBLIC_USD_BRL` — precisa do prefixo público porque quem formata é o
// painel, que roda no navegador — e cai em 5,70 quando ausente (a mesma
// constante do relatório de uso de IA). Markup e câmbio por tenant são da
// Fase 3 (`tenants.ia_config`) e não entram aqui.

import { formatarReais } from '@/lib/utils'

export const USD_BRL_PADRAO = 5.7

/** Cotação em vigor para a UI. Valor inválido/ausente → padrão. */
export function cotacaoUsdBrl(): number {
  // Referência estática ao env: é assim que o Next inlina a variável no bundle.
  const bruto = Number(process.env.NEXT_PUBLIC_USD_BRL)
  return Number.isFinite(bruto) && bruto > 0 ? bruto : USD_BRL_PADRAO
}

/** USD → BRL arredondado ao centavo. Negativo/NaN vira 0 (nunca "crédito"). */
export function usdParaReais(usd: number, cotacao: number = cotacaoUsdBrl()): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0
  return Math.round(usd * cotacao * 100) / 100
}

/**
 * Rótulo do custo. Uma rodada barata pode custar menos de um centavo: mostrar
 * "R$ 0,00" leria como "de graça", então esse caso vira "< R$ 0,01".
 */
export function formatarUsdEmReais(usd: number, cotacao: number = cotacaoUsdBrl()): string {
  const reais = usdParaReais(usd, cotacao)
  if (reais === 0) return usd > 0 ? '< R$ 0,01' : 'R$ 0,00'
  return formatarReais(reais)
}
