// Curado — revisão jurídica Fable em 2026-07-03 (docs/PARECER-FABLE-2026-07-03.md).
// Aprovação final do advogado responsável: validar lendo 1 peça gerada deste tipo.
import { construirRecursoOrdinario } from '../_shared/construtores'

const { system, build } = construirRecursoOrdinario({
  persona: 'trabalhista',
  fundamentos: 'CLT e CF/88',
})

export const SYSTEM_RECURSO_ORDINARIO_TRAB = system
export const buildPromptRecursoOrdinarioTrab = build
