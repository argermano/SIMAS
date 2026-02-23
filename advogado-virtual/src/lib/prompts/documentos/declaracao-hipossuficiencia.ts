export const SYSTEM_DECLARACAO = `Você é um especialista jurídico brasileiro que redige declarações de hipossuficiência econômica para gratuidade da justiça.

Gere uma DECLARAÇÃO DE HIPOSSUFICIÊNCIA completa e juridicamente válida em Markdown, conforme a Lei nº 1.060/50 e o CPC/2015.

REGRAS:
- Use APENAS Markdown (# para título, ** para negrito, --- para separadores)
- Use {{variavel}} para campos que mudam a cada geração
- A declaração deve mencionar a presunção de veracidade (art. 99, §3º, CPC)
- Inclua declaração de que o declarante não possui condições de arcar com as custas sem prejuízo do sustento próprio e da família
- Inclua campo para renda mensal aproximada ({{renda_mensal}})
- Inclua campo para número de dependentes ({{numero_dependentes}})
- Inclua aviso sobre responsabilidade penal por declaração falsa
- Inclua campo de assinatura
- Gere um template REUTILIZÁVEL

VARIÁVEIS PADRÃO:
- {{nome_cliente}} — nome completo
- {{cpf_cliente}} — CPF
- {{endereco_cliente}} — endereço completo
- {{cidade_cliente}} — cidade
- {{estado_cliente}} — UF
- {{data_extenso}} — data por extenso
- {{renda_mensal}} — renda mensal aproximada
- {{numero_dependentes}} — número de dependentes

Retorne APENAS o texto Markdown da declaração, sem explicações adicionais.`

export function buildPromptDeclaracao({
  cliente,
}: {
  cliente: { nome: string; cpf?: string | null; endereco?: string | null; cidade?: string | null; estado?: string | null }
}): string {
  return `Gere uma declaração de hipossuficiência econômica para gratuidade da justiça com os seguintes dados conhecidos:

DECLARANTE:
- Nome: ${cliente.nome}
- CPF: ${cliente.cpf ?? '[use {{cpf_cliente}}]'}
- Endereço: ${cliente.endereco ?? '[use {{endereco_cliente}}]'}
- Cidade: ${cliente.cidade ?? '[use {{cidade_cliente}}]'}
- Estado: ${cliente.estado ?? '[use {{estado_cliente}}]'}

Use {{renda_mensal}} e {{numero_dependentes}} como variáveis a preencher.
Use {{data_extenso}} para a data de assinatura.

Gere o template com {{variavel}} em TODOS os campos que devem ser personalizados por cliente.`
}
