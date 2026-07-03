import type { ProvedorAssinatura } from './provedor'
import { ProvedorD4Sign } from './d4sign'
import { ProvedorZapSign } from './zapsign'

export type { ProvedorAssinatura, DadosEnvioAssinatura, ResultadoEnvio } from './provedor'
export { type StatusAssinatura, mapearStatusD4Sign, assinaturaFinalizada, D4SIGN_STATUS_MAP } from './status'

/**
 * Provedor de assinatura ativo, escolhido por PROVEDOR_ASSINATURA
 * (default 'd4sign'). Retorna sempre um provedor; use `disponivel()` para saber
 * se há credencial configurada.
 */
export function getProvedorAssinatura(): ProvedorAssinatura {
  const escolhido = (process.env.PROVEDOR_ASSINATURA ?? 'd4sign').toLowerCase()
  switch (escolhido) {
    case 'zapsign':
      return new ProvedorZapSign()
    case 'd4sign':
    default:
      return new ProvedorD4Sign()
  }
}
