export function buildPromptPeticaoInicialPrev(dados: {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  localizacao?: { cidade?: string; estado?: string }
}): string {
  const enderecamento = dados.localizacao?.cidade && dados.localizacao?.estado
    ? `À Vara Federal Previdenciária de ${dados.localizacao.cidade}/${dados.localizacao.estado} (ou Juizado Especial Federal, conforme a competência local)`
    : 'À Vara Federal Previdenciária / Juizado Especial Federal (JEF) competente [PREENCHER comarca]'

  return `
Você é um advogado previdenciarista experiente redigindo uma Petição Inicial.

## CONTEXTO
${dados.analise ? `### Análise jurídica prévia:\n${JSON.stringify(dados.analise, null, 2)}` : '### Sem análise prévia.'}

### Transcrição: ${dados.transcricao}
### Pedido específico: ${dados.pedido_especifico || 'Nenhum.'}
### Documentos: ${dados.documentos.length > 0 ? dados.documentos.map(d => `- ${d.file_name} (${d.tipo}): ${d.texto_extraido?.substring(0, 500) ?? 'sem texto'}`).join('\n') : 'Nenhum documento.'}
### Localização do cliente: ${dados.localizacao?.cidade ? `${dados.localizacao.cidade}/${dados.localizacao.estado}` : 'Não informada'}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento: "${enderecamento}"
2. Qualificação do Autor
3. Qualificação do Réu (INSS)
4. Dos Fatos
5. Do Direito (Lei 8.213/91, Decreto 3.048/99, CF/88)
6. Da Tutela de Urgência (se aplicável)
7. Dos Pedidos (lista numerada)
8. Das Provas
9. Do Valor da Causa
10. Requerimentos Finais
11. Fechamento

## REGRAS
- Use APENAS fatos dos dados disponíveis
- NÃO invente jurisprudência — marque com [VERIFICAR] se necessário
- Marque com [PREENCHER] dados faltantes (nome completo, CPF, endereço, etc.)
- Linguagem técnica jurídica formal
- Inclua pedido de Justiça Gratuita
- GERE A PEÇA COMPLETA do início ao fim, sem interrupções

## FORMATAÇÃO
- Use Markdown bem estruturado
- Use ## para títulos de seções principais (ex: ## DOS FATOS)
- Use ### para subtítulos dentro de seções
- Use **negrito** para termos e conceitos jurídicos importantes
- Separe parágrafos com uma linha em branco entre eles
- Use listas numeradas (1. 2. 3.) para pedidos
- Use > para citações de legislação ou doutrina
- Mantenha parágrafos com boa extensão (3-5 linhas cada)

Responda com a petição COMPLETA em Markdown bem formatado. Não interrompa a geração.
`.trim()
}

export const SYSTEM_PETICAO_PREV = `Você é um advogado previdenciarista sênior redigindo peças processuais. Escreva a peça COMPLETA em Markdown bem formatado, com linguagem jurídica formal e técnica. Seja minucioso nos fundamentos legais. NUNCA interrompa a geração — sempre conclua a peça inteira com todos os tópicos da estrutura obrigatória.`
