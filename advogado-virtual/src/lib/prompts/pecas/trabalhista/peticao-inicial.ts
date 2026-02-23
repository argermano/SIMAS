export function buildPromptPeticaoInicialTrab(dados: {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  localizacao?: { cidade?: string; estado?: string }
}): string {
  const enderecamento = dados.localizacao?.cidade && dados.localizacao?.estado
    ? `À Vara do Trabalho de ${dados.localizacao.cidade}/${dados.localizacao.estado}`
    : 'À [Xª] Vara do Trabalho de [PREENCHER cidade]/[PREENCHER estado]'

  return `
Você é um advogado trabalhista experiente redigindo uma Reclamação Trabalhista (Petição Inicial).

## CONTEXTO
${dados.analise ? `### Análise jurídica prévia:\n${JSON.stringify(dados.analise, null, 2)}` : '### Sem análise prévia.'}

### Transcrição: ${dados.transcricao}
### Pedido específico: ${dados.pedido_especifico || 'Nenhum.'}
### Documentos: ${dados.documentos.length > 0 ? dados.documentos.map(d => `- ${d.file_name} (${d.tipo}): ${d.texto_extraido?.substring(0, 500) ?? 'sem texto'}`).join('\n') : 'Nenhum documento.'}
### Localização do cliente: ${dados.localizacao?.cidade ? `${dados.localizacao.cidade}/${dados.localizacao.estado}` : 'Não informada'}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento: "${enderecamento}"
2. Qualificação do Reclamante
3. Qualificação da Reclamada
4. Dos Fatos
5. Do Direito (CLT, CF/88, Súmulas TST)
6. Da Jornada de Trabalho e Horas Extras (se aplicável)
7. Das Verbas Rescisórias (se aplicável)
8. Do Dano Moral (se aplicável)
9. Da Tutela de Urgência (se aplicável)
10. Dos Pedidos (lista numerada com valores quando possível)
11. Das Provas
12. Do Valor da Causa
13. Requerimentos Finais
14. Fechamento

## REGRAS
- Use APENAS fatos dos dados disponíveis
- NÃO invente jurisprudência — marque com [VERIFICAR]
- Marque com [PREENCHER] dados faltantes
- Linguagem técnica jurídica formal
- Inclua pedido de Justiça Gratuita
- Considere prazos prescricionais
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

Responda com a petição COMPLETA em Markdown bem formatado. Não interrompa a geração.
`.trim()
}

export const SYSTEM_PETICAO_TRAB = `Você é um advogado trabalhista sênior redigindo reclamações trabalhistas. Escreva a peça COMPLETA em Markdown bem formatado, com linguagem jurídica formal e técnica. NUNCA interrompa a geração — sempre conclua a peça inteira.`
