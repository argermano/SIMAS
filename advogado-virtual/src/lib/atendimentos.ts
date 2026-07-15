import { z } from 'zod'

/**
 * Helpers compartilhados do módulo de atendimentos (primeiro atendimento, 056).
 * Fica fora dos route.ts porque arquivos de rota do Next só podem exportar os
 * handlers HTTP (exportar helper de lá quebra a tipagem gerada da rota).
 */

// Etiquetas normalizadas: trim, sem vazios, dedup, ≤8 itens de ≤30 chars.
export const etiquetasField = z
  .array(z.string())
  .transform((arr) => [...new Set(arr.map((s) => s.trim()).filter(Boolean))])
  .refine((arr) => arr.length <= 8, { message: 'Máximo de 8 etiquetas' })
  .refine((arr) => arr.every((s) => s.length <= 30), { message: 'Etiqueta com mais de 30 caracteres' })
