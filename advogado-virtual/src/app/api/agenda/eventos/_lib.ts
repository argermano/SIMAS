// Contratos + helpers compartilhados do CRUD de agenda_eventos.
// (Arquivo com prefixo "_" — NÃO é uma rota; só módulo interno.)
// Ver docs/PLANO-AGENDA-OPUS.md §3. INVARIANTE: prazo NUNCA sem data explícita.

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

/** String ISO de data/hora que precisa ser parseável (borda converte p/ UTC). */
const isoDatetime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'data/hora inválida')

/** Papéis autorizados nas rotas de agenda. */
export const PAPEIS_AGENDA = ['admin', 'advogado', 'colaborador'] as const

/**
 * Criação (POST /api/agenda/eventos). `inicio` é OBRIGATÓRIO para qualquer
 * tipo — inclusive 'prazo' — garantindo que prazo nunca nasça sem data manual.
 */
export const schemaCriar = z.object({
  tipo: z.enum(['evento', 'prazo', 'audiencia']),
  titulo: z.string().min(1).max(300),
  descricao: z.string().max(5000).nullable().optional(),
  inicio: isoDatetime,
  fim: isoDatetime.nullable().optional(),
  dia_todo: z.boolean().optional().default(false),
  local: z.string().max(500).nullable().optional(),
  process_id: z.string().uuid().nullable().optional(),
  cliente_id: z.string().uuid().nullable().optional(),
  responsavel_id: z.string().uuid().nullable().optional(),
  visibilidade: z.enum(['escritorio', 'particular']).optional().default('escritorio'),
  cor: z.string().max(20).nullable().optional(),
  envolvidos: z.array(z.string().uuid()).optional().default([]),
})
export type EntradaCriar = z.infer<typeof schemaCriar>

/**
 * Edição (PATCH /api/agenda/eventos/[id]). Parcial. `inicio` pode ser trocado
 * mas nunca esvaziado (coluna NOT NULL) — logo não é nullable.
 */
export const schemaEditar = z.object({
  tipo: z.enum(['evento', 'prazo', 'audiencia']).optional(),
  titulo: z.string().min(1).max(300).optional(),
  descricao: z.string().max(5000).nullable().optional(),
  inicio: isoDatetime.optional(),
  fim: isoDatetime.nullable().optional(),
  dia_todo: z.boolean().optional(),
  local: z.string().max(500).nullable().optional(),
  process_id: z.string().uuid().nullable().optional(),
  cliente_id: z.string().uuid().nullable().optional(),
  responsavel_id: z.string().uuid().nullable().optional(),
  visibilidade: z.enum(['escritorio', 'particular']).optional(),
  cor: z.string().max(20).nullable().optional(),
  envolvidos: z.array(z.string().uuid()).optional(),
})
export type EntradaEditar = z.infer<typeof schemaEditar>

/** Mudança de status (POST /api/agenda/eventos/[id]/status). */
export const schemaStatus = z.object({
  acao: z.enum(['concluir', 'cancelar', 'reabrir']),
})

/**
 * Criação pelo bot (POST /api/agenda/eventos/integracao). `origin='bot'`,
 * `created_by=null`. `inicio` obrigatório — o bot nunca cria prazo sem data.
 */
export const schemaIntegracao = z.object({
  tipo: z.enum(['evento', 'prazo', 'audiencia']).optional().default('evento'),
  titulo: z.string().min(1).max(300),
  descricao: z.string().max(5000).nullable().optional(),
  inicio: isoDatetime,
  fim: isoDatetime.nullable().optional(),
  dia_todo: z.boolean().optional().default(false),
  local: z.string().max(500).nullable().optional(),
  cliente_id: z.string().uuid().nullable().optional(),
  responsavel_id: z.string().uuid().nullable().optional(),
  cor: z.string().max(20).nullable().optional(),
  origin_reference: z.string().max(300).nullable().optional(),
  envolvidos: z.array(z.string().uuid()).optional().default([]),
})

/** Colunas retornadas de um agenda_evento (literal — parser de select do supabase). */
export const COLUNAS_EVENTO =
  'id, tenant_id, tipo, titulo, descricao, inicio, fim, dia_todo, local, process_id, cliente_id, responsavel_id, visibilidade, status, concluido_em, cor, origin, origin_reference, created_by, created_at, updated_at'

type ClienteMinimo = Pick<SupabaseClient, 'from'>

/**
 * Confere (defensivo, além do RLS) que todos os `ids` são usuários do tenant.
 * Set vazio => válido. Usado para responsavel_id + envolvidos.
 */
export async function usuariosDoTenant(
  client: ClienteMinimo,
  tenantId: string,
  ids: string[],
): Promise<boolean> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return true
  const { data } = await client
    .from('users')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('id', unicos)
  return (data?.length ?? 0) === unicos.length
}

/**
 * Confere (defensivo, além do RLS) que um id opcional pertence ao tenant numa
 * tabela dona de `tenant_id`. `null`/`undefined` => válido (FK opcional não informada).
 * Usado para `cliente_id` (clientes) e `process_id` (atendimentos).
 */
export async function registroDoTenant(
  client: ClienteMinimo,
  tabela: 'clientes' | 'atendimentos',
  tenantId: string,
  id: string | null | undefined,
): Promise<boolean> {
  if (!id) return true
  const { data } = await client
    .from(tabela)
    .select('id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return !!data
}

/** Substitui por completo os envolvidos (M2M) de um evento. */
export async function definirEnvolvidos(
  client: ClienteMinimo,
  eventoId: string,
  userIds: string[],
): Promise<void> {
  await client.from('agenda_evento_envolvidos').delete().eq('evento_id', eventoId)
  const unicos = [...new Set(userIds)]
  if (unicos.length > 0) {
    await client
      .from('agenda_evento_envolvidos')
      .insert(unicos.map((uid) => ({ evento_id: eventoId, user_id: uid })))
  }
}
