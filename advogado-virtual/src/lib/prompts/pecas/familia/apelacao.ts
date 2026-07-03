// Curado — revisão jurídica Fable em 2026-07-03 (docs/PARECER-FABLE-2026-07-03.md).
// Aprovação final do advogado responsável: validar lendo 1 peça gerada deste tipo.
import { construirApelacao } from '../_shared/construtores'

const { system, build } = construirApelacao({
  persona: 'de família',
  fundamentos: 'Código Civil (Direito de Família), CPC (em especial os arts. 693 a 699 — ações de família) e, quando aplicável, o ECA e a Lei de Alimentos (Lei 5.478/68)',
})

export const SYSTEM_APELACAO_FAMILIA = system
export const buildPromptApelacaoFamilia = build
