// Máscara e validação BR de celular, compartilhadas pela Equipe (admin edita) e
// pelo Perfil (o próprio membro edita). Só formatação — o backend guarda dígitos.

import { apenasDigitos } from '@/lib/funil/telefone'

/**
 * Formata para exibição no input: aceita DDI 55 colado e o descarta; produz
 * "(DD) NNNNN-NNNN" (11 dígitos) ou "(DD) NNNN-NNNN" (10). Mesmo padrão do FormCliente.
 */
export function formatarCelularBR(valor: string): string {
  let d = valor.replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** Vazio (limpar) ou BR válido: DDD + número (10 ou 11 dígitos). */
export function celularValidoBR(valor: string | null | undefined): boolean {
  const d = apenasDigitos(valor)
  return d === '' || d.length === 10 || d.length === 11
}
