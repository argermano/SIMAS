// Guarda anti-encolhimento (camada C): impede que um conteúdo muito menor
// substitua silenciosamente um rascunho completo já salvo — o cenário do
// incidente em que o parcial pós-queda de conexão sobrescreveria o texto
// íntegro que o servidor terminou de gerar.

/** Novo < 70% do atual dispara a confirmação. */
export const LIMIAR_ENCOLHIMENTO = 0.7
/** Só protege rascunhos substanciais — abaixo disso a diferença é ruído. */
export const MIN_CHARS_GUARDA = 2000

/**
 * Decide se salvar `novo` por cima de `atual` exige confirmação explícita.
 * Só dispara quando o rascunho atual é substancial (> 2000 chars) e o novo
 * encolhe mais de 30%. Peça recém-criada (atual vazio) nunca bloqueia.
 */
export function encolhimentoPerigoso(atual: string | null | undefined, novo: string): boolean {
  const tamAtual = atual?.length ?? 0
  if (tamAtual <= MIN_CHARS_GUARDA) return false
  return novo.length < tamAtual * LIMIAR_ENCOLHIMENTO
}
