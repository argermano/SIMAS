import type { ProvedorAssinatura, DadosEnvioAssinatura, ResultadoEnvio } from './provedor'
import { mapearStatusD4Sign, type StatusAssinatura } from './status'
import { d4signDownloadDocument, d4signCancelDocument } from '@/lib/d4sign/client'

// Adapter D4Sign da interface ProvedorAssinatura. Envolve o client existente —
// comportamento idêntico ao atual.
export class ProvedorD4Sign implements ProvedorAssinatura {
  readonly nome = 'd4sign'

  disponivel(): boolean {
    const token = process.env.D4SIGN_API_TOKEN
    return !!token && !token.includes('PREENCHA')
  }

  mapearStatusWebhook(idExterno: string | null | undefined): StatusAssinatura | null {
    return mapearStatusD4Sign(idExterno)
  }

  urlDocumentoAssinado(docIdExterno: string): Promise<string> {
    return d4signDownloadDocument(docIdExterno)
  }

  async cancelar(docIdExterno: string, motivo = ''): Promise<void> {
    await d4signCancelDocument(docIdExterno, motivo)
  }

  // A orquestração de envio permanece na rota `assinar` por ora (fluxo
  // congelado). Este método fica reservado para a migração incremental.
  enviarParaAssinatura(_dados: DadosEnvioAssinatura): Promise<ResultadoEnvio> {
    throw new Error('enviarParaAssinatura via provider ainda não migrado (use a rota /contratos/[id]/assinar).')
  }
}
