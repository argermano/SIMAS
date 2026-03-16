export const AREAS = {
  previdenciario: {
    id: 'previdenciario',
    nome: 'Previdenciário',
    icone: 'Shield',
    cor: '#3B4FCC',
    corBg: 'bg-primary/10',
    corTexto: 'text-primary',
    corBorda: 'border-primary/20',
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
    cor: '#2DB877',
    corBg: 'bg-success/10',
    corTexto: 'text-success',
    corBorda: 'border-success/20',
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
      'extrato_fgts', 'cnis',
      'sentenca', 'acordao', 'ata_audiencia', 'procuracao', 'rg_cpf', 'outro',
    ],
  },
  civel: {
    id: 'civel',
    nome: 'Cível',
    icone: 'Scale',
    cor: '#2BA4E6',
    corBg: 'bg-info/10',
    corTexto: 'text-info',
    corBorda: 'border-info/20',
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
  familia: {
    id: 'familia',
    nome: 'Família',
    icone: 'Heart',
    cor: '#E91E63',
    corBg: 'bg-[#E91E63]/10',
    corTexto: 'text-[#E91E63]',
    corBorda: 'border-[#E91E63]/20',
    ativo: true,
    descricao: 'Divórcio, guarda, alimentos, inventário e sucessões',
    pecas: [
      'peticao_inicial', 'contestacao', 'replica', 'apelacao', 'agravo',
      'embargos', 'recurso_especial', 'tutela', 'cumprimento', 'contrarrazoes', 'acordo',
    ],
    modelos: [
      'procuracao', 'contrato_honorarios', 'substabelecimento', 'declaracao_hipossuficiencia',
    ],
    tipos_documento: [
      'certidao_casamento', 'certidao_nascimento', 'certidao_obito',
      'pacto_antenupcial', 'escritura_uniao_estavel', 'comprovante_renda',
      'declaracao_ir', 'escritura_imovel', 'extrato_bancario',
      'sentenca', 'acordao', 'procuracao', 'rg_cpf', 'comprovante_residencia', 'outro',
    ],
  },
  criminal: {
    id: 'criminal',
    nome: 'Criminal',
    icone: 'Gavel',
    cor: '#D94040',
    corBg: 'bg-destructive/10',
    corTexto: 'text-destructive',
    corBorda: 'border-destructive/20',
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
    cor: '#F5A623',
    corBg: 'bg-warning/10',
    corTexto: 'text-warning',
    corBorda: 'border-warning/20',
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
    cor: '#0ea5e9',
    corBg: 'bg-[#0ea5e9]/10',
    corTexto: 'text-[#0ea5e9]',
    corBorda: 'border-[#0ea5e9]/20',
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
  medico: {
    id: 'medico',
    nome: 'Direito Médico',
    icone: 'Stethoscope',
    cor: '#10b981',
    corBg: 'bg-[#10b981]/10',
    corTexto: 'text-[#10b981]',
    corBorda: 'border-[#10b981]/20',
    ativo: true,
    descricao: 'Erro médico, planos de saúde e responsabilidade civil médica',
    pecas: [
      'peticao_inicial', 'contestacao', 'replica', 'apelacao', 'agravo',
      'embargos', 'recurso_especial', 'tutela', 'cumprimento', 'contrarrazoes', 'acordo',
    ],
    modelos: [
      'procuracao', 'contrato_honorarios', 'substabelecimento', 'notificacao_extrajudicial',
    ],
    tipos_documento: [
      'prontuario_medico', 'laudo_medico', 'laudo_pericial', 'exame',
      'receita_medica', 'nota_fiscal_medica', 'contrato_plano_saude',
      'negativa_plano', 'termo_consentimento', 'atestado_obito',
      'sentenca', 'acordao', 'procuracao', 'rg_cpf', 'comprovante_residencia', 'outro',
    ],
  },
} as const

export type AreaId = keyof typeof AREAS
export type Area = typeof AREAS[AreaId]
