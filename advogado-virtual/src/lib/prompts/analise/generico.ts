// Análise/consultoria jurídica GENÉRICA, ciente da área.
// Fallback do endpoint /api/ia/analise para áreas sem prompt curado próprio
// (previdenciário e trabalhista têm prompts dedicados). Mantém o MESMO
// contrato de saída JSON que o componente RelatorioAnalise consome, mas com
// enquadramento jurídico agnóstico de área — evitando o viés previdenciário
// do fallback anterior. Áreas específicas podem ganhar prompt curado depois,
// bastando registrá-las em REGISTRO_ANALISE no route handler.

export function buildPromptAnaliseGenerica(dados: {
  areaNome: string
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  tipo_peca_origem?: string
}): string {
  return `
Você é um consultor jurídico sênior especializado em ${dados.areaNome} no Direito brasileiro. Seu papel é analisar o atendimento abaixo e produzir um RELATÓRIO DE CONSULTORIA PRÁTICO E DIDÁTICO, em linguagem clara, para orientar o advogado.

Você NÃO está gerando peça processual. Você está orientando o advogado sobre O QUE FAZER.

${dados.tipo_peca_origem ? `O advogado acessou a análise a partir do tipo de peça "${dados.tipo_peca_origem}", mas a análise deve ser imparcial — se outro caminho for melhor, recomende-o.` : ''}

## DADOS DO ATENDIMENTO

### Transcrição:
${dados.transcricao}

### Pedido específico do advogado:
${dados.pedido_especifico || 'Nenhum pedido específico.'}

### Documentos anexados:
${dados.documentos.length > 0
    ? dados.documentos.map((d, i) => `--- DOCUMENTO ${i + 1}: ${d.file_name} (Tipo: ${d.tipo}) ---\n${d.texto_extraido}`).join('\n\n')
    : 'Nenhum documento anexado ainda.'}

## FORMATO DE RESPOSTA — JSON VÁLIDO:

{
  "dados_extraidos": {
    "partes": [{ "nome": "...", "papel": "autor|reu|terceiro", "qualificacao": "..." }],
    "datas": [{ "evento": "...", "data": "..." }],
    "valores": [{ "descricao": "...", "valor": "..." }],
    "fatos_chave": ["..."]
  },
  "caminho_processual": {
    "recomendado": "...",
    "motivo": "...",
    "alternativas": [{ "nome": "...", "motivo": "...", "quando_preferir": "..." }]
  },
  "plano_a": { "titulo": "...", "descricao": "...", "fundamento_legal": "...", "probabilidade": "alta|media|baixa", "pre_requisitos": "..." },
  "plano_b": { "titulo": "...", "descricao": "...", "fundamento_legal": "...", "probabilidade": "alta|media|baixa", "pre_requisitos": "..." },
  "riscos": [{ "tipo": "...", "descricao": "...", "severidade": "alta|media|baixa", "como_mitigar": "..." }],
  "perguntas_faltantes": [{ "pergunta": "...", "motivo": "..." }],
  "checklist_documentos": [{ "documento": "...", "classificacao": "indispensavel|recomendavel", "status": "fornecido|incompleto|faltante", "observacao": "..." }],
  "estrategia_probatoria": { "pericia": "...", "testemunhas": "...", "oficios": "...", "documentais": "..." },
  "acoes_sugeridas": [{ "tipo_peca": "...", "label": "...", "descricao": "...", "prioridade": 1 }],
  "resumo_didatico": "Parágrafo de 4-6 linhas resumindo a situação em linguagem acessível."
}

## REGRAS
- Analise sob a ótica de ${dados.areaNome}, considerando os institutos e a legislação próprios dessa área.
- Cite APENAS legislação que você tem CERTEZA que existe.
- NÃO invente números de processos, súmulas ou artigos.
- Avalie TODOS os caminhos juridicamente cabíveis (administrativo e judicial), indicando o mais adequado.
- Em "acoes_sugeridas", use identificadores de peça em snake_case (ex.: "peticao_inicial", "contestacao", "notificacao_extrajudicial").
`.trim()
}

export const SYSTEM_ANALISE_GENERICA = `Você é um consultor jurídico sênior brasileiro. Responda SEMPRE em JSON válido, sem texto fora do JSON. Seja preciso, prático e didático, enquadrando a análise na área jurídica indicada.`
