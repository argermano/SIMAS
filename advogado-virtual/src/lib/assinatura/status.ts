// Status canônico de assinatura — FONTE ÚNICA (resolve o A1d).
// Antes coexistiam dois mapas divergentes: o webhook mapeava '4'→download_ready
// e '5'→completed; o polling da assinatura mapeava '4'→completed. Agora todos
// usam ESTE mapa (o mais granular, do webhook). A lógica de "assinado/concluído"
// trata download_ready e completed como finalização (ver assinaturaFinalizada).

export type StatusAssinatura =
  | 'uploaded'
  | 'waiting_signatures'
  | 'download_ready'
  | 'completed'
  | 'cancelled'

/** Mapa dos ids de status da D4Sign → status canônico. */
export const D4SIGN_STATUS_MAP: Record<string, StatusAssinatura> = {
  '1': 'uploaded',
  '2': 'waiting_signatures',
  '3': 'waiting_signatures',
  '4': 'download_ready',
  '5': 'completed',
  '6': 'cancelled',
}

export function mapearStatusD4Sign(id: string | undefined | null): StatusAssinatura | null {
  return id ? (D4SIGN_STATUS_MAP[id] ?? null) : null
}

/** Todos assinaram (documento pronto/concluído) — dispara completed_at, tarefa, etc. */
export function assinaturaFinalizada(status: StatusAssinatura | null): boolean {
  return status === 'download_ready' || status === 'completed'
}
