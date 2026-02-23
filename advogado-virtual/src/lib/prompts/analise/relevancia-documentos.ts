// ─────────────────────────────────────────────────────────────────────────────
// Prompt para triagem de relevância de documentos
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_RELEVANCIA = `\
Você é um assistente jurídico especializado em triagem de documentos processuais brasileiros.
Sua tarefa é analisar cada documento fornecido e determinar se ele é relevante para o tipo de \
peça jurídica solicitada e os fatos do caso.
Seja criterioso: inclua apenas documentos que realmente contribuam com provas, fatos ou \
fundamentos para a peça a ser elaborada.
Responda EXCLUSIVAMENTE com JSON válido, sem markdown, sem texto adicional.`

export function buildPromptRelevancia(params: {
  area: string
  tipo_peca: string
  pedido?: string
  transcricao: string
  documentos: Array<{ id: string; tipo: string; file_name: string; texto_extraido: string }>
}): string {
  const docsTexto = params.documentos
    .map(
      (d) =>
        `ID: ${d.id}\nTipo: ${d.tipo}\nArquivo: ${d.file_name}\nConteúdo (trecho):\n${d.texto_extraido.substring(0, 800)}`
    )
    .join('\n\n---\n\n')

  return `Analise os documentos abaixo e determine quais são relevantes para a elaboração \
de uma "${params.tipo_peca}" na área de Direito ${params.area}.

CONTEXTO DO CASO:
${params.pedido ? `Pedido específico: ${params.pedido}\n` : ''}\
Transcrição do atendimento: ${params.transcricao.substring(0, 600)}

DOCUMENTOS PARA TRIAGEM:
${docsTexto}

Responda em JSON com o seguinte formato (use os IDs exatos fornecidos acima):
{
  "relevantes": [{ "id": "uuid", "justificativa": "motivo objetivo em até 20 palavras" }],
  "irrelevantes": [{ "id": "uuid", "justificativa": "motivo objetivo em até 20 palavras" }]
}`
}
