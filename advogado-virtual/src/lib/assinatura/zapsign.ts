import type { ProvedorAssinatura, DadosEnvioAssinatura, ResultadoEnvio } from './provedor'
import type { StatusAssinatura } from './status'

// Esqueleto ZapSign (E6). Implementa a interface, mas fica INERTE sem
// ZAPSIGN_API_TOKEN. Quando o token for provisionado, preencher as chamadas à
// API do ZapSign. Selecionado por PROVEDOR_ASSINATURA=zapsign.
//
// Status ZapSign (doc): 'pending' | 'signed' | 'refused' | 'expired' → canônico.
const ZAPSIGN_STATUS_MAP: Record<string, StatusAssinatura> = {
  pending: 'waiting_signatures',
  signed:  'completed',
  refused: 'cancelled',
  expired: 'cancelled',
}

export class ProvedorZapSign implements ProvedorAssinatura {
  readonly nome = 'zapsign'

  disponivel(): boolean {
    const token = process.env.ZAPSIGN_API_TOKEN
    return !!token && !token.includes('PREENCHA')
  }

  mapearStatusWebhook(idExterno: string | null | undefined): StatusAssinatura | null {
    return idExterno ? (ZAPSIGN_STATUS_MAP[idExterno.toLowerCase()] ?? null) : null
  }

  urlDocumentoAssinado(_docIdExterno: string): Promise<string> {
    throw new Error('ZapSign não implementado — provisione ZAPSIGN_API_TOKEN e implemente o adapter.')
  }

  cancelar(_docIdExterno: string, _motivo?: string): Promise<void> {
    throw new Error('ZapSign não implementado.')
  }

  enviarParaAssinatura(_dados: DadosEnvioAssinatura): Promise<ResultadoEnvio> {
    throw new Error('ZapSign não implementado.')
  }
}
