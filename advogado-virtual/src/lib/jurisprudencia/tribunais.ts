/**
 * Lista de tribunais disponíveis para consulta na API Pública DataJud (CNJ)
 * Endpoint: https://api-publica.datajud.cnj.jus.br/api_publica_{alias}/_search
 */

export interface Tribunal {
  alias: string
  nome: string
  sigla: string
  grupo: 'superiores' | 'federal' | 'estadual' | 'trabalho'
}

export const TRIBUNAIS: Tribunal[] = [
  // Superiores
  { alias: 'stj', nome: 'Superior Tribunal de Justiça', sigla: 'STJ', grupo: 'superiores' },
  { alias: 'tst', nome: 'Tribunal Superior do Trabalho', sigla: 'TST', grupo: 'superiores' },

  // Federais
  { alias: 'trf1', nome: 'TRF 1ª Região (DF, GO, MG, BA, MA, MT, PA, PI, TO, AM, RO, RR, AC, AP)', sigla: 'TRF1', grupo: 'federal' },
  { alias: 'trf2', nome: 'TRF 2ª Região (RJ, ES)', sigla: 'TRF2', grupo: 'federal' },
  { alias: 'trf3', nome: 'TRF 3ª Região (SP, MS)', sigla: 'TRF3', grupo: 'federal' },
  { alias: 'trf4', nome: 'TRF 4ª Região (RS, PR, SC)', sigla: 'TRF4', grupo: 'federal' },
  { alias: 'trf5', nome: 'TRF 5ª Região (PE, CE, AL, SE, RN, PB)', sigla: 'TRF5', grupo: 'federal' },
  { alias: 'trf6', nome: 'TRF 6ª Região (MG)', sigla: 'TRF6', grupo: 'federal' },

  // Estaduais (principais)
  { alias: 'tjsp', nome: 'Tribunal de Justiça de São Paulo', sigla: 'TJSP', grupo: 'estadual' },
  { alias: 'tjrj', nome: 'Tribunal de Justiça do Rio de Janeiro', sigla: 'TJRJ', grupo: 'estadual' },
  { alias: 'tjmg', nome: 'Tribunal de Justiça de Minas Gerais', sigla: 'TJMG', grupo: 'estadual' },
  { alias: 'tjrs', nome: 'Tribunal de Justiça do Rio Grande do Sul', sigla: 'TJRS', grupo: 'estadual' },
  { alias: 'tjpr', nome: 'Tribunal de Justiça do Paraná', sigla: 'TJPR', grupo: 'estadual' },
  { alias: 'tjsc', nome: 'Tribunal de Justiça de Santa Catarina', sigla: 'TJSC', grupo: 'estadual' },
  { alias: 'tjba', nome: 'Tribunal de Justiça da Bahia', sigla: 'TJBA', grupo: 'estadual' },
  { alias: 'tjpe', nome: 'Tribunal de Justiça de Pernambuco', sigla: 'TJPE', grupo: 'estadual' },
  { alias: 'tjce', nome: 'Tribunal de Justiça do Ceará', sigla: 'TJCE', grupo: 'estadual' },
  { alias: 'tjgo', nome: 'Tribunal de Justiça de Goiás', sigla: 'TJGO', grupo: 'estadual' },
  { alias: 'tjdft', nome: 'Tribunal de Justiça do DF e Territórios', sigla: 'TJDFT', grupo: 'estadual' },
  { alias: 'tjes', nome: 'Tribunal de Justiça do Espírito Santo', sigla: 'TJES', grupo: 'estadual' },
  { alias: 'tjpa', nome: 'Tribunal de Justiça do Pará', sigla: 'TJPA', grupo: 'estadual' },
  { alias: 'tjma', nome: 'Tribunal de Justiça do Maranhão', sigla: 'TJMA', grupo: 'estadual' },
  { alias: 'tjam', nome: 'Tribunal de Justiça do Amazonas', sigla: 'TJAM', grupo: 'estadual' },
  { alias: 'tjmt', nome: 'Tribunal de Justiça do Mato Grosso', sigla: 'TJMT', grupo: 'estadual' },
  { alias: 'tjms', nome: 'Tribunal de Justiça do Mato Grosso do Sul', sigla: 'TJMS', grupo: 'estadual' },
  { alias: 'tjpb', nome: 'Tribunal de Justiça da Paraíba', sigla: 'TJPB', grupo: 'estadual' },
  { alias: 'tjal', nome: 'Tribunal de Justiça de Alagoas', sigla: 'TJAL', grupo: 'estadual' },
  { alias: 'tjrn', nome: 'Tribunal de Justiça do Rio Grande do Norte', sigla: 'TJRN', grupo: 'estadual' },
  { alias: 'tjpi', nome: 'Tribunal de Justiça do Piauí', sigla: 'TJPI', grupo: 'estadual' },
  { alias: 'tjse', nome: 'Tribunal de Justiça de Sergipe', sigla: 'TJSE', grupo: 'estadual' },
  { alias: 'tjro', nome: 'Tribunal de Justiça de Rondônia', sigla: 'TJRO', grupo: 'estadual' },
  { alias: 'tjto', nome: 'Tribunal de Justiça do Tocantins', sigla: 'TJTO', grupo: 'estadual' },
  { alias: 'tjac', nome: 'Tribunal de Justiça do Acre', sigla: 'TJAC', grupo: 'estadual' },
  { alias: 'tjap', nome: 'Tribunal de Justiça do Amapá', sigla: 'TJAP', grupo: 'estadual' },
  { alias: 'tjrr', nome: 'Tribunal de Justiça de Roraima', sigla: 'TJRR', grupo: 'estadual' },

  // Trabalho (principais)
  { alias: 'trt1',  nome: 'TRT 1ª Região (RJ)', sigla: 'TRT1', grupo: 'trabalho' },
  { alias: 'trt2',  nome: 'TRT 2ª Região (SP - Capital)', sigla: 'TRT2', grupo: 'trabalho' },
  { alias: 'trt3',  nome: 'TRT 3ª Região (MG)', sigla: 'TRT3', grupo: 'trabalho' },
  { alias: 'trt4',  nome: 'TRT 4ª Região (RS)', sigla: 'TRT4', grupo: 'trabalho' },
  { alias: 'trt5',  nome: 'TRT 5ª Região (BA)', sigla: 'TRT5', grupo: 'trabalho' },
  { alias: 'trt6',  nome: 'TRT 6ª Região (PE)', sigla: 'TRT6', grupo: 'trabalho' },
  { alias: 'trt9',  nome: 'TRT 9ª Região (PR)', sigla: 'TRT9', grupo: 'trabalho' },
  { alias: 'trt12', nome: 'TRT 12ª Região (SC)', sigla: 'TRT12', grupo: 'trabalho' },
  { alias: 'trt15', nome: 'TRT 15ª Região (SP - Campinas)', sigla: 'TRT15', grupo: 'trabalho' },
]

/** Tribunais padrão por área jurídica */
export const TRIBUNAIS_DEFAULT: Record<string, string[]> = {
  previdenciario: ['stj', 'trf1', 'trf3', 'trf4'],
  trabalhista:    ['tst', 'trt2', 'trt3', 'trt4'],
}

/** Grupos para UI */
export const GRUPOS_TRIBUNAL = {
  superiores: 'Tribunais Superiores',
  federal:    'Justiça Federal',
  estadual:   'Justiça Estadual',
  trabalho:   'Justiça do Trabalho',
} as const
