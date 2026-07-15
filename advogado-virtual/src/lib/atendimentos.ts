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

/**
 * Vínculo opcional do atendimento (migration 057). Só dois tipos: 'atendimento'
 * (outro caso/atendimento — mesma entidade) e 'processo' (Fase 5). NÃO existe
 * 'cliente' aqui — o atendimento já pertence a um cliente. Reutiliza o mesmo
 * formato do vínculo da tarefa ({tipo,id}) para casar com o VinculoPicker.
 */
export const schemaVinculoAtendimento = z.object({
  tipo: z.enum(['atendimento', 'processo']),
  id:   z.string().uuid(),
})
export type VinculoAtendimento = z.infer<typeof schemaVinculoAtendimento>

/**
 * Converte o vínculo (ou null) nas 2 colunas FK: a coluna do tipo recebe o id,
 * a outra vai a null. Usado no INSERT/UPDATE para manter a exclusividade (chk).
 */
export function vinculoAtendimentoParaColunas(
  v: VinculoAtendimento | null,
): { vinculo_atendimento_id: string | null; vinculo_processo_id: string | null } {
  const base = { vinculo_atendimento_id: null, vinculo_processo_id: null }
  if (!v) return base
  return v.tipo === 'atendimento'
    ? { ...base, vinculo_atendimento_id: v.id }
    : { ...base, vinculo_processo_id: v.id }
}
