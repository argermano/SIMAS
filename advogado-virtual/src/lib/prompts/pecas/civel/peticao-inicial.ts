import { REGRAS_FORMATACAO_FORENSE, SYSTEM_REGRAS_FORENSE } from '../regras-formatacao'

function formatarQualificacao(q?: {
  autor?: Record<string, string | undefined>
  reu?: Record<string, string | undefined>
}): string {
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
    if (q.autor.telefone) linhas.push(`- Telefone: ${q.autor.telefone}`)
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

export function buildPromptPeticaoInicialCivel(dados: {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  localizacao?: { cidade?: string; estado?: string }
  qualificacao?: { autor?: Record<string, string | undefined>; reu?: Record<string, string | undefined> }
}): string {
  const enderecamento = dados.localizacao?.cidade && dados.localizacao?.estado
    ? `Ao Juízo da [Xª] Vara Cível da Comarca de ${dados.localizacao.cidade}/${dados.localizacao.estado}`
    : 'Ao Juízo da [Xª] Vara Cível da Comarca de [PREENCHER comarca]'

  return `
Você é um advogado civilista experiente redigindo uma Petição Inicial Cível.

## CONTEXTO
${dados.analise ? `### Análise jurídica prévia:\n${JSON.stringify(dados.analise, null, 2)}` : '### Sem análise prévia.'}

### Transcrição: ${dados.transcricao}
### Pedido específico: ${dados.pedido_especifico || 'Nenhum.'}
### Documentos: ${dados.documentos.length > 0 ? dados.documentos.map(d => `- ${d.file_name} (${d.tipo}): ${d.texto_extraido?.substring(0, 500) ?? 'sem texto'}`).join('\n') : 'Nenhum documento.'}
### Localização do cliente: ${dados.localizacao?.cidade ? `${dados.localizacao.cidade}/${dados.localizacao.estado}` : 'Não informada'}
${formatarQualificacao(dados.qualificacao)}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento: "${enderecamento}"
2. Qualificação do Autor (com todos os dados pessoais disponíveis)
3. Qualificação do Réu
4. Dos Fatos
5. Do Direito (CC/2002, CPC/2015, CF/88, legislação específica aplicável)
6. Da Competência (se aplicável)
7. Da Tutela de Urgência / Tutela Antecipada (se aplicável)
8. Da Justiça Gratuita (se aplicável)
9. Dos Pedidos (lista numerada — pedido principal e subsidiários)
10. Das Provas
11. Do Valor da Causa
12. Requerimentos Finais
13. Fechamento

## REGRAS
- Use APENAS fatos dos dados disponíveis
- NÃO invente jurisprudência — marque com [VERIFICAR] se necessário
- Marque com [PREENCHER] dados faltantes
- Linguagem técnica jurídica formal
- Fundamente com artigos do Código Civil, CPC e CF/88
- Inclua pedido de Justiça Gratuita quando pertinente
- GERE A PEÇA COMPLETA do início ao fim, sem interrupções

${REGRAS_FORMATACAO_FORENSE}

Responda com a petição COMPLETA em Markdown bem formatado. Não interrompa a geração.
`.trim()
}

export const SYSTEM_PETICAO_CIVEL = `Você é um advogado civilista sênior redigindo peças processuais cíveis. Escreva a peça COMPLETA em Markdown bem formatado, com linguagem jurídica formal e técnica. Fundamente com o Código Civil (CC/2002), CPC/2015 e CF/88. NUNCA interrompa a geração — sempre conclua a peça inteira com todos os tópicos da estrutura obrigatória. ${SYSTEM_REGRAS_FORENSE}`
