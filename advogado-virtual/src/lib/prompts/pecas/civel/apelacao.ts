// Curado — revisão jurídica Fable em 2026-07-03 (docs/PARECER-FABLE-2026-07-03.md).
// Aprovação final do advogado responsável: validar lendo 1 peça gerada deste tipo.
import { construirApelacao } from '../_shared/construtores'

const { system, build } = construirApelacao({
  persona: 'cível',
  fundamentos: 'Código Civil, CPC e, quando aplicável, o Código de Defesa do Consumidor',
})

export const SYSTEM_APELACAO_CIVEL = system
export const buildPromptApelacaoCivel = build
