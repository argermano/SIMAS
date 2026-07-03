import type { StatusAssinatura } from './status'

// Abstração de provedor de assinatura eletrônica (E6). Hoje o D4Sign é o único
// implementado; a interface permite acoplar Clicksign/ZapSign sem tocar nas
// rotas. Seleção por env PROVEDOR_ASSINATURA (default 'd4sign').
//
// Nota: a orquestração de ENVIO (upload → signatários → enviar) segue nas rotas
// atuais por ora; a migração para o método `enviarParaAssinatura` é incremental
// (o fluxo D4Sign de produção está congelado). A interface já define o contrato.

export interface DadosEnvioAssinatura {
  titulo: string
  pdfBase64: string
  signatarios: Array<{ nome: string; email: string; documento?: string }>
  webhookUrl?: string
}

export interface ResultadoEnvio {
  docIdExterno: string
  linkAssinatura?: string
}

export interface ProvedorAssinatura {
  /** Identificador do provedor (ex.: 'd4sign', 'zapsign'). */
  readonly nome: string

  /** false = credencial ausente → provedor indisponível (inerte). */
  disponivel(): boolean

  /** Mapeia o id de status do webhook do provedor para o status canônico. */
  mapearStatusWebhook(idExterno: string | null | undefined): StatusAssinatura | null

  /** URL (temporária ou permanente) do documento assinado. */
  urlDocumentoAssinado(docIdExterno: string): Promise<string>

  /** Cancela o processo de assinatura. */
  cancelar(docIdExterno: string, motivo?: string): Promise<void>

  /** Cria o documento e o envia para assinatura (migração incremental). */
  enviarParaAssinatura(dados: DadosEnvioAssinatura): Promise<ResultadoEnvio>
}
