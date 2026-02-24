import { TABELA_OAB_REFERENCIA } from '@/lib/constants/tabela-oab'

// ── Variáveis reconhecidas para substituição direta ──
const VARIAVEIS_CONTRATO: Record<string, (d: DadosSubstituicao) => string | undefined> = {
  // Cliente
  nome_cliente:            d => d.cliente.nome,
  cpf_cliente:             d => d.cliente.cpf,
  rg_cliente:              d => d.cliente.rg,
  orgao_expedidor_cliente: d => d.cliente.orgao_expedidor,
  estado_civil_cliente:    d => d.cliente.estado_civil,
  nacionalidade_cliente:   d => d.cliente.nacionalidade,
  profissao_cliente:       d => d.cliente.profissao,
  telefone_cliente:        d => d.cliente.telefone,
  email_cliente:           d => d.cliente.email,
  endereco_cliente:        d => d.cliente.endereco,
  bairro_cliente:          d => d.cliente.bairro,
  cidade_cliente:          d => d.cliente.cidade,
  estado_cliente:          d => d.cliente.estado,
  cep_cliente:             d => d.cliente.cep,
  // Advogado
  nome_advogado:            d => d.advogado?.nome,
  cpf_advogado:             d => d.advogado?.cpf,
  rg_advogado:              d => d.advogado?.rg,
  orgao_expedidor_advogado: d => d.advogado?.orgao_expedidor,
  estado_civil_advogado:    d => d.advogado?.estado_civil,
  nacionalidade_advogado:   d => d.advogado?.nacionalidade,
  oab_numero:               d => d.advogado?.oab_numero,
  oab_estado:               d => d.advogado?.oab_estado,
  telefone_advogado:        d => d.advogado?.telefone,
  email_advogado:           d => d.advogado?.email,
  endereco_advogado:        d => d.advogado?.endereco,
  bairro_advogado:          d => d.advogado?.bairro,
  cidade_advogado:          d => d.advogado?.cidade,
  estado_advogado:          d => d.advogado?.estado,
  cep_advogado:             d => d.advogado?.cep,
  // Contrato
  area_juridica:      d => d.contrato.area,
  valor_fixo:         d => d.contrato.valor_fixo != null ? `R$ ${d.contrato.valor_fixo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : undefined,
  percentual_exito:   d => d.contrato.percentual_exito != null ? `${d.contrato.percentual_exito}%` : undefined,
  forma_pagamento:    d => d.contrato.forma_pagamento ?? undefined,
  // Auto
  data_extenso:       () => new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }),
  data:               () => new Date().toLocaleDateString('pt-BR'),
  objeto_contrato:    d => d.resumoCaso,
}

interface DadosSubstituicao {
  cliente: {
    nome?: string; cpf?: string; rg?: string; orgao_expedidor?: string
    estado_civil?: string; nacionalidade?: string; profissao?: string
    telefone?: string; email?: string; endereco?: string; bairro?: string
    cidade?: string; estado?: string; cep?: string
  }
  advogado?: {
    nome?: string; cpf?: string; rg?: string; orgao_expedidor?: string
    estado_civil?: string; nacionalidade?: string
    oab_numero?: string; oab_estado?: string
    telefone?: string; email?: string; endereco?: string; bairro?: string
    cidade?: string; estado?: string; cep?: string
  }
  contrato: {
    area?: string; valor_fixo?: number | null; percentual_exito?: number | null
    forma_pagamento?: string | null
  }
  resumoCaso?: string
}

/** Verifica se o texto contém variáveis {{...}} */
export function templateTemVariaveis(texto: string): boolean {
  return /\{\{[a-zA-Z_]+\}\}/.test(texto)
}

/** Substitui variáveis {{...}} conhecidas. Retorna o texto e a lista de campos não preenchidos. */
export function substituirVariaveis(
  template: string,
  dados: DadosSubstituicao,
): { resultado: string; naoPreenchidos: string[] } {
  const naoPreenchidos: string[] = []
  const resultado = template.replace(/\{\{([a-zA-Z_]+)\}\}/g, (match, varName: string) => {
    const fn = VARIAVEIS_CONTRATO[varName]
    if (fn) {
      const valor = fn(dados)
      if (valor) return valor
      naoPreenchidos.push(varName)
      return `[PREENCHER ${varName}]`
    }
    naoPreenchidos.push(varName)
    return `[PREENCHER ${varName}]`
  })
  return { resultado, naoPreenchidos }
}

// ── Prompt para CONVERTER modelo do advogado em template com variáveis ──
export const SYSTEM_CONVERTER_MODELO = `
Você é um assistente jurídico especializado em contratos.
Sua tarefa é CONVERTER o modelo de contrato fornecido em um template reutilizável com variáveis.

REGRAS:
1. MANTENHA o texto EXATAMENTE como está — não altere redação, cláusulas nem formatação
2. SUBSTITUA apenas os dados variáveis por placeholders no formato {{nome_variavel}}
3. Use estas variáveis padrão:
   - {{nome_cliente}}, {{cpf_cliente}}, {{rg_cliente}}, {{orgao_expedidor_cliente}}, {{estado_civil_cliente}}, {{nacionalidade_cliente}}, {{profissao_cliente}}
   - {{telefone_cliente}}, {{email_cliente}}, {{endereco_cliente}}, {{bairro_cliente}}, {{cidade_cliente}}, {{estado_cliente}}, {{cep_cliente}}
   - {{nome_advogado}}, {{cpf_advogado}}, {{rg_advogado}}, {{orgao_expedidor_advogado}}, {{estado_civil_advogado}}, {{nacionalidade_advogado}}
   - {{oab_numero}}, {{oab_estado}}, {{telefone_advogado}}, {{email_advogado}}
   - {{endereco_advogado}}, {{bairro_advogado}}, {{cidade_advogado}}, {{estado_advogado}}, {{cep_advogado}}
   - {{area_juridica}}, {{valor_fixo}}, {{percentual_exito}}, {{forma_pagamento}}
   - {{data_extenso}}, {{data}}, {{objeto_contrato}}
4. Se encontrar dados específicos (nomes, CPFs, endereços reais), substitua pela variável correspondente
5. Mantenha o formato Markdown
6. Responda APENAS com o template convertido, sem explicações
`.trim()

// ── Prompt para PREENCHER modelo do advogado com dados do sistema ──
export const SYSTEM_PREENCHER_MODELO = `
Você é um assistente jurídico especializado em contratos.
Recebeu o MODELO DE CONTRATO do advogado e os DADOS DO SISTEMA para preenchimento.

REGRAS OBRIGATÓRIAS:
1. SIGA O MODELO DO ADVOGADO EXATAMENTE — mantenha a mesma estrutura, cláusulas, redação e formatação
2. NÃO invente cláusulas, NÃO remova cláusulas, NÃO altere a redação do modelo
3. Substitua os dados variáveis (nomes, CPFs, RGs, endereços, valores, datas, etc.) com os dados fornecidos
4. Se um dado não está disponível no sistema, use [PREENCHER campo] como placeholder
5. Se preencher um campo por aproximação (nome da variável diferente), marque com [⚠ preenchido por aproximação]
6. Atualize a data do contrato para a data atual
7. Responda APENAS com o contrato completo preenchido em Markdown
8. O resultado DEVE ser o modelo do advogado com os dados preenchidos, NÃO um contrato novo
`.trim()

export const SYSTEM_CONTRATO_HONORARIOS = `
Você é um advogado especialista em contratos de prestação de serviços advocatícios.
Sua tarefa é redigir um Contrato de Honorários Advocatícios completo, formal e juridicamente sólido.

REGRAS DE FORMATAÇÃO OBRIGATÓRIAS:
- Responda APENAS com o texto do contrato em Markdown
- Use linguagem jurídica formal, clara e objetiva
- Marque com [PREENCHER] campos que precisam de informação não disponível
- Inclua todas as cláusulas essenciais de um contrato de honorários
- Baseie os valores na Tabela OAB fornecida e nos dados informados
- Se um modelo do advogado foi fornecido, adapte o estilo e estrutura para ser similar
- Gere o contrato COMPLETO do início ao fim, sem interrupções

ESTRUTURA DE FORMATAÇÃO (siga exatamente):
1. Título com # (ex: # CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS)
2. Linha separadora ---
3. Número do contrato em negrito: **CONTRATO DE HONORÁRIOS ADVOCATÍCIOS Nº [PREENCHER]/ANO**
4. Linha separadora ---
5. Parágrafo introdutório de apresentação das partes
6. Linha separadora ---
7. Cláusulas com ## e numeração romana: ## CLÁUSULA PRIMEIRA — DA IDENTIFICAÇÃO DAS PARTES
8. Sub-itens com numeração decimal em negrito: **1.1. CONTRATANTE:**
9. Campos em negrito: **Nome:** João Silva
10. Alíneas em negrito: **a)** texto da alínea
11. Linha separadora --- ao final de cada cláusula
12. Seção de assinaturas ao final com campos [PREENCHER]
`.trim()

interface DadosPessoa {
  nome?: string
  cpf?: string
  rg?: string
  orgao_expedidor?: string
  estado_civil?: string
  nacionalidade?: string
  profissao?: string
  oab_numero?: string
  oab_estado?: string
  telefone?: string
  email?: string
  endereco?: string
  bairro?: string
  cidade?: string
  estado?: string
  cep?: string
}

export function buildPromptContratoHonorarios(dados: {
  dadosContrato: {
    titulo?: string
    area?: string
    valor_fixo?: number | null
    percentual_exito?: number | null
    forma_pagamento?: string | null
  }
  dadosCliente: DadosPessoa
  dadosAdvogado?: DadosPessoa
  resumoCaso?: string
  modeloAdvogado?: string
  instrucoes?: string
}): string {
  const { dadosContrato, dadosCliente, dadosAdvogado, resumoCaso, modeloAdvogado, instrucoes } = dados

  const areaLabel: Record<string, string> = {
    previdenciario: 'Previdenciário',
    trabalhista:    'Trabalhista',
    civel:          'Cível',
    criminal:       'Criminal',
    tributario:     'Tributário',
    empresarial:    'Empresarial',
    familia:        'Família',
    consumidor:     'Consumidor',
    imobiliario:    'Imobiliário',
    administrativo: 'Administrativo',
  }

  const honorarioInfo = [
    dadosContrato.valor_fixo     ? `Valor fixo: R$ ${dadosContrato.valor_fixo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null,
    dadosContrato.percentual_exito !== null && dadosContrato.percentual_exito !== undefined
      ? `Percentual de êxito: ${dadosContrato.percentual_exito}%`
      : null,
    dadosContrato.forma_pagamento ? `Forma de pagamento: ${dadosContrato.forma_pagamento}` : null,
  ].filter(Boolean).join('\n')

  return `
## DADOS PARA O CONTRATO DE HONORÁRIOS

### Cliente (CONTRATANTE)
Nome: ${dadosCliente.nome || '[PREENCHER nome completo]'}
Nacionalidade: ${dadosCliente.nacionalidade || '[PREENCHER]'}
Estado civil: ${dadosCliente.estado_civil || '[PREENCHER]'}
Profissão: ${dadosCliente.profissao || '[PREENCHER]'}
CPF: ${dadosCliente.cpf || '[PREENCHER CPF]'}
RG: ${dadosCliente.rg || '[PREENCHER RG]'}
Órgão expedidor: ${dadosCliente.orgao_expedidor || '[PREENCHER]'}
Telefone: ${dadosCliente.telefone || '[PREENCHER]'}
E-mail: ${dadosCliente.email || '[PREENCHER]'}
Endereço: ${dadosCliente.endereco || '[PREENCHER endereço]'}${dadosCliente.bairro ? `, ${dadosCliente.bairro}` : ''}
${dadosCliente.cidade ? `Cidade/Estado: ${dadosCliente.cidade}/${dadosCliente.estado}` : 'Cidade/Estado: [PREENCHER]'}
CEP: ${dadosCliente.cep || '[PREENCHER]'}

### Advogado (CONTRATADO)
Nome: ${dadosAdvogado?.nome || '[PREENCHER]'}
Nacionalidade: ${dadosAdvogado?.nacionalidade || '[PREENCHER]'}
Estado civil: ${dadosAdvogado?.estado_civil || '[PREENCHER]'}
CPF: ${dadosAdvogado?.cpf || '[PREENCHER]'}
RG: ${dadosAdvogado?.rg || '[PREENCHER]'}
Órgão expedidor: ${dadosAdvogado?.orgao_expedidor || '[PREENCHER]'}
OAB nº: ${dadosAdvogado?.oab_numero || '[PREENCHER]'}/${dadosAdvogado?.oab_estado || 'SC'}
Telefone profissional: ${dadosAdvogado?.telefone || '[PREENCHER]'}
E-mail profissional: ${dadosAdvogado?.email || '[PREENCHER]'}
Endereço profissional: ${dadosAdvogado?.endereco || '[PREENCHER]'}${dadosAdvogado?.bairro ? `, ${dadosAdvogado.bairro}` : ''}
${dadosAdvogado?.cidade ? `Cidade/Estado: ${dadosAdvogado.cidade}/${dadosAdvogado.estado}` : 'Cidade/Estado: [PREENCHER]'}
CEP: ${dadosAdvogado?.cep || '[PREENCHER]'}

### Serviço contratado
Área jurídica: ${dadosContrato.area ? (areaLabel[dadosContrato.area] ?? dadosContrato.area) : '[PREENCHER área]'}
Título: ${dadosContrato.titulo || 'Contrato de Prestação de Serviços Advocatícios'}
Data do contrato: ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}

### Objeto do contrato (resumo do caso)
${resumoCaso || 'Defesa dos interesses do CONTRATANTE em processo judicial/administrativo na área indicada. [PREENCHER detalhes específicos]'}

### Honorários acordados
${honorarioInfo || '[PREENCHER valores de honorários conforme tabela OAB abaixo]'}

---

## TABELA OAB DE REFERÊNCIA

${TABELA_OAB_REFERENCIA}

---

${modeloAdvogado ? `## MODELO DO ADVOGADO (replicar o estilo e estrutura abaixo)\n\n${modeloAdvogado.substring(0, 3000)}\n\n---\n` : ''}

${instrucoes ? `## INSTRUÇÕES ADICIONAIS\n\n${instrucoes}\n\n---\n` : ''}

## ESTRUTURA OBRIGATÓRIA DO CONTRATO

Gere um contrato completo com as seguintes cláusulas:

1. **Identificação das partes** (Contratante e Contratado/Advogado — incluir nacionalidade, estado civil, profissão, CPF, RG com órgão expedidor, endereço completo)
2. **Do objeto** (descrição dos serviços a serem prestados)
3. **Das obrigações do Contratado** (deveres do advogado)
4. **Das obrigações do Contratante** (deveres do cliente)
5. **Dos honorários** (valores, percentuais, forma e prazo de pagamento)
6. **Da vigência** (duração do contrato)
7. **Da rescisão** (condições de rescisão por ambas as partes)
8. **Das despesas processuais** (custas, perícias, etc.)
9. **Da confidencialidade** (sigilo profissional e LGPD)
10. **Do foro** (comarca eleita para dirimir conflitos)
11. **Das disposições gerais**
12. **Assinaturas e data** (local, data do contrato informada acima, CONTRATANTE, CONTRATADO + OAB)

Responda com o contrato COMPLETO em Markdown. Use ## para cláusulas principais, texto corrido formal. Use a data do contrato informada acima (NÃO use [PREENCHER] para a data).
`.trim()
}
