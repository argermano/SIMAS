export function buildPromptContestacaoPrev(dados: {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
}): string {
  return `
Você é um advogado previdenciarista experiente redigindo uma Contestação.

## CONTEXTO
${dados.analise ? `### Análise jurídica prévia:\n${JSON.stringify(dados.analise, null, 2)}` : '### Sem análise prévia.'}

### Transcrição: ${dados.transcricao}
### Pedido específico: ${dados.pedido_especifico || 'Nenhum.'}
### Documentos: ${dados.documentos.length > 0 ? dados.documentos.map(d => `- ${d.file_name} (${d.tipo})`).join('\n') : 'Nenhum documento.'}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento
2. Qualificação das Partes
3. Breve Resumo da Ação
4. Preliminares (se aplicável)
5. Do Mérito
6. Da Improcedência dos Pedidos
7. Dos Pedidos
8. Das Provas
9. Fechamento

## REGRAS
- Use APENAS fatos dos dados disponíveis
- NÃO invente jurisprudência — marque com [VERIFICAR]
- Marque com [PREENCHER] dados faltantes
- Linguagem técnica jurídica formal
- GERE A PEÇA COMPLETA do início ao fim, sem interrupções

## FORMATAÇÃO
- Use Markdown bem estruturado
- Use ## para títulos de seções principais
- Use ### para subtítulos dentro de seções
- Use **negrito** para termos e conceitos jurídicos importantes
- Separe parágrafos com uma linha em branco entre eles
- Use listas numeradas (1. 2. 3.) para pedidos
- Use > para citações de legislação ou doutrina
- Mantenha parágrafos com boa extensão (3-5 linhas cada)

Responda com a contestação COMPLETA em Markdown bem formatado. Não interrompa a geração.
`.trim()
}

export const SYSTEM_CONTESTACAO_PREV = `Você é um advogado previdenciarista sênior redigindo peças de defesa. Escreva a peça COMPLETA em Markdown bem formatado, com linguagem jurídica formal. NUNCA interrompa a geração — sempre conclua a peça inteira.`
