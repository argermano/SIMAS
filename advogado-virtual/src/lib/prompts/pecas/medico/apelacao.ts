// Curado — revisão jurídica Fable em 2026-07-03 (docs/PARECER-FABLE-2026-07-03.md).
// Aprovação final do advogado responsável: validar lendo 1 peça gerada deste tipo.
import { construirApelacao } from '../_shared/construtores'

const { system, build } = construirApelacao({
  persona: 'especializado em responsabilidade civil médica',
  fundamentos: 'Código Civil (arts. 186, 927 e 951), Código de Defesa do Consumidor (arts. 6º e 14), Lei 9.656/98 (planos de saúde) e as Súmulas 302, 387, 597, 608 e 609 do STJ',
})

export const SYSTEM_APELACAO_MEDICO = system
export const buildPromptApelacaoMedico = build
