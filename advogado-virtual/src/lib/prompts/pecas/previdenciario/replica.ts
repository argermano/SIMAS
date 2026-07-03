// Curado — revisão jurídica Fable em 2026-07-03 (docs/PARECER-FABLE-2026-07-03.md).
// Aprovação final do advogado responsável: validar lendo 1 peça gerada deste tipo.
import { construirReplica } from '../_shared/construtores'

const { system, build } = construirReplica({
  persona: 'previdenciarista',
  fundamentos: 'Lei 8.213/91, Decreto 3.048/99, EC 103/2019 (regras de transição) e CF/88',
})

export const SYSTEM_REPLICA_PREV = system
export const buildPromptReplicaPrev = build
