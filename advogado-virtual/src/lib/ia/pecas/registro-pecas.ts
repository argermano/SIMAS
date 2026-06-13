// Registro central de prompts CURADOS de peças, por (área, tipo).
//
// Esta é a "camada de prompt" do motor de geração: cada combinação (área,
// tipo) pode ter um prompt feito à mão (system + builder). Combinações sem
// entrada caem no gerador genérico CIENTE da área e do tipo (ver
// selecionarPromptPeca → null + fallback no route handler).
//
// Princípio de produto: a geração não depende só da IA — parte é
// pré-programada via prompts curados. Curar uma nova (área, peça) é só
// adicionar uma entrada aqui; nada no motor precisa mudar.

import { buildPromptPeticaoInicialPrev, SYSTEM_PETICAO_PREV } from '@/lib/prompts/pecas/previdenciario/peticao-inicial'
import { buildPromptContestacaoPrev, SYSTEM_CONTESTACAO_PREV } from '@/lib/prompts/pecas/previdenciario/contestacao'
import { buildPromptPeticaoInicialTrab, SYSTEM_PETICAO_TRAB } from '@/lib/prompts/pecas/trabalhista/peticao-inicial'
import { buildPromptContestacaoTrab, SYSTEM_CONTESTACAO_TRAB } from '@/lib/prompts/pecas/trabalhista/contestacao'
import { buildPromptPeticaoInicialCivel, SYSTEM_PETICAO_CIVEL } from '@/lib/prompts/pecas/civel/peticao-inicial'
import { buildPromptContestacaoCivel, SYSTEM_CONTESTACAO_CIVEL } from '@/lib/prompts/pecas/civel/contestacao'
import { buildPromptPeticaoInicialFamilia, SYSTEM_PETICAO_FAMILIA } from '@/lib/prompts/pecas/familia/peticao-inicial'
import { buildPromptContestacaoFamilia, SYSTEM_CONTESTACAO_FAMILIA } from '@/lib/prompts/pecas/familia/contestacao'
import { buildPromptPeticaoInicialMedico, SYSTEM_PETICAO_MEDICO } from '@/lib/prompts/pecas/medico/peticao-inicial'
import { buildPromptContestacaoMedico, SYSTEM_CONTESTACAO_MEDICO } from '@/lib/prompts/pecas/medico/contestacao'

export type QualificacaoPartes = {
  autor?: {
    nome?: string; cpf?: string; rg?: string; orgao_expedidor?: string
    estado_civil?: string; nacionalidade?: string; profissao?: string
    endereco?: string; bairro?: string; cidade?: string; estado?: string; cep?: string
    telefone?: string; email?: string
  }
  reu?: {
    nome?: string; cnpj_cpf?: string; endereco?: string; cidade?: string; estado?: string
  }
}

export type PromptBuilder = (dados: {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  localizacao?: { cidade?: string; estado?: string }
  qualificacao?: QualificacaoPartes
}) => string

export type PromptCurado = { system: string; build: PromptBuilder }

// Registro de prompts curados (área → tipo → { system, build }).
export const PROMPT_MAP: Record<string, Record<string, PromptCurado>> = {
  previdenciario: {
    peticao_inicial: { system: SYSTEM_PETICAO_PREV, build: buildPromptPeticaoInicialPrev },
    contestacao:     { system: SYSTEM_CONTESTACAO_PREV, build: buildPromptContestacaoPrev },
  },
  trabalhista: {
    peticao_inicial: { system: SYSTEM_PETICAO_TRAB, build: buildPromptPeticaoInicialTrab },
    contestacao:     { system: SYSTEM_CONTESTACAO_TRAB, build: buildPromptContestacaoTrab },
  },
  civel: {
    peticao_inicial: { system: SYSTEM_PETICAO_CIVEL, build: buildPromptPeticaoInicialCivel },
    contestacao:     { system: SYSTEM_CONTESTACAO_CIVEL, build: buildPromptContestacaoCivel },
  },
  familia: {
    peticao_inicial: { system: SYSTEM_PETICAO_FAMILIA, build: buildPromptPeticaoInicialFamilia },
    contestacao:     { system: SYSTEM_CONTESTACAO_FAMILIA, build: buildPromptContestacaoFamilia },
  },
  medico: {
    peticao_inicial: { system: SYSTEM_PETICAO_MEDICO, build: buildPromptPeticaoInicialMedico },
    contestacao:     { system: SYSTEM_CONTESTACAO_MEDICO, build: buildPromptContestacaoMedico },
  },
}

/**
 * Seleciona o prompt curado para (área, tipo), ou null se não houver — caso em
 * que o motor usa o gerador genérico ciente da área e do tipo.
 */
export function selecionarPromptPeca(params: { area: string; tipo: string }): PromptCurado | null {
  return PROMPT_MAP[params.area]?.[params.tipo] ?? null
}
