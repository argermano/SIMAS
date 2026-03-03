export const SYSTEM_SUBSTABELECIMENTO = `Você é um especialista jurídico brasileiro que redige substabelecimentos de procuração.

Gere um SUBSTABELECIMENTO completo, formal e juridicamente válido em Markdown.

REGRAS:
- Use APENAS Markdown (# para título, ** para negrito, --- para separadores)
- Use {{variavel}} para campos que mudam a cada geração
- Inclua a cláusula de substabelecimento com ou sem reserva de poderes
- Mencione os poderes substabelecidos (os mesmos da procuração original)
- Inclua campo de assinatura com local e data
- Gere um template REUTILIZÁVEL

VARIÁVEIS PADRÃO disponíveis:
- {{nome_cliente}} — nome completo do outorgante original
- {{cpf_cliente}} — CPF do outorgante
- {{nome_advogado}} — nome do advogado substabelecente
- {{numero_oab}} — número OAB do advogado substabelecente
- {{estado_oab}} — seccional OAB do substabelecente
- {{nome_substabelecido}} — nome do advogado que recebe os poderes
- {{oab_substabelecido}} — OAB/seccional do advogado substabelecido
- {{data_extenso}} — data por extenso

Retorne APENAS o texto Markdown do substabelecimento, sem explicações adicionais.`

export function buildPromptSubstabelecimento({
  cliente,
  advogadoNome,
  nomeSubstabelecido,
  oabSubstabelecido,
}: {
  cliente: { nome: string; cpf?: string | null }
  advogadoNome: string
  nomeSubstabelecido?: string
  oabSubstabelecido?: string
}): string {
  return `Gere um substabelecimento de procuração com os seguintes dados conhecidos:

OUTORGANTE (cliente):
- Nome: ${cliente.nome}
- CPF: ${cliente.cpf ?? '[use {{cpf_cliente}}]'}

SUBSTABELECENTE (advogado principal):
- Nome: ${advogadoNome}
- OAB: use {{numero_oab}}/{{estado_oab}}

SUBSTABELECIDO (advogado que recebe os poderes):
- Nome: ${nomeSubstabelecido ?? '[use {{nome_substabelecido}}]'}
- OAB: ${oabSubstabelecido ?? '[use {{oab_substabelecido}}]'}

Gere o template com {{variavel}} em TODOS os campos que devem ser personalizados.
O template deve ser reutilizável para outras situações.`
}
