export function buildPromptRevisarValidar(dados: {
  peca: string
  area: string
  tipo_peca: string
}): string {
  return `
Você é um revisor jurídico rigoroso. Produza um RELATÓRIO DE VALIDAÇÃO.

## PEÇA (${dados.tipo_peca} — ${dados.area})
${dados.peca}

## CHECKLIST — classifique cada item como: validado | parcial | nao_validado | inconsistente

1. COERÊNCIA: fatos consistentes? fundamentos sustentam pedidos? datas/valores corretos?
2. ITENS ESSENCIAIS: endereçamento, qualificação, fatos, fundamento, pedidos, valor causa, justiça gratuita, provas?
3. LEGISLAÇÃO: cada artigo/lei citado existe? é pertinente? está vigente?
4. JURISPRUDÊNCIA: cada referência parece real? é pertinente?
5. DOUTRINA: referências verificáveis?

## RESPOSTA EM JSON:
{
  "coerencia":        { "status": "validado|parcial|nao_validado", "itens": [{ "item": "...", "status": "validado|parcial|nao_validado|inconsistente", "localizacao": "...", "sugestao": "..." }] },
  "itens_essenciais": { "status": "validado|parcial|nao_validado", "itens": [{ "item": "...", "status": "validado|nao_validado", "observacao": "..." }] },
  "legislacao":       { "status": "validado|parcial|nao_validado", "citacoes": [{ "referencia": "...", "status": "validado|nao_validado", "sugestao": "..." }] },
  "jurisprudencia":   { "status": "validado|parcial|nao_validado", "citacoes": [{ "referencia": "...", "status": "validado|nao_validado", "sugestao": "..." }] },
  "doutrina":         { "status": "validado|parcial|nao_validado", "citacoes": [{ "referencia": "...", "status": "validado|nao_validado", "sugestao": "..." }] },
  "score_confianca": 78,
  "correcoes_sugeridas": [{ "tipo": "remover_citacao|substituir_fundamento|ajustar_pedido|completar_item|reescrever_fatos", "descricao": "...", "trecho_atual": "...", "sugestao": "...", "prioridade": "alta|media|baixa" }]
}
`.trim()
}

export const SYSTEM_VALIDAR = `Você é um revisor jurídico rigoroso e meticuloso. Responda SEMPRE em JSON válido. Seja honesto sobre o que está correto e o que precisa de correção. O score_confianca deve refletir a qualidade real da peça.`
