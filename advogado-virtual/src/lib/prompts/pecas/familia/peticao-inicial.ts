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
    if (q.autor.email) linhas.push(`- E-mail: ${q.autor.email}`)
    if (q.autor.telefone) linhas.push(`- Telefone: ${q.autor.telefone}`)
  }

  if (q.reu && Object.values(q.reu).some(Boolean)) {
    linhas.push('**REQUERIDO(A):**')
    if (q.reu.nome) linhas.push(`- Nome: ${q.reu.nome}`)
    if (q.reu.cnpj_cpf) linhas.push(`- CPF: ${q.reu.cnpj_cpf}`)
    const endReu = [q.reu.endereco, q.reu.cidade, q.reu.estado].filter(Boolean).join(', ')
    if (endReu) linhas.push(`- Endereço: ${endReu}`)
  }

  linhas.push('')
  linhas.push('**OBRIGATÓRIO:** Use EXATAMENTE os dados acima na qualificação das partes. NÃO use [PREENCHER] para dados que foram fornecidos aqui. Copie nome, CPF, RG, endereço, cidade, estado e demais dados LITERALMENTE como informados acima. Use [PREENCHER] APENAS para campos que NÃO aparecem na lista acima.')
  return linhas.join('\n')
}

export function buildPromptPeticaoInicialFamilia(dados: {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  localizacao?: { cidade?: string; estado?: string }
  qualificacao?: { autor?: Record<string, string | undefined>; reu?: Record<string, string | undefined> }
}): string {
  const enderecamento = dados.localizacao?.cidade && dados.localizacao?.estado
    ? `Ao Juízo da [Xª] Vara de Família e Sucessões da Comarca de ${dados.localizacao.cidade}/${dados.localizacao.estado}`
    : 'Ao Juízo da [Xª] Vara de Família e Sucessões da Comarca de [PREENCHER comarca]'

  return `
Você é um advogado familiarista e sucessorista experiente redigindo uma Petição Inicial na área de Direito de Família e Sucessões.

## CONTEXTO
${dados.analise ? `### Análise jurídica prévia:\n${JSON.stringify(dados.analise, null, 2)}` : '### Sem análise prévia.'}

### Transcrição: ${dados.transcricao}
### Pedido específico: ${dados.pedido_especifico || 'Nenhum.'}
### Documentos: ${dados.documentos.length > 0 ? dados.documentos.map(d => `- ${d.file_name} (${d.tipo}): ${d.texto_extraido?.substring(0, 500) ?? 'sem texto'}`).join('\n') : 'Nenhum documento.'}
### Localização do cliente: ${dados.localizacao?.cidade ? `${dados.localizacao.cidade}/${dados.localizacao.estado}` : 'Não informada'}
${formatarQualificacao(dados.qualificacao)}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento: "${enderecamento}"
2. Qualificação do Requerente (com todos os dados pessoais disponíveis)
3. Qualificação do Requerido(a)
4. Dos Fatos
5. Do Direito (CC/2002 — Direito de Família e Sucessões, CPC/2015, CF/88 art. 226-230, Lei n. 8.069/1990 — ECA, Lei n. 11.340/2006 — Lei Maria da Penha se aplicável, Lei n. 6.515/1977 — Lei do Divórcio)
6. Da Guarda / Regime de Visitas (se aplicável)
7. Dos Alimentos (se aplicável — Lei n. 5.478/1968)
8. Da Partilha de Bens (se aplicável — regime de bens do casamento/união estável)
9. Do Inventário / Arrolamento (se aplicável — arts. 610 a 673 do CPC)
10. Da Tutela de Urgência (se aplicável)
11. Da Justiça Gratuita (se aplicável)
12. Dos Pedidos (lista numerada)
13. Das Provas
14. Do Valor da Causa
15. Requerimentos Finais
16. Fechamento

## REGRAS ESPECÍFICAS DE FAMÍLIA E SUCESSÕES
- Em ações de divórcio: mencionar regime de bens, existência de filhos menores, partilha
- Em ações de alimentos: fundamentar na necessidade do alimentando e possibilidade do alimentante (trinômio necessidade-possibilidade-proporcionalidade)
- Em guarda: priorizar o melhor interesse da criança/adolescente (art. 227 da CF, ECA)
- Em inventário/arrolamento: listar bens conhecidos, herdeiros necessários e quinhão hereditário
- Em união estável: comprovar os requisitos do art. 1.723 do CC (convivência pública, contínua, duradoura, com objetivo de constituição de família)
- Use APENAS fatos dos dados disponíveis
- NÃO invente jurisprudência — marque com [VERIFICAR] se necessário
- Marque com [PREENCHER] dados faltantes
- GERE A PEÇA COMPLETA do início ao fim, sem interrupções

${REGRAS_FORMATACAO_FORENSE}

Responda com a petição COMPLETA em Markdown bem formatado. Não interrompa a geração.
`.trim()
}

export const SYSTEM_PETICAO_FAMILIA = `Você é um advogado familiarista e sucessorista sênior redigindo peças processuais na área de Direito de Família e Sucessões. Escreva a peça COMPLETA em Markdown bem formatado, com linguagem jurídica formal e técnica. Fundamente com o Código Civil (CC/2002 — Livro IV: Direito de Família e Livro V: Direito das Sucessões), CPC/2015, CF/88, ECA (Lei n. 8.069/1990), Lei de Alimentos (Lei n. 5.478/1968) e demais legislação aplicável. NUNCA interrompa a geração — sempre conclua a peça inteira com todos os tópicos da estrutura obrigatória. ${SYSTEM_REGRAS_FORENSE}`
