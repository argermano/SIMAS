// Helper compartilhado pelos prompts curados NOVOS (réplica, apelação, recurso
// ordinário). Reproduz o formato de qualificação já usado nas petições iniciais
// existentes. Os prompts antigos mantêm sua própria cópia da função (para não
// alterar seu texto e quebrar os snapshots de proteção); os novos importam
// daqui para evitar 10× de duplicação.

export type DadosQualificacao = {
  autor?: Record<string, string | undefined>
  reu?: Record<string, string | undefined>
}

export function formatarQualificacao(q?: DadosQualificacao): string {
  if (!q) return '### Qualificação das partes: Não disponível — use [PREENCHER] para dados faltantes.'

  const linhas: string[] = ['### Qualificação das partes (dados extraídos dos documentos):']

  if (q.autor && Object.values(q.autor).some(Boolean)) {
    linhas.push('**AUTOR:**')
    if (q.autor.nome) linhas.push(`- Nome: ${q.autor.nome}`)
    if (q.autor.cpf) linhas.push(`- CPF: ${q.autor.cpf}`)
    if (q.autor.rg) linhas.push(`- RG: ${q.autor.rg}${q.autor.orgao_expedidor ? ` (${q.autor.orgao_expedidor})` : ''}`)
    if (q.autor.estado_civil) linhas.push(`- Estado civil: ${q.autor.estado_civil}`)
    if (q.autor.nacionalidade) linhas.push(`- Nacionalidade: ${q.autor.nacionalidade}`)
    if (q.autor.profissao) linhas.push(`- Profissão: ${q.autor.profissao}`)
    const endereco = [q.autor.endereco, q.autor.bairro, q.autor.cidade, q.autor.estado, q.autor.cep].filter(Boolean).join(', ')
    if (endereco) linhas.push(`- Endereço: ${endereco}`)
    if (q.autor.email) linhas.push(`- E-mail: ${q.autor.email}`)
  }

  if (q.reu && Object.values(q.reu).some(Boolean)) {
    linhas.push('**RÉU:**')
    if (q.reu.nome) linhas.push(`- Nome/Razão social: ${q.reu.nome}`)
    if (q.reu.cnpj_cpf) linhas.push(`- CNPJ/CPF: ${q.reu.cnpj_cpf}`)
    const endReu = [q.reu.endereco, q.reu.cidade, q.reu.estado].filter(Boolean).join(', ')
    if (endReu) linhas.push(`- Endereço: ${endReu}`)
  }

  linhas.push('')
  linhas.push('**OBRIGATÓRIO:** Use EXATAMENTE os dados acima na qualificação das partes. NÃO use [PREENCHER] para dados que foram fornecidos aqui. Copie nome, CPF, RG, endereço, cidade, estado e demais dados LITERALMENTE como informados acima. Use [PREENCHER] APENAS para campos que NÃO aparecem na lista acima.')
  return linhas.join('\n')
}

/**
 * Formata os documentos do caso com o texto INTEGRAL (sem truncar). Os prompts
 * NOVOS passam o conteúdo completo das provas — a triagem de relevância e o teto
 * MAX_PROMPT_CHARS já protegem contra estouro de contexto. (Os prompts antigos
 * truncavam em 500 chars; isso é bug reconhecido, corrigido separadamente.)
 */
export function formatarDocumentosIntegrais(
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>,
): string {
  if (documentos.length === 0) return 'Nenhum documento.'
  return documentos
    .map((d) => `- ${d.file_name} (${d.tipo}):\n${d.texto_extraido?.trim() || 'sem texto extraído'}`)
    .join('\n\n')
}
