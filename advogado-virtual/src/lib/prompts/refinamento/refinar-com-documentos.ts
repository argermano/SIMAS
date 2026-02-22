export function buildPromptRefinar(dados: {
  peca_atual: string
  documentos_novos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
}): string {
  return `
Você é um advogado revisor. Cruze a peça com os NOVOS DOCUMENTOS anexados.

## PEÇA ATUAL
${dados.peca_atual}

## NOVOS DOCUMENTOS
${dados.documentos_novos.map((d, i) => `--- ${d.file_name} (${d.tipo}) ---\n${d.texto_extraido}`).join('\n\n')}

## TAREFA
1. Confirme ou corrija datas, valores, nomes e fatos
2. Fortaleça argumentação com dados dos documentos
3. Ajuste pedidos se necessário
4. Aponte divergências entre fala do cliente e documentos

## RESPOSTA EM JSON:
{
  "peca_refinada": "Markdown da peça atualizada completa",
  "mudancas": [{ "tipo": "correcao|fortalecimento|novo_pedido|divergencia", "descricao": "...", "documento_fonte": "..." }],
  "divergencias": [{ "fato_transcricao": "...", "fato_documento": "...", "recomendacao": "..." }]
}
`.trim()
}

export const SYSTEM_REFINAR = `Você é um advogado revisor minucioso. Responda SEMPRE em JSON válido. Seu trabalho é cruzar a peça com documentos e melhorar a qualidade da argumentação.`
