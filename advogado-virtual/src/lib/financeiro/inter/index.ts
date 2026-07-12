// Integração Banco Inter (BolePix v3 + Extrato) — superfície pública.
// SERVER-ONLY, INERTE: nenhum código de produção importa isto ainda. Ligar só
// com credenciais reais, testadas antes no sandbox (ver README.md).

export {
  estaConfigurado,
  envsFaltando,
  ambiente,
  baseUrl,
  contaCorrente,
  webhookCaPem,
  type AmbienteInter,
} from './config'

export {
  dispatcherMtls,
  obterToken,
  interFetch,
  type ResultadoInter,
} from './cliente'

export {
  emitirBolePix,
  consultarCobranca,
  cancelarCobranca,
  montarCorpoBolePix,
  normalizarBoleto,
  mapearSituacao,
  centavosParaReais,
  reaisParaCentavos,
  type EmitirBoletoInput,
  type PagadorInter,
  type BoletoInter,
  type SituacaoCobranca,
} from './boleto'

export {
  consultarExtratoCompleto,
  normalizarExtrato,
  casarComprovante,
  type LancamentoPix,
  type AlvoComprovante,
  type ResultadoMatch,
  type CriterioMatch,
} from './extrato'
