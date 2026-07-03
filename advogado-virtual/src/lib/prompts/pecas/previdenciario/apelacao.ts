// Curado — revisão jurídica Fable em 2026-07-03 (docs/PARECER-FABLE-2026-07-03.md).
// Aprovação final do advogado responsável: validar lendo 1 peça gerada deste tipo.
import { construirApelacao } from '../_shared/construtores'

const { system, build } = construirApelacao({
  persona: 'previdenciarista',
  fundamentos: 'Lei 8.213/91, Decreto 3.048/99, EC 103/2019 (regras de transição) e CF/88',
  observacoes:
    'CABIMENTO — ATENÇÃO: se o feito tramitar em Juizado Especial Federal (JEF), o recurso cabível é o RECURSO INOMINADO (prazo de 10 dias — art. 42 da Lei 9.099/95 c/c Lei 10.259/2001), e NÃO a apelação. Nesse caso, inicie o documento com um AVISO destacado ao advogado sobre o cabimento e o prazo distintos.',
})

export const SYSTEM_APELACAO_PREV = system
export const buildPromptApelacaoPrev = build
