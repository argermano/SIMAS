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
  status: 'aberta' | 'paga' | 'cancelada'
  pago_em?: string | null
  pago_valor_centavos?: number | null
  meio?: 'pix' | 'boleto' | 'transferencia' | 'dinheiro' | 'outro' | null
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
