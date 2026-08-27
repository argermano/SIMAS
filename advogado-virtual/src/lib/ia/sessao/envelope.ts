// Envelope da RODADA da sessão de lapidação (F0.3).
//
// A rodada não devolve texto solto: devolve um objeto com o que dizer ao
// advogado (`resposta_markdown`) e, quando é para mexer na peça, a `proposta`
// de patch por seção. O formato é garantido pelo structured output da API
// (output_config.format = { type: 'json_schema', schema }) — o mesmo schema
// exportado aqui —, e revalidado por Zod do nosso lado: a API garante a FORMA,
// nós garantimos que os valores fazem sentido para o aplicador de patch.
//
// A ordem das propriedades no schema NÃO é decorativa: `resposta_markdown` vem
// primeiro porque o modelo gera os campos nessa ordem, e é o que permite
// transmitir a resposta ao advogado enquanto as seções ainda estão sendo
// escritas (ver extrator-campo.ts).

import { z } from 'zod'
import { extrairJsonDoTexto } from '@/lib/anthropic/client'
import { ACOES_SECAO, type SecaoPatch } from '@/lib/diff/patch-secoes'

export const secaoPatchSchema = z.object({
  titulo: z.string(),
  acao: z.enum(['substituir', 'inserir_apos', 'remover', 'inserir_inicio']),
  conteudo_markdown: z.string().optional().default(''),
  motivo: z.string().optional().default(''),
})

export const propostaSchema = z.object({
  resumo: z.string().optional().default(''),
  secoes: z.array(secaoPatchSchema).default([]),
})

export const envelopeRodadaSchema = z.object({
  resposta_markdown: z.string().optional().default(''),
  proposta: propostaSchema.nullish(),
})

export type PropostaRodada = { resumo: string; secoes: SecaoPatch[] }
export interface EnvelopeRodada {
  resposta_markdown: string
  proposta?: PropostaRodada
}

/** Campo do envelope transmitido ao vivo para o advogado. */
export const CAMPO_RESPOSTA = 'resposta_markdown'

/**
 * JSON Schema do envelope (structured outputs). Constante e determinístico —
 * ele entra no prefixo do prompt e qualquer variação invalidaria o cache.
 */
export const ESQUEMA_ENVELOPE = {
  type: 'object',
  properties: {
    resposta_markdown: {
      type: 'string',
      description:
        'O que você diz ao advogado nesta rodada (análise, resposta, explicação da proposta). Markdown, em português.',
    },
    proposta: {
      type: 'object',
      description:
        'Presente APENAS quando a rodada altera a peça. Ausente em respostas de conversa/análise.',
      properties: {
        resumo: { type: 'string', description: 'Uma frase sobre o que a proposta faz.' },
        secoes: {
          type: 'array',
          description: 'Uma operação por seção tocada. Nunca a peça inteira em um bloco só.',
          items: {
            type: 'object',
            properties: {
              titulo: {
                type: 'string',
                description:
                  'Título EXATO da seção alvo (ou da seção âncora, em inserir_apos). Sem os # do heading.',
              },
              acao: {
                type: 'string',
                enum: [...ACOES_SECAO],
                description: 'substituir | inserir_apos | inserir_inicio | remover',
              },
              conteudo_markdown: {
                type: 'string',
                description:
                  'Texto COMPLETO da seção resultante, começando pelo próprio heading. Vazio em remover.',
              },
              motivo: { type: 'string', description: 'Frase curta que justifica a operação.' },
            },
            required: ['titulo', 'acao', 'conteudo_markdown', 'motivo'],
            additionalProperties: false,
          },
        },
      },
      required: ['resumo', 'secoes'],
      additionalProperties: false,
    },
  },
  required: ['resposta_markdown'],
  additionalProperties: false,
} as const

/** Resultado da leitura do envelope. */
export interface LeituraEnvelope {
  envelope: EnvelopeRodada
  /**
   * true quando a resposta não era um JSON válido do envelope e caímos no
   * fallback (texto inteiro como resposta, sem proposta). Nunca perdemos a
   * rodada por causa de um JSON malformado — mas registramos que aconteceu.
   */
  degradado: boolean
}

/**
 * Lê o envelope da resposta. Com structured output o texto JÁ é o JSON; o
 * `extrairJsonDoTexto` e o fallback cobrem o degradê (modelo antigo, corte por
 * max_tokens, cerca de código) sem derrubar a rodada.
 */
export function lerEnvelope(texto: string): LeituraEnvelope {
  const cru = (texto ?? '').trim()
  if (!cru) return { envelope: { resposta_markdown: '' }, degradado: false }

  try {
    const parsed = envelopeRodadaSchema.parse(JSON.parse(extrairJsonDoTexto(cru)))
    const proposta =
      parsed.proposta && parsed.proposta.secoes.length > 0
        ? { resumo: parsed.proposta.resumo, secoes: parsed.proposta.secoes as SecaoPatch[] }
        : undefined
    return { envelope: { resposta_markdown: parsed.resposta_markdown, proposta }, degradado: false }
  } catch {
    return { envelope: { resposta_markdown: cru }, degradado: true }
  }
}

/**
 * Texto de uma proposta para os verificadores determinísticos (citações): o
 * resumo, os motivos e o conteúdo de todas as seções, concatenados.
 */
export function textoDaProposta(proposta: PropostaRodada | undefined): string {
  if (!proposta) return ''
  return [
    proposta.resumo,
    ...proposta.secoes.map((s) => `${s.motivo ?? ''}\n${s.conteudo_markdown ?? ''}`),
  ].join('\n\n')
}
