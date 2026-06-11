import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

/**
 * Trilha de auditoria. Grava via service_role (bypassa RLS) para que o registro
 * seja sempre persistido e não possa ser forjado pelo cliente.
 * Nunca lança — falha de auditoria não deve quebrar a operação principal.
 */

export interface AuditEntry {
  tenantId: string
  userId?: string | null
  action: string          // ex.: 'user.invite', 'user.role_change', 'user.delete'
  resourceType: string    // ex.: 'user', 'contrato', 'peca'
  resourceId?: string | null
  metadata?: Record<string, unknown>
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { error } = await admin.from('audit_log').insert({
      tenant_id: entry.tenantId,
      user_id: entry.userId ?? null,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      metadata: entry.metadata ?? {},
    })
    if (error) {
      logger.error('audit.insert.falha', { action: entry.action, tenantId: entry.tenantId }, error)
    }
  } catch (err) {
    logger.error('audit.insert.excecao', { action: entry.action }, err)
  }
}
