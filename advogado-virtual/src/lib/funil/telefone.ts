// Normalização de telefone para o funil. O cadastro de clientes guarda telefone
// como TEXT com máscara BR (sem padrão), então o matching é feito por DÍGITOS.

/** Só os dígitos de um telefone. */
export function apenasDigitos(tel: string | null | undefined): string {
  return (tel ?? '').replace(/\D/g, '')
}

/**
 * Normaliza para E.164 (+55...) assumindo Brasil quando o DDI não vem.
 * - 10/11 dígitos (DDD + número) → +55DDDNUMERO
 * - 12/13 dígitos começando com 55 → +<tudo>
 * - já com + → mantém os dígitos com +
 */
export function normalizarE164(tel: string): string {
  const d = apenasDigitos(tel)
  if (!d) return ''
  if (d.length === 10 || d.length === 11) return `+55${d}`
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return `+${d}`
  return `+${d}`
}

/**
 * Chave de comparação de telefones tolerante a máscara, DDI e ao 9º dígito.
 * Usa os últimos 10 dígitos (DDD + 8 finais) — casa "+55 47 99118-6787",
 * "4799118-6787" e "479 9118-6787" no mesmo cliente.
 */
export function chaveTelefone(tel: string | null | undefined): string {
  const d = apenasDigitos(tel)
  const semDDI = d.startsWith('55') && d.length > 10 ? d.slice(2) : d
  return semDDI.length > 10 ? semDDI.slice(-11) : semDDI.slice(-10)
}

/** Dois telefones representam a mesma linha? (compara pelos finais). */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = chaveTelefone(a)
  const cb = chaveTelefone(b)
  if (!ca || !cb) return false
  // Casa mesmo com/sem o 9º dígito: compara os 8 finais quando os tamanhos divergem.
  if (ca === cb) return true
  return ca.slice(-8) === cb.slice(-8) && ca.slice(0, 2) === cb.slice(0, 2)
}
