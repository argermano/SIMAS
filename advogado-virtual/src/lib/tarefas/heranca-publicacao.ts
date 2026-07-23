// Herança de vínculo na criação de tarefa a partir de uma PUBLICAÇÃO triada.
//
// Contexto (evidência de produção): ao triar uma publicação e criar a tarefa
// pelo tratamento sugerido, a tarefa nascia com TODAS as colunas de vínculo
// nulas — mesmo quando a publicação de origem tinha `processo_id`, e o processo
// dá o cliente. Sem vínculo, o botão "Gerar peça" fica inerte. Aqui derivamos o
// vínculo único da tarefa (modelo 054: no máx. 1 entre cliente/caso/processo) a
// partir do processo da publicação, priorizando o CASO quando ele é único.
//
// Relação processo↔caso no schema real (migration 057): um atendimento aponta
// para um processo via `atendimentos.vinculo_processo_id`. Logo, o "caso do
// processo" é o atendimento (do MESMO cliente) cujo vinculo_processo_id bate.

import type { createClient } from '@/lib/supabase/server'
import type { Vinculo } from './vinculo'

type Db = Awaited<ReturnType<typeof createClient>>

/**
 * Decisão PURA do vínculo herdado (testável, sem DB):
 *  - sem processo             → null (nada a herdar);
 *  - EXATAMENTE 1 caso         → vínculo ao CASO (atendimento) — abre o motor de peças direto;
 *  - 0 casos ou ambíguo (>1)   → vínculo ao PROCESSO (o cliente vem pelo join do processo).
 *
 * Nunca devolve vínculo de cliente puro: o processo já carrega o cliente e é mais
 * específico (a UI resolve o cliente a partir do processo).
 */
export function decidirVinculoHerdado(
  processoId: string | null,
  casosDoCliente: string[],
): Vinculo | null {
  if (!processoId) return null
  if (casosDoCliente.length === 1) return { tipo: 'atendimento', id: casosDoCliente[0] }
  return { tipo: 'processo', id: processoId }
}

/**
 * Deriva o vínculo a herdar pela tarefa a partir do `processo_id` da publicação.
 * Todas as leituras são escopadas por tenant (defesa em profundidade além da RLS):
 * processo de outro tenant → não é enxergado → sem herança.
 *
 * @returns o vínculo (caso | processo) ou null quando não há o que herdar.
 */
export async function derivarVinculoHerdado(
  db: Db,
  processoId: string | null,
  tenantId: string,
): Promise<Vinculo | null> {
  if (!processoId) return null

  // 1) Cliente do processo (e confirma pertencimento ao tenant).
  const { data: proc } = await db
    .from('processos')
    .select('cliente_id')
    .eq('id', processoId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const clienteId = (proc as { cliente_id?: string | null } | null)?.cliente_id ?? null
  if (!clienteId) return null

  // 2) Caso(s) do MESMO cliente ligados a este processo (atendimentos.vinculo_processo_id).
  //    limit(2) basta para distinguir "exatamente 1" de "ambíguo" sem varrer tudo.
  const { data: casos } = await db
    .from('atendimentos')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('cliente_id', clienteId)
    .eq('vinculo_processo_id', processoId)
    .is('deleted_at', null)
    .limit(2)

  const casoIds = (casos ?? []).map((c) => (c as { id: string }).id)
  return decidirVinculoHerdado(processoId, casoIds)
}
