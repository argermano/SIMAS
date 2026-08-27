// Modo CORRIGIR do motor único (F0.2).
//
// Texto MOVIDO, byte a byte, de src/app/api/ia/correcao-auto/route.ts
// (constante SYSTEM e função buildPromptCorrecao, com as 3 instruções
// hardcoded). Nada foi reescrito — a correção automática do editor tem de
// continuar produzindo exatamente o mesmo prompt.

export const SYSTEM_MODO_CORRIGIR = `Você é um advogado revisor. Aplique a correção solicitada à peça e retorne a peça completa corrigida em Markdown. Não adicione explicações, apenas a peça corrigida.`

/** Instruções por tipo de correção automática oferecida no editor. */
export const INSTRUCOES_CORRECAO: Record<string, string> = {
  remover_citacao: 'Remova TODAS as citações de jurisprudência que parecem inventadas ou não verificáveis. Substitua por fundamentos legais sólidos (legislação e doutrina reconhecida).',
  completar_item: 'Identifique e complete TODOS os campos marcados com [PREENCHER] com textos modelo/placeholder realistas. Adicione itens obrigatórios da peça que estejam faltando (valor da causa, justiça gratuita, provas, etc.).',
  ajustar_pedido: 'Revise os pedidos para garantir coerência com os fatos e fundamentos. Ajuste valores, corrija inconsistências e garanta que todos os pedidos estejam fundamentados.',
}

export function buildPromptModoCorrigir(peca: string, tipo: string): string {
  return `
## PEÇA ATUAL
${peca}

## CORREÇÃO SOLICITADA
${INSTRUCOES_CORRECAO[tipo] ?? 'Revise e corrija a peça, melhorando a qualidade geral.'}

Responda APENAS com a peça corrigida em Markdown. Sem explicações adicionais.
`.trim()
}
