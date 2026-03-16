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
  }

  if (q.reu && Object.values(q.reu).some(Boolean)) {
    linhas.push('**RÉU:**')
    if (q.reu.nome) linhas.push(`- Nome/Razão social: ${q.reu.nome}`)
    if (q.reu.cnpj_cpf) linhas.push(`- CNPJ/CPF: ${q.reu.cnpj_cpf}`)
    const endReu = [q.reu.endereco, q.reu.cidade, q.reu.estado].filter(Boolean).join(', ')
    if (endReu) linhas.push(`- Endereço: ${endReu}`)
  }

  linhas.push('')
  linhas.push('**OBRIGATÓRIO:** Use EXATAMENTE os dados acima na qualificação das partes. Use [PREENCHER] APENAS para campos que NÃO aparecem na lista acima.')
  return linhas.join('\n')
}

export function buildPromptContestacaoMedico(dados: {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  localizacao?: { cidade?: string; estado?: string }
  qualificacao?: { autor?: Record<string, string | undefined>; reu?: Record<string, string | undefined> }
}): string {
  return `
Você é um advogado especialista em Direito Médico redigindo uma Contestação em defesa de profissional de saúde, hospital ou plano de saúde.

## CONTEXTO
${dados.analise ? `### Análise jurídica prévia:\n${JSON.stringify(dados.analise, null, 2)}` : '### Sem análise prévia.'}

### Transcrição: ${dados.transcricao}
### Pedido específico: ${dados.pedido_especifico || 'Nenhum.'}
### Documentos: ${dados.documentos.length > 0 ? dados.documentos.map(d => `- ${d.file_name} (${d.tipo}): ${d.texto_extraido?.substring(0, 500) ?? 'sem texto'}`).join('\n') : 'Nenhum documento.'}
${formatarQualificacao(dados.qualificacao)}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento (Vara Cível)
2. Qualificação das Partes
3. Breve Resumo da Ação
4. Preliminares (prescrição — art. 206, §3º, V do CC; ilegitimidade; inépcia)
5. Da Ausência de Erro Médico / Da Conduta Adequada
6. Da Observância dos Protocolos Médicos e *Lex Artis*
7. Do Consentimento Informado
8. Da Inexistência de Nexo Causal
9. Do *Iatrogenia* e da Obrigação de Meio (não de resultado)
10. Da Inexistência ou Minoração dos Danos
11. Dos Pedidos
12. Das Provas (incluir perícia médica)
13. Fechamento

## REGRAS
- Demonstre que a conduta médica seguiu a *lex artis* e os protocolos vigentes
- Diferencie obrigação de meio (regra geral) de obrigação de resultado (cirurgia estética)
- Conteste o nexo causal detalhadamente
- Argumente sobre *iatrogenia* (reação adversa não culposa) quando aplicável
- Impugne cada pedido do autor especificamente
- Use APENAS fatos dos dados disponíveis
- NÃO invente jurisprudência — marque com [VERIFICAR]
- Marque com [PREENCHER] dados faltantes
- GERE A PEÇA COMPLETA do início ao fim, sem interrupções

${REGRAS_FORMATACAO_FORENSE}

Responda com a contestação COMPLETA em Markdown bem formatado. Não interrompa a geração.
`.trim()
}

export const SYSTEM_CONTESTACAO_MEDICO = `Você é um advogado sênior especialista em Direito Médico redigindo peças de defesa para profissionais de saúde, hospitais e planos de saúde. Escreva a peça COMPLETA em Markdown bem formatado, com linguagem jurídica formal. Fundamente com CC/2002, CDC, CF/88, Resoluções do CFM e jurisprudência do STJ. NUNCA interrompa a geração — sempre conclua a peça inteira. ${SYSTEM_REGRAS_FORENSE}`
