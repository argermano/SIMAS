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

export function buildPromptPeticaoInicialMedico(dados: {
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
Você é um advogado especialista em Direito Médico e da Saúde, experiente em responsabilidade civil médica, erro médico, planos de saúde e bioética jurídica, redigindo uma Petição Inicial.

## CONTEXTO
${dados.analise ? `### Análise jurídica prévia:\n${JSON.stringify(dados.analise, null, 2)}` : '### Sem análise prévia.'}

### Transcrição: ${dados.transcricao}
### Pedido específico: ${dados.pedido_especifico || 'Nenhum.'}
### Documentos: ${dados.documentos.length > 0 ? dados.documentos.map(d => `- ${d.file_name} (${d.tipo}): ${d.texto_extraido?.substring(0, 500) ?? 'sem texto'}`).join('\n') : 'Nenhum documento.'}
### Localização do cliente: ${dados.localizacao?.cidade ? `${dados.localizacao.cidade}/${dados.localizacao.estado}` : 'Não informada'}
${formatarQualificacao(dados.qualificacao)}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento: "${enderecamento}"
2. Qualificação do Autor (paciente ou familiar)
3. Qualificação do Réu (médico, hospital, clínica, plano de saúde)
4. Dos Fatos (cronologia detalhada do atendimento médico)
5. Do Erro Médico / Da Falha na Prestação do Serviço (se aplicável)
6. Da Responsabilidade Civil (arts. 186, 927, 951 do CC/2002; arts. 14 e 18 do CDC)
7. Do Nexo Causal (relação entre conduta e dano)
8. Da Responsabilidade Objetiva do Hospital/Plano (se aplicável — CDC art. 14)
9. Da Responsabilidade Subjetiva do Médico (se aplicável — CC art. 951)
10. Do Dever de Informação e Consentimento Informado (Resolução CFM n. 2.217/2018)
11. Dos Danos Materiais (despesas médicas, lucros cessantes)
12. Dos Danos Morais
13. Dos Danos Estéticos (se aplicável — cumulação com dano moral, Súmula 387/STJ)
14. Da Inversão do Ônus da Prova (CDC art. 6º, VIII)
15. Da Tutela de Urgência (se aplicável)
16. Da Justiça Gratuita (se aplicável)
17. Dos Pedidos (lista numerada)
18. Das Provas (incluir perícia médica)
19. Do Valor da Causa
20. Requerimentos Finais
21. Fechamento

## REGRAS ESPECÍFICAS DE DIREITO MÉDICO
- Descreva cronologicamente todo o atendimento médico (datas, procedimentos, profissionais)
- Diferencie responsabilidade subjetiva do médico (culpa) da objetiva do hospital/plano (CDC)
- Fundamente com: CC/2002 (arts. 186, 187, 927, 949, 950, 951), CDC (arts. 6º, 14, 18), CF/88 (art. 5º, X e art. 196)
- Mencione Resoluções do CFM quando pertinente
- Solicite perícia médica para comprovar o nexo causal
- Em ações contra plano de saúde: fundamente com Lei n. 9.656/1998 e Súmulas do STJ (302, 597, 608, 609)
- Danos estéticos podem ser cumulados com danos morais (Súmula 387/STJ)
- Use APENAS fatos dos dados disponíveis
- NÃO invente jurisprudência — marque com [VERIFICAR] se necessário
- Marque com [PREENCHER] dados faltantes
- GERE A PEÇA COMPLETA do início ao fim, sem interrupções

${REGRAS_FORMATACAO_FORENSE}

Responda com a petição COMPLETA em Markdown bem formatado. Não interrompa a geração.
`.trim()
}

export const SYSTEM_PETICAO_MEDICO = `Você é um advogado sênior especialista em Direito Médico e da Saúde redigindo peças processuais. Escreva a peça COMPLETA em Markdown bem formatado, com linguagem jurídica formal e técnica. Fundamente com o Código Civil (CC/2002 — responsabilidade civil médica), CDC (relação de consumo médico-paciente), CF/88, Lei n. 9.656/1998 (planos de saúde), Resoluções do CFM e jurisprudência do STJ. NUNCA interrompa a geração — sempre conclua a peça inteira com todos os tópicos da estrutura obrigatória. ${SYSTEM_REGRAS_FORENSE}`
