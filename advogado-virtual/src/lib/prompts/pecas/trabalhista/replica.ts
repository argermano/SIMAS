// Curado — revisão jurídica Fable em 2026-07-03 (docs/PARECER-FABLE-2026-07-03.md).
// Aprovação final do advogado responsável: validar lendo 1 peça gerada deste tipo.
import { construirReplica } from '../_shared/construtores'

const { system, build } = construirReplica({
  persona: 'trabalhista',
  fundamentos: 'CLT e CF/88, com aplicação subsidiária do CPC (art. 769 da CLT)',
  observacoes:
    'RITO TRABALHISTA: a manifestação sobre a contestação e documentos NÃO segue o prazo de 15 dias do CPC — o prazo é o fixado pelo juízo (ou a manifestação ocorre em audiência). Ajuste o tópico de tempestividade a essa realidade, indicando o prazo judicial com [PREENCHER] se não informado.',
})

export const SYSTEM_REPLICA_TRAB = system
export const buildPromptReplicaTrab = build
