// Inferência DETERMINÍSTICA da área jurídica de um caso a partir dos sinais do
// processo/publicação (classe, órgão julgador, assuntos). Módulo PURO (sem SDK/
// DB): só normalização + regras de palavra-chave — testável e reusável pela rota
// que pré-cria o caso e pelo preview do assistente de vínculo.
//
// Uso real (dono): uma tarefa nascida de publicação, vinculada a um PROCESSO sem
// caso, precisa virar um CASO no motor de peças em 1 clique. Aqui decidimos a
// ÁREA (id real de AREAS) pelos dados; quando nada casa, devolvemos confiança
// 'baixa' e a UI pede a escolha (ou a rota aciona o fallback de IA).
//
// Ordem das regras = da mais específica (órgão especializado) para a genérica
// (cível): uma "Cumprimento de Sentença" na Vara do Trabalho é trabalhista, não
// cível — por isso trabalhista/previdenciário/família/criminal são testados
// ANTES do cível (que também casa "cumprimento de sentença").

import { AREAS, type AreaId } from '@/lib/constants/areas'

export type ConfiancaArea = 'alta' | 'baixa'

/** Sinais do processo/publicação usados na inferência determinística. */
export interface SinaisArea {
  classe?: string | null
  orgaoJulgador?: string | null
  assuntos?: string[] | null
}

export interface AreaInferida {
  area: AreaId
  confianca: ConfiancaArea
}

/** Área padrão quando nada casa (a mais genérica) — sempre com confiança baixa. */
const AREA_PADRAO: AreaId = 'civel'

/** minúsculas + sem acentos (comparação insensível a caixa/acento). */
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Regras ordenadas (a 1ª que casa vence). Cada regex roda sobre o texto
// normalizado (classe + órgão + assuntos concatenados, sem acento). Só áreas que
// existem em AREAS. Órgão especializado > classe genérica.
const REGRAS: Array<{ area: AreaId; re: RegExp }> = [
  // Trabalhista: Vara/Juizado (Especial) do Trabalho, Justiça/TRT, verbas.
  // (vara|juizado|...)(...){0,3} do trabalho cobre "Juizado Especial do Trabalho".
  { area: 'trabalhista', re: /justica do trabalho|(vara|juizado|tribunal|turma)(\s+\w+){0,3}?\s+do\s+trabalho|\btrabalhista\b|\btrt\b|reclamat|verbas rescis|horas extras/ },
  // Previdenciário: INSS, benefício, aposentadoria, auxílio, Vara Previdenciária, LOAS.
  { area: 'previdenciario', re: /\binss\b|previdenci|beneficio|aposentador|auxilio(-| )?(doenca|acidente|reclusao)?|amparo social|\bloas\b|\bbpc\b/ },
  // Família: Vara de Família, divórcio, alimentos, guarda, inventário, sucessões.
  { area: 'familia', re: /\bfamilia\b|vara de familia|divorcio|alimentos|\bguarda\b|inventario|arrolamento|uniao estavel|sucess/ },
  // Criminal: matéria/vara/juizado criminal, penal, habeas corpus, execução penal.
  { area: 'criminal', re: /\bcriminal\b|\bcrime\b|\bpenal\b|habeas corpus|execucao penal/ },
  // Cível (catch dos cíveis): Juizado Especial Cível, Vara Cível, cumprimento de
  // sentença, execução de título, monitória, indenização, cobrança.
  { area: 'civel', re: /juizado especial (civel|da fazenda)|\bjec\b|vara( unica)? civel|\bcivel\b|cumprimento de sentenca|execucao de titulo|monitoria|indenizac|\bcobranca\b/ },
]

/**
 * Infere a área jurídica pelos sinais do processo (determinístico). Devolve a
 * área da 1ª regra que casa com confiança 'alta'; se nada casa, devolve a área
 * padrão com confiança 'baixa' (a UI/rota pede a escolha ou aciona a IA).
 */
export function inferirAreaDoProcesso(sinais: SinaisArea): AreaInferida {
  const texto = norm(
    [sinais.classe, sinais.orgaoJulgador, ...(sinais.assuntos ?? [])].filter(Boolean).join(' · '),
  )
  if (texto.trim()) {
    for (const { area, re } of REGRAS) {
      if (re.test(texto)) return { area, confianca: 'alta' }
    }
  }
  return { area: AREA_PADRAO, confianca: 'baixa' }
}

/** Ids de área válidos (para validar a escolha do usuário / a saída da IA). */
export function ehAreaValida(v: unknown): v is AreaId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(AREAS, v)
}

/** Nome amigável da área (fallback: o próprio id) — para toasts/rótulos. */
export function nomeArea(area: string): string {
  return (AREAS as Record<string, { nome: string } | undefined>)[area]?.nome ?? area
}
