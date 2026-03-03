export const SYSTEM_NOTIFICACAO = `Você é um especialista jurídico brasileiro que redige notificações extrajudiciais.

Gere uma NOTIFICAÇÃO EXTRAJUDICIAL completa, formal e juridicamente válida em Markdown.

REGRAS:
- Use APENAS Markdown (# para título, ** para negrito, --- para separadores)
- Use {{variavel}} para campos que mudam a cada geração
- A notificação deve ser formal, com linguagem jurídica adequada
- Inclua prazo para resposta/cumprimento
- Inclua aviso de consequências em caso de não cumprimento (ação judicial)
- Inclua campo de assinatura do advogado com local e data
- Gere um template REUTILIZÁVEL

VARIÁVEIS PADRÃO disponíveis:
- {{nome_cliente}} — nome completo do notificante (cliente)
- {{cpf_cliente}} — CPF do notificante
- {{endereco_cliente}} — endereço do notificante
- {{cidade_cliente}} — cidade do notificante
- {{estado_cliente}} — UF do notificante
- {{nome_advogado}} — nome do advogado subscritor
- {{numero_oab}} — número OAB do advogado
- {{estado_oab}} — seccional OAB
- {{data_extenso}} — data por extenso
- {{objeto_notificacao}} — objeto/motivo da notificação
- {{prazo_resposta}} — prazo em dias para resposta/cumprimento

Retorne APENAS o texto Markdown da notificação, sem explicações adicionais.`

export function buildPromptNotificacao({
  cliente,
  advogadoNome,
  objetoNotificacao,
  prazoResposta,
}: {
  cliente: { nome: string; cpf?: string | null; endereco?: string | null; cidade?: string | null; estado?: string | null }
  advogadoNome: string
  objetoNotificacao?: string
  prazoResposta?: string
}): string {
  return `Gere uma notificação extrajudicial com os seguintes dados conhecidos:

NOTIFICANTE (cliente):
- Nome: ${cliente.nome}
- CPF: ${cliente.cpf ?? '[use {{cpf_cliente}}]'}
- Endereço: ${cliente.endereco ?? '[use {{endereco_cliente}}]'}
- Cidade: ${cliente.cidade ?? '[use {{cidade_cliente}}]'}
- Estado: ${cliente.estado ?? '[use {{estado_cliente}}]'}

ADVOGADO SUBSCRITOR:
- Nome: ${advogadoNome}
- OAB: use {{numero_oab}}/{{estado_oab}}

OBJETO DA NOTIFICAÇÃO: ${objetoNotificacao ?? '[use {{objeto_notificacao}}]'}
PRAZO PARA CUMPRIMENTO: ${prazoResposta ?? '[use {{prazo_resposta}}]'} dias

Gere o template com {{variavel}} em TODOS os campos que devem ser personalizados.
O template deve ser reutilizável para outras situações.`
}
