export const SYSTEM_CONTRATO_HONORARIOS = `Você é um especialista jurídico brasileiro que redige contratos de honorários advocatícios.

Gere um CONTRATO DE HONORÁRIOS ADVOCATÍCIOS completo, formal e juridicamente válido em Markdown.

REGRAS:
- Use APENAS Markdown (# para título, ** para negrito, --- para separadores)
- Use {{variavel}} para campos que mudam a cada geração
- Inclua cláusulas de: objeto, honorários, forma de pagamento, obrigações das partes, prazo, rescisão, foro
- Baseie-se no Estatuto da OAB (Lei 8.906/94) e no Código de Ética
- Inclua campos de assinatura do advogado e do cliente
- Gere um template REUTILIZÁVEL

VARIÁVEIS PADRÃO disponíveis:
- {{nome_cliente}} — nome completo do contratante
- {{cpf_cliente}} — CPF do contratante
- {{endereco_cliente}} — endereço do contratante
- {{cidade_cliente}} — cidade do contratante
- {{estado_cliente}} — UF do contratante
- {{nome_advogado}} — nome do advogado contratado
- {{numero_oab}} — número OAB
- {{estado_oab}} — seccional OAB
- {{data_extenso}} — data por extenso
- {{valor_fixo}} — valor fixo dos honorários
- {{percentual_exito}} — percentual de honorários de êxito
- {{forma_pagamento}} — forma de pagamento acordada
- {{instrucoes_adicionais}} — instruções e cláusulas especiais

Retorne APENAS o texto Markdown do contrato, sem explicações adicionais.`

export function buildPromptContratoHonorarios({
  cliente,
  advogadoNome,
  valorFixo,
  percentualExito,
  formaPagamento,
  instrucoes,
}: {
  cliente: { nome: string; cpf?: string | null; endereco?: string | null; cidade?: string | null; estado?: string | null }
  advogadoNome: string
  valorFixo?: string
  percentualExito?: string
  formaPagamento?: string
  instrucoes?: string
}): string {
  return `Gere um contrato de honorários advocatícios com os seguintes dados conhecidos:

CONTRATANTE (cliente):
- Nome: ${cliente.nome}
- CPF: ${cliente.cpf ?? '[use {{cpf_cliente}}]'}
- Endereço: ${cliente.endereco ?? '[use {{endereco_cliente}}]'}
- Cidade: ${cliente.cidade ?? '[use {{cidade_cliente}}]'}
- Estado: ${cliente.estado ?? '[use {{estado_cliente}}]'}

CONTRATADO (advogado):
- Nome: ${advogadoNome}
- OAB: use {{numero_oab}}/{{estado_oab}}

HONORÁRIOS:
- Valor fixo: ${valorFixo ? `R$ ${valorFixo}` : '[use {{valor_fixo}}]'}
- Percentual de êxito: ${percentualExito ? `${percentualExito}%` : '[use {{percentual_exito}}]'}
- Forma de pagamento: ${formaPagamento ?? '[use {{forma_pagamento}}]'}
${instrucoes ? `\nINSTRUÇÕES ADICIONAIS:\n${instrucoes}` : ''}

Gere o template com {{variavel}} em TODOS os campos que devem ser personalizados.
O template deve ser reutilizável para outros clientes.`
}
