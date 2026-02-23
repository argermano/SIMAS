export const SYSTEM_ANALISE_GERAL = `
Você é um advogado brasileiro experiente, generalista, com profundo conhecimento em todas as áreas do Direito.

Seu papel é ouvir o relato de um cliente e produzir uma TRIAGEM JURÍDICA INICIAL: identificar qual(is) área(s) do direito estão envolvidas, fazer uma avaliação preliminar do caso e orientar o advogado sobre os próximos passos.

IMPORTANTE:
- Responda APENAS com JSON válido, sem texto extra
- Seja prático e direto — o advogado precisa de orientação acionável
- Se mais de uma área estiver envolvida, liste todas, indicando qual é a principal
- Áreas possíveis: previdenciario, trabalhista, civel, criminal, tributario, empresarial, familia, consumidor, imobiliario, administrativo
`.trim()

export function buildPromptAnaliseGeral(dados: {
  transcricao: string
  pedido_especifico?: string
  documentos?: Array<{ tipo: string; texto_extraido: string; file_name: string }>
}): string {
  return `
## RELATO DO CLIENTE / ATENDIMENTO

### Descrição do caso:
${dados.transcricao}

### Pedido ou questão específica:
${dados.pedido_especifico?.trim() || 'Não informado.'}

### Documentos apresentados:
${dados.documentos && dados.documentos.length > 0
    ? dados.documentos.map((d, i) => `--- DOCUMENTO ${i + 1}: ${d.file_name} (${d.tipo}) ---\n${d.texto_extraido}`).join('\n\n')
    : 'Nenhum documento.'}

## FORMATO DE RESPOSTA (JSON válido):

{
  "areas_identificadas": [
    {
      "area": "previdenciario",
      "nome": "Previdenciário",
      "relevancia": "principal",
      "justificativa": "Explique em 1-2 frases por que esta área está envolvida"
    }
  ],
  "resumo_caso": "Resumo do caso em 3-5 frases, em linguagem clara para o advogado",
  "classificacao_provavel": "Ex.: aposentadoria por tempo de contribuição / rescisão indireta / etc.",
  "urgencia": "alta | media | baixa",
  "justificativa_urgencia": "Por que este nível de urgência?",
  "recomendacao_imediata": "O que o advogado deve fazer primeiro (1 parágrafo)",
  "documentos_solicitar": [
    "RG e CPF",
    "CNIS",
    "..."
  ],
  "perguntas_ao_cliente": [
    "Pergunta 1 que o advogado deve fazer para complementar o relato",
    "Pergunta 2",
    "..."
  ],
  "observacoes": "Observações importantes, riscos ou pontos de atenção (opcional)"
}
`.trim()
}
