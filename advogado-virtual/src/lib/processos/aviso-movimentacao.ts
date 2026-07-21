// Fase 5 — claim-e-envio do aviso de movimentação ao cliente por WhatsApp.
// Máquina de estados sensível a concorrência, ANTES duplicada nos dois caminhos
// de captura (sync DataJud on-demand + cron DJEN). Extraída aqui para uma única
// fonte de verdade testável: um bug/regra corrigido num lado e esquecido no outro
// fazia o cliente receber aviso DUPLICADO ou NENHUM. Ver AUDITORIA-2026-07-21 §18.

import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarAvisoWhatsApp } from './notificar'
import { logAudit } from '@/lib/audit'

/** Desfecho do claim-e-envio de UM movimento:
 *  - 'perdido' → outro processo já reivindicou (não enviou nada);
 *  - 'enviado' → claim vencido + WhatsApp ok + marcado 'enviada' + auditado;
 *  - 'erro'    → claim vencido mas o envio falhou → marcado 'erro' (retry na fila). */
export type DesfechoAviso = 'perdido' | 'enviado' | 'erro'

/**
 * Reivindica (claim atômico pendente→aprovada) e, se vencer o claim, envia o aviso.
 * SÓ envia quem conseguir mudar de 'pendente'→'aprovada' — isso impede envio
 * duplicado sob concorrência (unique index + claim) e evita órfãos presos em
 * 'aprovada' (se o envio morrer no meio, o movimento fica 'pendente' → recuperável
 * na fila de Movimentações).
 *
 * ATENÇÃO (invariante do dono): o claim são DOIS UPDATEs encadeados por .eq()
 * (id + notif_status), NUNCA um .or() com timestamp — há um bug do PostgREST que
 * quebra o claim quando expresso com .or(). Não "simplifique" para um único UPDATE.
 */
export async function reivindicarEEnviarAviso(
  admin: SupabaseClient,
  params: {
    movimentoId: string
    telefone: string
    texto: string
    tenantId: string
    processoId: string
    clienteId: string | null
    origem?: 'datajud' | 'djen'
  },
): Promise<DesfechoAviso> {
  // Claim atômico: pendente → aprovada. Se vier vazio, outro processo já pegou.
  const { data: claim } = await admin
    .from('processo_movimentos')
    .update({ notif_status: 'aprovada' })
    .eq('id', params.movimentoId)
    .eq('notif_status', 'pendente')
    .select('id')
  if (!claim || claim.length === 0) return 'perdido'

  const res = await enviarAvisoWhatsApp(params.telefone, params.texto)
  if (!res.ok) {
    // Envio falhou: marca 'erro' (visível/retentável na fila; nunca fica órfão).
    await admin.from('processo_movimentos').update({ notif_status: 'erro' }).eq('id', params.movimentoId)
    return 'erro'
  }

  await admin
    .from('processo_movimentos')
    .update({ notif_status: 'enviada', notif_enviada_em: new Date().toISOString() })
    .eq('id', params.movimentoId)
  await logAudit({
    tenantId: params.tenantId,
    action: 'processo.notificacao_enviada',
    resourceType: 'processo',
    resourceId: params.processoId,
    // LGPD: só ids (movimento/cliente) e a origem — nunca telefone/nome/texto.
    metadata: {
      movimento_id: params.movimentoId,
      cliente_id: params.clienteId,
      ...(params.origem ? { origem: params.origem } : {}),
    },
  })
  return 'enviado'
}
