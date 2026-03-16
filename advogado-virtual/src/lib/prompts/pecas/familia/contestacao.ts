import { REGRAS_FORMATACAO_FORENSE, SYSTEM_REGRAS_FORENSE } from '../regras-formatacao'

function formatarQualificacao(q?: {
  autor?: Record<string, string | undefined>
  reu?: Record<string, string | undefined>
}): string {
  if (!q) return '### Qualificação das partes: Não disponível — use [PREENCHER] para dados faltantes.'

  const linhas: string[] = ['### Qualificação das partes (dados extraídos dos documentos):']

  if (q.autor && Object.values(q.autor).some(Boolean)) {
    linhas.push('**REQUERENTE:**')
    if (q.autor.nome) linhas.push(`- Nome: ${q.autor.nome}`)
    if (q.autor.cpf) linhas.push(`- CPF: ${q.autor.cpf}`)
    if (q.autor.rg) linhas.push(`- RG: ${q.autor.rg}${q.autor.orgao_expedidor ? ` (${q.autor.orgao_expedidor})` : ''}`)
    if (q.autor.estado_civil) linhas.push(`- Estado civil: ${q.autor.estado_civil}`)
    if (q.autor.nacionalidade) linhas.push(`- Nacionalidade: ${q.autor.nacionalidade}`)
    if (q.autor.profissao) linhas.push(`- Profissão: ${q.autor.profissao}`)
    const endereco = [q.autor.endereco, q.autor.bairro, q.autor.cidade, q.autor.estado, q.autor.cep].filter(Boolean).join(', ')
    if (endereco) linhas.push(`- Endereço: ${endereco}`)
  }

  if (q.reu && Object.values(q.reu).some(Boolean)) {
    linhas.push('**REQUERIDO(A):**')
    if (q.reu.nome) linhas.push(`- Nome: ${q.reu.nome}`)
    if (q.reu.cnpj_cpf) linhas.push(`- CPF: ${q.reu.cnpj_cpf}`)
    const endReu = [q.reu.endereco, q.reu.cidade, q.reu.estado].filter(Boolean).join(', ')
    if (endReu) linhas.push(`- Endereço: ${endReu}`)
  }

  linhas.push('')
  linhas.push('**OBRIGATÓRIO:** Use EXATAMENTE os dados acima na qualificação das partes. NÃO use [PREENCHER] para dados que foram fornecidos aqui. Use [PREENCHER] APENAS para campos que NÃO aparecem na lista acima.')
  return linhas.join('\n')
}

export function buildPromptContestacaoFamilia(dados: {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  localizacao?: { cidade?: string; estado?: string }
  qualificacao?: { autor?: Record<string, string | undefined>; reu?: Record<string, string | undefined> }
}): string {
  return `
Você é um advogado familiarista e sucessorista experiente redigindo uma Contestação na área de Direito de Família e Sucessões.

## CONTEXTO
${dados.analise ? `### Análise jurídica prévia:\n${JSON.stringify(dados.analise, null, 2)}` : '### Sem análise prévia.'}

### Transcrição: ${dados.transcricao}
### Pedido específico: ${dados.pedido_especifico || 'Nenhum.'}
### Documentos: ${dados.documentos.length > 0 ? dados.documentos.map(d => `- ${d.file_name} (${d.tipo}): ${d.texto_extraido?.substring(0, 500) ?? 'sem texto'}`).join('\n') : 'Nenhum documento.'}
${formatarQualificacao(dados.qualificacao)}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento (Vara de Família e Sucessões)
2. Qualificação das Partes
3. Breve Resumo da Ação
4. Preliminares (prescrição, decadência, incompetência, ilegitimidade)
5. Do Mérito — Impugnação Específica de Cada Pedido
6. Da Guarda / Alimentos / Partilha — contestação específica conforme o caso
7. Dos Pedidos
8. Das Provas
9. Fechamento

## REGRAS
- Impugne cada pedido do requerente especificamente
- Em alimentos: conteste com base na capacidade financeira real e necessidades do alimentando
- Em guarda: priorize o melhor interesse da criança (ECA, CF art. 227)
- Em partilha: conteste a avaliação de bens e o regime aplicável
- Use APENAS fatos dos dados disponíveis
- NÃO invente jurisprudência — marque com [VERIFICAR]
- Marque com [PREENCHER] dados faltantes
- GERE A PEÇA COMPLETA do início ao fim, sem interrupções

${REGRAS_FORMATACAO_FORENSE}

Responda com a contestação COMPLETA em Markdown bem formatado. Não interrompa a geração.
`.trim()
}

export const SYSTEM_CONTESTACAO_FAMILIA = `Você é um advogado familiarista sênior redigindo peças de defesa em Direito de Família e Sucessões. Escreva a peça COMPLETA em Markdown bem formatado, com linguagem jurídica formal. Fundamente com CC/2002, CPC/2015, CF/88, ECA e legislação específica de família. NUNCA interrompa a geração — sempre conclua a peça inteira. ${SYSTEM_REGRAS_FORENSE}`
