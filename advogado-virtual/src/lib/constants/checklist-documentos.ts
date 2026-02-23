// Checklist de documentos necessários por área / tipo de serviço / tipo de processo

export type TipoServico = 'administrativo' | 'judicial'

export interface ItemChecklist {
  id: string
  nome: string
  obrigatorio: boolean
  /** Se true, é gerado pelo escritório (Procuração, Contrato, etc.) */
  geradoPeloEscritorio?: boolean
  modeloId?: string // ID em MODELOS_PRONTOS
}

export interface OpcaoProcesso {
  value: string
  label: string
}

// ── Processos judiciais por área ────────────────────────────────────────────

export const TIPOS_PROCESSO: Record<string, OpcaoProcesso[]> = {
  previdenciario: [
    { value: 'aposentadoria_idade',       label: 'Aposentadoria por Idade' },
    { value: 'aposentadoria_tempo',       label: 'Aposentadoria por Tempo de Contribuição' },
    { value: 'aposentadoria_especial',    label: 'Aposentadoria Especial' },
    { value: 'aposentadoria_invalidez',   label: 'Aposentadoria por Invalidez' },
    { value: 'auxilio_doenca',            label: 'Auxílio-Doença' },
    { value: 'bpc_loas',                  label: 'BPC/LOAS' },
    { value: 'pensao_morte',              label: 'Pensão por Morte' },
    { value: 'salario_maternidade',       label: 'Salário-Maternidade' },
    { value: 'revisao_beneficio',         label: 'Revisão de Benefício' },
    { value: 'recurso_inss',              label: 'Recurso Administrativo INSS' },
  ],
  trabalhista: [
    { value: 'reclamatoria',              label: 'Reclamatória Trabalhista' },
    { value: 'rescisao_indireta',         label: 'Rescisão Indireta' },
    { value: 'horas_extras',              label: 'Horas Extras' },
    { value: 'acidente_trabalho',         label: 'Acidente de Trabalho' },
    { value: 'assedio_moral',             label: 'Assédio Moral' },
    { value: 'equiparacao_salarial',      label: 'Equiparação Salarial' },
    { value: 'acordo_trabalhista',        label: 'Acordo Trabalhista' },
    { value: 'execucao_trabalhista',      label: 'Execução Trabalhista' },
  ],
}

// ── Documentos comuns (base) ─────────────────────────────────────────────────

const DOC_RG_CPF: ItemChecklist          = { id: 'rg_cpf',              nome: 'RG e CPF',                            obrigatorio: true  }
const DOC_RESIDENCIA: ItemChecklist      = { id: 'comp_residencia',      nome: 'Comprovante de residência',           obrigatorio: true  }
const DOC_PROCURACAO: ItemChecklist      = { id: 'procuracao',           nome: 'Procuração',                          obrigatorio: true,  geradoPeloEscritorio: true, modeloId: 'procuracao'                  }
const DOC_CONTRATO: ItemChecklist        = { id: 'contrato_honorarios',  nome: 'Contrato de Honorários',              obrigatorio: true,  geradoPeloEscritorio: true, modeloId: 'contrato_honorarios'         }
const DOC_DECLARACAO: ItemChecklist      = { id: 'declaracao_hipos',     nome: 'Declaração de Hipossuficiência',      obrigatorio: false, geradoPeloEscritorio: true, modeloId: 'declaracao_hipossuficiencia' }
const DOC_CNIS: ItemChecklist            = { id: 'cnis',                 nome: 'CNIS (Extrato Previdenciário)',        obrigatorio: true  }
const DOC_CTPS: ItemChecklist            = { id: 'ctps',                 nome: 'Carteira de Trabalho (CTPS)',         obrigatorio: true  }
const DOC_PPP: ItemChecklist             = { id: 'ppp',                  nome: 'PPP (Perfil Profissiográfico)',        obrigatorio: true  }
const DOC_LAUDO: ItemChecklist           = { id: 'laudo_medico',         nome: 'Laudo médico atualizado',             obrigatorio: true  }
const DOC_RELATORIO: ItemChecklist       = { id: 'relatorio_medico',     nome: 'Relatório médico',                    obrigatorio: false }
const DOC_INDEFERIMENTO: ItemChecklist   = { id: 'indeferimento',        nome: 'Carta de indeferimento INSS',         obrigatorio: false }
const DOC_CARTA_CONCESSAO: ItemChecklist = { id: 'carta_concessao',      nome: 'Carta de concessão',                  obrigatorio: false }
const DOC_RENDA_FAMILIAR: ItemChecklist  = { id: 'comp_renda',           nome: 'Comprovante de renda familiar',       obrigatorio: true  }
const DOC_HOLERITES: ItemChecklist       = { id: 'holerites',            nome: 'Holerites (últimos 3 meses)',         obrigatorio: true  }
const DOC_TRCT: ItemChecklist            = { id: 'trct',                 nome: 'TRCT (Termo de Rescisão)',            obrigatorio: false }
const DOC_CONTRATO_TRAB: ItemChecklist   = { id: 'contrato_trabalho',    nome: 'Contrato de trabalho',                obrigatorio: false }

// ── Checklists por área / serviço / processo ─────────────────────────────────

type ChecklistMap = Record<string, Record<string, ItemChecklist[]>>

export const CHECKLIST: ChecklistMap = {
  previdenciario: {
    // Serviço administrativo (consultoria, recursos, etc.)
    administrativo: [
      DOC_RG_CPF, DOC_CNIS, DOC_RESIDENCIA,
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    // Processos judiciais — por tipo
    aposentadoria_idade: [
      DOC_RG_CPF, DOC_CNIS, DOC_CTPS, DOC_RESIDENCIA,
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    aposentadoria_tempo: [
      DOC_RG_CPF, DOC_CNIS, DOC_CTPS, DOC_PPP, DOC_RESIDENCIA,
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    aposentadoria_especial: [
      DOC_RG_CPF, DOC_CNIS, DOC_CTPS, DOC_PPP, DOC_RESIDENCIA,
      { id: 'ltcat', nome: 'LTCAT (Laudo Técnico de Condições Ambientais)', obrigatorio: true },
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    aposentadoria_invalidez: [
      DOC_RG_CPF, DOC_CNIS, DOC_LAUDO, DOC_RELATORIO, DOC_RESIDENCIA,
      DOC_INDEFERIMENTO,
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    auxilio_doenca: [
      DOC_RG_CPF, DOC_CNIS, DOC_LAUDO, DOC_RELATORIO, DOC_RESIDENCIA,
      DOC_INDEFERIMENTO,
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    bpc_loas: [
      DOC_RG_CPF, DOC_CNIS, DOC_LAUDO, DOC_RENDA_FAMILIAR, DOC_RESIDENCIA,
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    pensao_morte: [
      DOC_RG_CPF, DOC_CNIS, DOC_RESIDENCIA,
      { id: 'certidao_obito', nome: 'Certidão de óbito', obrigatorio: true },
      { id: 'doc_dependente', nome: 'Documentos de dependente (casamento/nascimento)', obrigatorio: true },
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    salario_maternidade: [
      DOC_RG_CPF, DOC_CNIS, DOC_RESIDENCIA,
      { id: 'certidao_nascimento', nome: 'Certidão de nascimento / DNV', obrigatorio: true },
      DOC_INDEFERIMENTO,
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    revisao_beneficio: [
      DOC_RG_CPF, DOC_CNIS, DOC_CARTA_CONCESSAO, DOC_RESIDENCIA,
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    recurso_inss: [
      DOC_RG_CPF, DOC_CNIS, DOC_INDEFERIMENTO, DOC_RESIDENCIA,
      DOC_PROCURACAO, DOC_CONTRATO,
    ],
  },
  trabalhista: {
    administrativo: [
      DOC_RG_CPF, DOC_CTPS, DOC_HOLERITES, DOC_RESIDENCIA,
      DOC_PROCURACAO, DOC_CONTRATO,
    ],
    reclamatoria: [
      DOC_RG_CPF, DOC_CTPS, DOC_HOLERITES, DOC_TRCT, DOC_CONTRATO_TRAB, DOC_RESIDENCIA,
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    rescisao_indireta: [
      DOC_RG_CPF, DOC_CTPS, DOC_HOLERITES, DOC_CONTRATO_TRAB, DOC_RESIDENCIA,
      { id: 'notificacao_empregador', nome: 'Notificação ao empregador', obrigatorio: false },
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    horas_extras: [
      DOC_RG_CPF, DOC_CTPS, DOC_HOLERITES, DOC_CONTRATO_TRAB, DOC_RESIDENCIA,
      { id: 'cartao_ponto', nome: 'Cartão de ponto / controle de jornada', obrigatorio: false },
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    acidente_trabalho: [
      DOC_RG_CPF, DOC_CTPS, DOC_LAUDO, DOC_RESIDENCIA,
      { id: 'cat', nome: 'CAT (Comunicação de Acidente de Trabalho)', obrigatorio: false },
      { id: 'boletim_ocorrencia', nome: 'Boletim de ocorrência (se houver)', obrigatorio: false },
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    assedio_moral: [
      DOC_RG_CPF, DOC_CTPS, DOC_RESIDENCIA,
      { id: 'prints_mensagens', nome: 'Prints / registros de mensagens', obrigatorio: false },
      { id: 'testemunhas',      nome: 'Contato de testemunhas',          obrigatorio: false },
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    equiparacao_salarial: [
      DOC_RG_CPF, DOC_CTPS, DOC_HOLERITES, DOC_CONTRATO_TRAB, DOC_RESIDENCIA,
      DOC_PROCURACAO, DOC_CONTRATO, DOC_DECLARACAO,
    ],
    acordo_trabalhista: [
      DOC_RG_CPF, DOC_CTPS, DOC_HOLERITES, DOC_CONTRATO_TRAB, DOC_RESIDENCIA,
      DOC_PROCURACAO, DOC_CONTRATO,
    ],
    execucao_trabalhista: [
      DOC_RG_CPF, DOC_RESIDENCIA,
      { id: 'titulo_executivo', nome: 'Título executivo (sentença/acordo)', obrigatorio: true },
      DOC_PROCURACAO, DOC_CONTRATO,
    ],
  },
}

/** Retorna o checklist para uma área + tipo de serviço/processo */
export function getChecklist(area: string, tipoServico: TipoServico, tipoProcesso?: string): ItemChecklist[] {
  const mapa = CHECKLIST[area]
  if (!mapa) return []

  if (tipoServico === 'administrativo') {
    return mapa['administrativo'] ?? []
  }

  // Judicial: usa tipo_processo como chave
  return mapa[tipoProcesso ?? ''] ?? []
}
