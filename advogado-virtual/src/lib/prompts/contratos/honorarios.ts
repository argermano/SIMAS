import { TABELA_OAB_REFERENCIA } from '@/lib/constants/tabela-oab'

export const SYSTEM_CONTRATO_HONORARIOS = `
Você é um advogado especialista em contratos de prestação de serviços advocatícios.
Sua tarefa é redigir um Contrato de Honorários Advocatícios completo, formal e juridicamente sólido.

REGRAS:
- Responda APENAS com o texto do contrato em Markdown
- Use linguagem jurídica formal, clara e objetiva
- Marque com [PREENCHER] campos que precisam de informação não disponível
- Inclua todas as cláusulas essenciais de um contrato de honorários
- Baseie os valores na Tabela OAB fornecida e nos dados informados
- Se um modelo do advogado foi fornecido, adapte o estilo e estrutura para ser similar
- Gere o contrato COMPLETO do início ao fim, sem interrupções
`.trim()

export function buildPromptContratoHonorarios(dados: {
  dadosContrato: {
    titulo?: string
    area?: string
    valor_fixo?: number | null
    percentual_exito?: number | null
    forma_pagamento?: string | null
  }
  dadosCliente: {
    nome?: string
    cpf?: string
    endereco?: string
    cidade?: string
    estado?: string
  }
  resumoCaso?: string
  modeloAdvogado?: string
  instrucoes?: string
}): string {
  const { dadosContrato, dadosCliente, resumoCaso, modeloAdvogado, instrucoes } = dados

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

### Cliente
Nome: ${dadosCliente.nome || '[PREENCHER nome completo]'}
CPF: ${dadosCliente.cpf || '[PREENCHER CPF]'}
Endereço: ${dadosCliente.endereco || '[PREENCHER endereço]'}
${dadosCliente.cidade ? `Cidade/Estado: ${dadosCliente.cidade}/${dadosCliente.estado}` : 'Cidade/Estado: [PREENCHER]'}

### Serviço contratado
Área jurídica: ${dadosContrato.area ? (areaLabel[dadosContrato.area] ?? dadosContrato.area) : '[PREENCHER área]'}
Título: ${dadosContrato.titulo || 'Contrato de Prestação de Serviços Advocatícios'}

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

1. **Identificação das partes** (Contratante e Contratado/Advogado)
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
12. **Assinaturas e data** (local, data, CONTRATANTE, CONTRATADO + OAB nº [PREENCHER])

Responda com o contrato COMPLETO em Markdown. Use ## para cláusulas principais, texto corrido formal.
`.trim()
}
