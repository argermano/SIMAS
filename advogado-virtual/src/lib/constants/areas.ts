export const AREAS = {
  previdenciario: {
    id: 'previdenciario',
    nome: 'Previdenciário',
    icone: 'Shield',
    cor: '#e11d48',
    corBg: 'bg-rose-50',
    corTexto: 'text-rose-700',
    corBorda: 'border-rose-200',
    ativo: true,
    descricao: 'Aposentadoria, benefícios, auxílios e revisões',
    pecas: [
      'peticao_inicial', 'contestacao', 'replica', 'apelacao', 'agravo',
      'embargos', 'recurso_especial', 'tutela', 'cumprimento', 'contrarrazoes',
    ],
    modelos: [
      'procuracao', 'contrato_honorarios', 'substabelecimento', 'declaracao_hipossuficiencia',
    ],
    tipos_documento: [
      'cnis', 'indeferimento', 'cessacao', 'carta_concessao', 'laudo_medico',
      'ppp', 'ctps', 'procuracao', 'rg_cpf', 'comprovante_residencia', 'outro',
    ],
  },
  trabalhista: {
    id: 'trabalhista',
    nome: 'Trabalhista',
    icone: 'Briefcase',
    cor: '#D97706',
    corBg: 'bg-amber-50',
    corTexto: 'text-amber-700',
    corBorda: 'border-amber-200',
    ativo: true,
    descricao: 'Rescisão, horas extras, verbas trabalhistas e acordos',
    pecas: [
      'peticao_inicial', 'contestacao', 'replica', 'recurso_ordinario',
      'recurso_revista', 'agravo', 'embargos', 'tutela', 'cumprimento',
      'contrarrazoes', 'acordo',
    ],
    modelos: [
      'procuracao', 'contrato_honorarios', 'substabelecimento', 'notificacao_extrajudicial',
    ],
    tipos_documento: [
      'ctps', 'trct', 'holerites', 'contrato_trabalho', 'acordo_coletivo',
      'sentenca', 'acordao', 'ata_audiencia', 'procuracao', 'rg_cpf', 'outro',
    ],
  },
  civel: {
    id: 'civel',
    nome: 'Cível',
    icone: 'Scale',
    cor: '#059669',
    corBg: 'bg-emerald-50',
    corTexto: 'text-emerald-700',
    corBorda: 'border-emerald-200',
    ativo: true,
    descricao: 'Contratos, indenizações, cobranças e ações cíveis',
    pecas: [
      'peticao_inicial', 'contestacao', 'replica', 'apelacao', 'agravo',
      'embargos', 'recurso_especial', 'tutela', 'cumprimento', 'contrarrazoes', 'acordo',
    ],
    modelos: [
      'procuracao', 'contrato_honorarios', 'notificacao_extrajudicial', 'substabelecimento',
    ],
    tipos_documento: [
      'contrato', 'nota_fiscal', 'comprovante_pagamento', 'laudo_pericial',
      'sentenca', 'acordao', 'procuracao', 'rg_cpf', 'comprovante_residencia', 'outro',
    ],
  },
  criminal: {
    id: 'criminal',
    nome: 'Criminal',
    icone: 'Gavel',
    cor: '#DC2626',
    corBg: 'bg-red-50',
    corTexto: 'text-red-700',
    corBorda: 'border-red-200',
    ativo: true,
    descricao: 'Defesa criminal, habeas corpus e recursos penais',
    pecas: [
      'habeas_corpus', 'resposta_acusacao', 'alegacoes_finais', 'memorial_defesa',
      'apelacao', 'agravo', 'embargos', 'recurso_especial',
    ],
    modelos: [
      'procuracao', 'substabelecimento', 'contrato_honorarios',
    ],
    tipos_documento: [
      'boletim_ocorrencia', 'laudo_pericial', 'sentenca', 'acordao',
      'ata_audiencia', 'procuracao', 'rg_cpf', 'outro',
    ],
  },
  tributario: {
    id: 'tributario',
    nome: 'Tributário',
    icone: 'Receipt',
    cor: '#7C3AED',
    corBg: 'bg-violet-50',
    corTexto: 'text-violet-700',
    corBorda: 'border-violet-200',
    ativo: true,
    descricao: 'Impostos, parcelamentos e planejamento tributário',
    pecas: [
      'mandado_seguranca', 'impugnacao_auto_infracao', 'recurso_administrativo_fiscal',
      'acao_anulatoria', 'peticao_inicial', 'apelacao', 'embargos', 'tutela', 'cumprimento',
    ],
    modelos: [
      'procuracao', 'contrato_honorarios', 'substabelecimento',
    ],
    tipos_documento: [
      'certidao_debito', 'auto_infracao', 'guia_pagamento', 'declaracao_fiscal',
      'sentenca', 'acordao', 'procuracao', 'rg_cpf', 'cnpj', 'outro',
    ],
  },
  empresarial: {
    id: 'empresarial',
    nome: 'Empresarial',
    icone: 'Building2',
    cor: '#0891B2',
    corBg: 'bg-cyan-50',
    corTexto: 'text-cyan-700',
    corBorda: 'border-cyan-200',
    ativo: true,
    descricao: 'Contratos empresariais, societário e recuperação judicial',
    pecas: [
      'peticao_inicial', 'contestacao', 'replica', 'apelacao', 'agravo',
      'embargos', 'recurso_especial', 'tutela', 'cumprimento', 'contrarrazoes', 'acordo',
    ],
    modelos: [
      'procuracao', 'contrato_honorarios', 'notificacao_extrajudicial', 'substabelecimento',
    ],
    tipos_documento: [
      'contrato_social', 'balancete', 'ata_assembleia', 'certidao', 'nota_fiscal',
      'sentenca', 'acordao', 'procuracao', 'rg_cpf', 'cnpj', 'outro',
    ],
  },
} as const

export type AreaId = keyof typeof AREAS
export type Area = typeof AREAS[AreaId]
