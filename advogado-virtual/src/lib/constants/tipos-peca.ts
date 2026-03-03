export const TIPOS_PECA: Record<string, { id: string; nome: string; descricao: string }> = {
  peticao_inicial:              { id: 'peticao_inicial',              nome: 'Petição Inicial',                descricao: 'Peça inaugural da ação' },
  contestacao:                  { id: 'contestacao',                  nome: 'Contestação',                    descricao: 'Defesa do réu' },
  replica:                      { id: 'replica',                      nome: 'Réplica',                        descricao: 'Resposta à contestação' },
  apelacao:                     { id: 'apelacao',                     nome: 'Apelação',                       descricao: 'Recurso contra sentença' },
  agravo:                       { id: 'agravo',                       nome: 'Agravo',                         descricao: 'Recurso contra decisão interlocutória' },
  embargos:                     { id: 'embargos',                     nome: 'Embargos',                       descricao: 'Embargos de declaração ou à execução' },
  recurso_ordinario:            { id: 'recurso_ordinario',            nome: 'Recurso Ordinário',              descricao: 'Recurso trabalhista contra sentença' },
  recurso_especial:             { id: 'recurso_especial',             nome: 'Recurso Especial',               descricao: 'Recurso para tribunal superior' },
  recurso_revista:              { id: 'recurso_revista',              nome: 'Recurso de Revista',             descricao: 'Recurso trabalhista para TST' },
  tutela:                       { id: 'tutela',                       nome: 'Tutela de Urgência',             descricao: 'Tutela de urgência ou evidência' },
  cumprimento:                  { id: 'cumprimento',                  nome: 'Cumprimento',                    descricao: 'Cumprimento de sentença' },
  contrarrazoes:                { id: 'contrarrazoes',                nome: 'Contrarrazões',                  descricao: 'Resposta a recurso da parte contrária' },
  acordo:                       { id: 'acordo',                       nome: 'Acordo',                         descricao: 'Proposta de acordo judicial/extrajudicial' },
  // Criminal
  habeas_corpus:                { id: 'habeas_corpus',                nome: 'Habeas Corpus',                  descricao: 'Garantia de liberdade de locomoção' },
  resposta_acusacao:            { id: 'resposta_acusacao',            nome: 'Resposta à Acusação',            descricao: 'Defesa preliminar na fase criminal' },
  alegacoes_finais:             { id: 'alegacoes_finais',             nome: 'Alegações Finais',               descricao: 'Memoriais ao final da instrução criminal' },
  memorial_defesa:              { id: 'memorial_defesa',              nome: 'Memorial de Defesa',             descricao: 'Memorial apresentado no júri ou instrução' },
  // Tributário / Administrativo
  mandado_seguranca:            { id: 'mandado_seguranca',            nome: 'Mandado de Segurança',           descricao: 'Controle de ato ilegal ou abusivo de autoridade' },
  impugnacao_auto_infracao:     { id: 'impugnacao_auto_infracao',     nome: 'Impugnação a Auto de Infração',  descricao: 'Defesa administrativa contra autuação fiscal' },
  recurso_administrativo_fiscal:{ id: 'recurso_administrativo_fiscal',nome: 'Recurso Administrativo Fiscal',  descricao: 'Recurso em processo administrativo tributário' },
  acao_anulatoria:              { id: 'acao_anulatoria',              nome: 'Ação Anulatória',                descricao: 'Anulação de lançamento fiscal ou débito tributário' },
}

export const MODELOS_PRONTOS: Record<string, { id: string; nome: string; descricao: string }> = {
  procuracao:                    { id: 'procuracao',                    nome: 'Procuração',                   descricao: 'Outorga de poderes ao advogado' },
  contrato_honorarios:           { id: 'contrato_honorarios',           nome: 'Contrato de Honorários',       descricao: 'Contrato de prestação de serviços advocatícios' },
  substabelecimento:             { id: 'substabelecimento',             nome: 'Substabelecimento',            descricao: 'Transferência de poderes a outro advogado' },
  declaracao_hipossuficiencia:   { id: 'declaracao_hipossuficiencia',   nome: 'Declaração de Hipossuficiência', descricao: 'Declaração para justiça gratuita' },
  notificacao_extrajudicial:     { id: 'notificacao_extrajudicial',     nome: 'Notificação Extrajudicial',    descricao: 'Notificação formal antes da ação judicial' },
}
