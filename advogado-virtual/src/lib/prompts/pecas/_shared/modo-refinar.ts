// Modo REFINAR do motor único (F0.2).
//
// Texto MOVIDO, byte a byte, de src/app/api/ia/refinamento-peca/route.ts
// (constante SYSTEM_REFINAMENTO e a montagem do prompt em `partes`). Nada foi
// reescrito: o único ajuste deliberado do pacote é a renderização dos
// documentos, que agora passa por `formatarDocumentos` (mesmo helper dos
// prompts curados) e portanto respeita MAX_CHARS_POR_DOC — antes o refino
// mandava o texto integral de TODOS os documentos e era o candidato nº 1 a
// estourar o teto de 600k chars (HTTP 413).
//
// A composição final do system (curado da área/tipo + este bloco) vive em
// montarPromptDoModo (src/lib/ia/pecas/motor.ts) e está travada por snapshot.

import { SYSTEM_REGRAS_FORENSE } from '../regras-formatacao'
import { formatarDocumentos } from './qualificacao'

export const SYSTEM_MODO_REFINAR = `Você é um advogado brasileiro extremamente experiente e minucioso, especialista em revisão e refinamento de peças processuais. Seu trabalho é receber uma peça existente, analisá-la junto com os documentos do caso e as instruções do advogado, e produzir uma versão refinada e melhorada.

REGRA FUNDAMENTAL — MANTER O PADRÃO DO ADVOGADO:
A peça original foi redigida pelo advogado e reflete o ESTILO, ESTRUTURA e MODELO preferido dele. Você DEVE:
- Preservar a mesma estrutura de seções e organização da peça original
- Manter o mesmo tom e estilo de redação do advogado
- Respeitar a ordem dos argumentos e a lógica de exposição original
- Manter o mesmo nível de formalidade e vocabulário
- NÃO reorganizar seções, NÃO alterar a estrutura dos pedidos, NÃO mudar o formato do preâmbulo
- Apenas MELHORAR o conteúdo dentro da estrutura existente, nunca substituir o modelo

REGRAS:
- Produza a peça completa em Markdown, pronta para uso
- Mantenha a estrutura formal da peça (endereçamento, qualificação, fatos, fundamentação, pedidos)
- Preserve dados corretos da peça original (nomes, CPFs, datas, etc.)
- Corrija erros factuais quando os documentos contradizem a peça
- Fortaleça a argumentação jurídica com base nos documentos
- Siga as instruções específicas do advogado
- Use formatação Markdown (##, **, etc.) para estruturar a peça
- Campos que não puderem ser determinados devem usar [PREENCHER]
- NÃO inclua comentários, explicações ou metadados — apenas a peça refinada
- NUNCA use linhas divisórias (---, ___, ***) — separe seções apenas com espaçamento e títulos

${SYSTEM_REGRAS_FORENSE}`

export interface DadosModoRefinar {
  /** Nome da área por extenso (ex.: 'Previdenciário', 'Direito Médico'). */
  areaNome: string
  /** Conteúdo atual da peça (a versão que será refinada). */
  pecaAtual: string
  /** Documentos do caso JÁ triados por relevância. */
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  /** Instrução do advogado para esta rodada de refino. */
  instrucoes?: string
}

/**
 * Prompt do modo refinar: peça atual + documentos do caso + instrução do
 * advogado. Documentos sem texto útil (≤10 chars) ficam de fora, como no
 * refinamento original.
 */
export function buildPromptModoRefinar(dados: DadosModoRefinar): string {
  const documentos = dados.documentos.filter((d) => (d.texto_extraido ?? '').trim().length > 10)

  const partes: string[] = [
    `Você é um advogado especialista em Direito ${dados.areaNome}. Refine a peça processual abaixo.`,
    '',
    '## PEÇA ORIGINAL (a ser refinada)',
    dados.pecaAtual,
  ]

  if (documentos.length > 0) {
    partes.push(
      '',
      '## DOCUMENTOS DO CASO',
      formatarDocumentos(documentos),
      '',
      'Use os documentos acima para corrigir dados, fortalecer argumentação e fundamentar melhor os pedidos.',
    )
  }

  if (dados.instrucoes?.trim()) {
    partes.push('', '## INSTRUÇÕES DO ADVOGADO (PRIORIDADE MÁXIMA)', dados.instrucoes.trim())
  }

  partes.push(
    '',
    '## TAREFA',
    `Produza a peça refinada COMPLETA em Markdown, considerando a área de ${dados.areaNome}.`,
    'IMPORTANTE: Mantenha EXATAMENTE o mesmo padrão, modelo e estrutura da peça original do advogado.',
    'Apenas melhore o conteúdo (argumentação, fundamentação, dados) dentro da estrutura existente.',
    'Aplique as instruções do advogado, cruze com os documentos e melhore a argumentação.',
    'NUNCA use linhas divisórias (---, ___) na peça.',
    'Responda APENAS com o Markdown da peça — sem explicações, sem comentários.',
  )

  return partes.join('\n')
}
