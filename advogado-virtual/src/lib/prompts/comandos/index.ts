export const PROMPTS_COMANDOS: Record<string, { system: string; buildPrompt: (transcricao: string, pedido?: string) => string }> = {
  organizar_timeline: {
    system: 'Você é um assistente jurídico. Responda em Markdown formatado.',
    buildPrompt: (transcricao, pedido) => `
Organize os fatos abaixo em uma LINHA DO TEMPO cronológica.

## Transcrição:
${transcricao}

${pedido ? `## Pedido específico:\n${pedido}` : ''}

## Formato esperado:
Use Markdown com lista ordenada. Para cada evento inclua: data (ou período estimado), descrição do fato e relevância jurídica.
Se não houver data exata, estime o período e marque com [DATA APROXIMADA].
`.trim(),
  },

  listar_documentos: {
    system: 'Você é um assistente jurídico especializado em gestão documental. Responda em Markdown.',
    buildPrompt: (transcricao, pedido) => `
Com base no relato abaixo, liste TODOS os documentos que o advogado precisa reunir para o caso.

## Transcrição:
${transcricao}

${pedido ? `## Pedido específico:\n${pedido}` : ''}

## Formato:
Para cada documento, indique:
- **Nome do documento**
- **Classificação**: Indispensável | Recomendável
- **Onde obter** (se possível)
- **Observação** (prazo, validade, formato)
`.trim(),
  },

  perguntas_faltantes: {
    system: 'Você é um consultor jurídico meticuloso. Responda em Markdown.',
    buildPrompt: (transcricao, pedido) => `
Analise o relato abaixo e identifique TODAS as perguntas que o advogado deveria fazer ao cliente para completar o caso.

## Transcrição:
${transcricao}

${pedido ? `## Pedido específico:\n${pedido}` : ''}

## Formato:
Lista numerada de perguntas, cada uma com:
- A **pergunta** em si
- **Por que é importante** (como a resposta afeta a estratégia)
`.trim(),
  },

  sugestao_acao: {
    system: 'Você é um consultor jurídico estrategista. Responda em Markdown.',
    buildPrompt: (transcricao, pedido) => `
Com base no relato, sugira a(s) ação(ões) ou recurso(s) mais adequados.

## Transcrição:
${transcricao}

${pedido ? `## Pedido específico:\n${pedido}` : ''}

## Formato:
Para cada sugestão:
- **Tipo de ação/recurso**
- **Fundamento legal**
- **Probabilidade de êxito** (Alta/Média/Baixa)
- **Observações**
`.trim(),
  },

  riscos_caso: {
    system: 'Você é um consultor jurídico especializado em análise de riscos. Responda em Markdown.',
    buildPrompt: (transcricao, pedido) => `
Analise os riscos jurídicos do caso abaixo.

## Transcrição:
${transcricao}

${pedido ? `## Pedido específico:\n${pedido}` : ''}

## Formato:
Para cada risco identificado:
- **Tipo do risco** (processual, prescricional, probatório, etc.)
- **Descrição**
- **Severidade**: Alta | Média | Baixa
- **Como mitigar**
`.trim(),
  },
}
