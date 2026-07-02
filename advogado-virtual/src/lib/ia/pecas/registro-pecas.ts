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
// Prompts curados novos (RASCUNHO — pendentes de revisão de curadoria humana):
// réplica, apelação e recurso ordinário. Ver docs/PLANO-DESENVOLVIMENTO-OPUS.md (Lote 5).
import { buildPromptReplicaPrev, SYSTEM_REPLICA_PREV } from '@/lib/prompts/pecas/previdenciario/replica'
import { buildPromptApelacaoPrev, SYSTEM_APELACAO_PREV } from '@/lib/prompts/pecas/previdenciario/apelacao'
import { buildPromptReplicaTrab, SYSTEM_REPLICA_TRAB } from '@/lib/prompts/pecas/trabalhista/replica'
import { buildPromptRecursoOrdinarioTrab, SYSTEM_RECURSO_ORDINARIO_TRAB } from '@/lib/prompts/pecas/trabalhista/recurso-ordinario'
import { buildPromptReplicaCivel, SYSTEM_REPLICA_CIVEL } from '@/lib/prompts/pecas/civel/replica'
import { buildPromptApelacaoCivel, SYSTEM_APELACAO_CIVEL } from '@/lib/prompts/pecas/civel/apelacao'
import { buildPromptReplicaFamilia, SYSTEM_REPLICA_FAMILIA } from '@/lib/prompts/pecas/familia/replica'
import { buildPromptApelacaoFamilia, SYSTEM_APELACAO_FAMILIA } from '@/lib/prompts/pecas/familia/apelacao'
import { buildPromptReplicaMedico, SYSTEM_REPLICA_MEDICO } from '@/lib/prompts/pecas/medico/replica'
import { buildPromptApelacaoMedico, SYSTEM_APELACAO_MEDICO } from '@/lib/prompts/pecas/medico/apelacao'

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
    replica:         { system: SYSTEM_REPLICA_PREV, build: buildPromptReplicaPrev },
    apelacao:        { system: SYSTEM_APELACAO_PREV, build: buildPromptApelacaoPrev },
  },
  trabalhista: {
    peticao_inicial:   { system: SYSTEM_PETICAO_TRAB, build: buildPromptPeticaoInicialTrab },
    contestacao:       { system: SYSTEM_CONTESTACAO_TRAB, build: buildPromptContestacaoTrab },
    replica:           { system: SYSTEM_REPLICA_TRAB, build: buildPromptReplicaTrab },
    recurso_ordinario: { system: SYSTEM_RECURSO_ORDINARIO_TRAB, build: buildPromptRecursoOrdinarioTrab },
  },
  civel: {
    peticao_inicial: { system: SYSTEM_PETICAO_CIVEL, build: buildPromptPeticaoInicialCivel },
    contestacao:     { system: SYSTEM_CONTESTACAO_CIVEL, build: buildPromptContestacaoCivel },
    replica:         { system: SYSTEM_REPLICA_CIVEL, build: buildPromptReplicaCivel },
    apelacao:        { system: SYSTEM_APELACAO_CIVEL, build: buildPromptApelacaoCivel },
  },
  familia: {
    peticao_inicial: { system: SYSTEM_PETICAO_FAMILIA, build: buildPromptPeticaoInicialFamilia },
    contestacao:     { system: SYSTEM_CONTESTACAO_FAMILIA, build: buildPromptContestacaoFamilia },
    replica:         { system: SYSTEM_REPLICA_FAMILIA, build: buildPromptReplicaFamilia },
    apelacao:        { system: SYSTEM_APELACAO_FAMILIA, build: buildPromptApelacaoFamilia },
  },
  medico: {
    peticao_inicial: { system: SYSTEM_PETICAO_MEDICO, build: buildPromptPeticaoInicialMedico },
    contestacao:     { system: SYSTEM_CONTESTACAO_MEDICO, build: buildPromptContestacaoMedico },
    replica:         { system: SYSTEM_REPLICA_MEDICO, build: buildPromptReplicaMedico },
    apelacao:        { system: SYSTEM_APELACAO_MEDICO, build: buildPromptApelacaoMedico },
  },
}

/**
 * Seleciona o prompt curado para (área, tipo), ou null se não houver — caso em
 * que o motor usa o gerador genérico ciente da área e do tipo.
 */
export function selecionarPromptPeca(params: { area: string; tipo: string }): PromptCurado | null {
  return PROMPT_MAP[params.area]?.[params.tipo] ?? null
}
