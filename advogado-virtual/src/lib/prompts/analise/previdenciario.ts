export function buildPromptAnalisePrev(dados: {
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  tipo_peca_origem?: string
}): string {
  return `
Você é um consultor jurídico especialista em Direito Previdenciário brasileiro. Seu papel é analisar o atendimento abaixo e produzir um RELATÓRIO DE CONSULTORIA PRÁTICO E DIDÁTICO, em linguagem clara, para orientar o advogado.

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
    "datas": { "DER": "...", "DCB": "...", "DIB": "...", "admissoes": [], "demissoes": [] },
    "numeros": { "NB": "...", "NIT_PIS": "...", "CPF": "...", "valores": [] },
    "vinculos": [{ "empregador": "...", "periodo": "...", "contribuicoes": "..." }],
    "saude": { "CIDs": [], "diagnosticos": [], "incapacidade": "..." },
    "indeferimento_cessacao": { "motivo": "...", "data": "...", "especie": "..." }
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
- Cite APENAS legislação que você tem CERTEZA que existe
- NÃO invente números de processos, súmulas ou artigos
- Avalie TODOS os caminhos previdenciários possíveis (BPC/LOAS, incapacidade, concessão, restabelecimento, revisão, pensão, etc.)
`.trim()
}

export const SYSTEM_ANALISE_PREV = `Você é um consultor jurídico sênior especializado em Direito Previdenciário brasileiro. Responda SEMPRE em JSON válido, sem texto fora do JSON. Seja preciso, prático e didático.`
