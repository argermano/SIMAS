// Tipos compartilhados do módulo Financeiro (frontend).
// O contrato de dados segue o spec do Lote 1 (rotas /api/financeiro/*).

export interface Parcela {
  id: string
  cliente_id: string
  cliente_nome?: string | null
  contrato_id?: string | null
  processo_id?: string | null
  descricao: string
  valor_centavos: number
  vencimento: string            // YYYY-MM-DD
  // 'prevista' = previsão de recebimento do contrato (estimativa): não recebe
  // aviso nem baixa; some quando a série real de parcelas é lançada (migr. 065).
  status: 'aberta' | 'paga' | 'cancelada' | 'prevista'
  pago_em?: string | null
  pago_valor_centavos?: number | null
  meio?: 'pix' | 'boleto' | 'transferencia' | 'dinheiro' | 'outro' | null
  // Comprovante recebido por WhatsApp e pré-organizado pelo staging (migration
  // 052). Parcela "aguardando baixa" = status 'aberta' E comprovante_recebido_em
  // não-nulo. A baixa continua sendo confirmação humana (nunca automática).
  comprovante_recebido_em?: string | null
  comprovante_recebido_url?: string | null    // path no bucket privado "documentos"
  comprovante_recebido_dados?: Record<string, unknown> | null // dados da IA + { mensagemId, conversaId, contentType }
}

/** Parcela aberta com comprovante recebido aguardando conferência humana. */
export function aguardandoBaixa(p: Parcela): boolean {
  return p.status === 'aberta' && !!p.comprovante_recebido_em
}

/** Previsão de recebimento do contrato (estimativa, não é cobrança real). */
export function ehPrevisao(p: Parcela): boolean {
  return p.status === 'prevista'
}

export interface PixConfig {
  pix_chave: string
  pix_nome: string
  pix_cidade: string
}

export const LABELS_MEIO: Record<string, string> = {
  pix:           'Pix',
  boleto:        'Boleto',
  transferencia: 'Transferência',
  dinheiro:      'Dinheiro',
  outro:         'Outro',
}

/** Data de hoje (fuso local do navegador) em YYYY-MM-DD. */
export function hojeISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Soma dias a uma data ISO (YYYY-MM-DD). */
export function somarDiasISO(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const dt = new Date(a, m - 1, d + dias)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

export function ehVencida(p: Parcela, hoje: string): boolean {
  return p.status === 'aberta' && p.vencimento < hoje
}
