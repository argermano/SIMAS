// server-only: GATILHO do espelho no Google Drive. Módulo FINO (NÃO importa o motor
// de reconciliação de espelho.ts) para as rotas de documentos enfileirarem barato,
// sem arrastar o cliente REST do Drive para o bundle de cada rota. A DRENAGEM da
// fila (processarFilaDrive/espelharCliente) vive em espelho.ts, chamada pelo cron
// e pelo botão "Sincronizar agora". SERVER-ONLY.

import type { SupabaseClient } from '@supabase/supabase-js'
import { driveDisponivel } from './auth'
import { logger } from '@/lib/logger'

/**
 * Enfileira UM cliente para espelhar no Drive (dedup natural pela PK cliente_id,
 * 066). Chamado APÓS o sucesso de um upload/vínculo/exclusão de documento.
 *
 * À prova de falha por design — o espelho é efeito colateral, nunca parte da
 * transação do request:
 *  • try/catch TOTAL: jamais propaga erro para o handler que o chamou;
 *  • no-op silencioso quando o espelho está INERTE (sem as 2 envs) — barato;
 *  • guarda de ids ausentes.
 *
 * `client` PRECISA ser service-role (admin): drive_sync_fila é service-only
 * (RLS habilitada sem policy, 066) — um client de sessão seria barrado pela RLS.
 * LGPD: nunca loga nome de cliente/arquivo (só o evento).
 */
export async function enfileirarDriveSync(
  client: SupabaseClient,
  tenantId: string | null | undefined,
  clienteId: string | null | undefined,
): Promise<void> {
  try {
    if (!driveDisponivel()) return // espelho desligado → nada a enfileirar
    if (!tenantId || !clienteId) return
    await client
      .from('drive_sync_fila')
      .upsert({ cliente_id: clienteId, tenant_id: tenantId }, { onConflict: 'cliente_id', ignoreDuplicates: true })
  } catch (e) {
    logger.error('drive.fila.enfileirar', {}, e) // LGPD: só o evento, sem nomes
  }
}
