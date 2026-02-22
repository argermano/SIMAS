export function buildPromptContestacaoTrab(dados: {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
}): string {
  return `
Você é um advogado trabalhista experiente redigindo uma Contestação Trabalhista.

## CONTEXTO
${dados.analise ? `### Análise jurídica prévia:\n${JSON.stringify(dados.analise, null, 2)}` : '### Sem análise prévia.'}

### Transcrição: ${dados.transcricao}
### Pedido específico: ${dados.pedido_especifico || 'Nenhum.'}
### Documentos: ${dados.documentos.length > 0 ? dados.documentos.map(d => `- ${d.file_name} (${d.tipo})`).join('\n') : 'Nenhum documento.'}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento (Vara do Trabalho)
2. Qualificação das Partes
3. Breve Resumo da Reclamação
4. Preliminares (prescrição, inépcia, ilegitimidade)
5. Do Mérito — Impugnação Específica de Cada Pedido
6. Dos Pedidos
7. Das Provas
8. Fechamento

## REGRAS
- Impugne cada pedido do reclamante especificamente
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

export const SYSTEM_CONTESTACAO_TRAB = `Você é um advogado trabalhista sênior redigindo peças de defesa. Escreva a peça COMPLETA em Markdown bem formatado, com linguagem jurídica formal. NUNCA interrompa a geração — sempre conclua a peça inteira.`
