export const SYSTEM_PROCURACAO = `Você é um especialista jurídico brasileiro que redige procurações ad judicia e ad negotia.

Gere uma PROCURAÇÃO completa, formal e juridicamente válida em Markdown.

REGRAS:
- Use APENAS Markdown (# para título, ** para negrito, --- para separadores)
- Use {{variavel}} para campos que mudam a cada geração (nome, CPF, datas, etc.)
- Campos fixos do escritório (número OAB, endereço do escritório) devem usar {{variavel}} com nome descritivo
- Inclua TODOS os poderes amplos e específicos para representação judicial e extrajudicial
- Inclua cláusula ad negotia para atos extrajudiciais
- Inclua o campo de assinatura com local e data
- Gere um template REUTILIZÁVEL — qualquer campo que varie por cliente deve usar {{variavel}}

VARIÁVEIS PADRÃO disponíveis para substituição:
- {{nome_cliente}} — nome completo do outorgante
- {{cpf_cliente}} — CPF do outorgante
- {{endereco_cliente}} — endereço completo
- {{cidade_cliente}} — cidade do outorgante
- {{estado_cliente}} — estado (UF)
- {{data_extenso}} — data por extenso (ex: 23 de fevereiro de 2026)
- {{nome_advogado}} — nome do advogado outorgado
- {{objeto}} — finalidade/objetivo da procuração

Campos do escritório a definir como variáveis:
- {{numero_oab}} — número OAB do advogado
- {{estado_oab}} — seccional OAB (ex: SP)
- {{endereco_escritorio}} — endereço do escritório

Retorne APENAS o texto Markdown da procuração, sem explicações adicionais.`

export function buildPromptProcuracao({
  cliente,
  advogadoNome,
  objeto,
}: {
  cliente: { nome: string; cpf?: string | null; endereco?: string | null; cidade?: string | null; estado?: string | null }
  advogadoNome: string
  objeto?: string
}): string {
  return `Gere uma procuração ad judicia e ad negotia com os seguintes dados conhecidos:

OUTORGANTE (cliente):
- Nome: ${cliente.nome}
- CPF: ${cliente.cpf ?? '[CPF não informado — use {{cpf_cliente}}]'}
- Endereço: ${cliente.endereco ?? '[Endereço não informado — use {{endereco_cliente}}]'}
- Cidade: ${cliente.cidade ?? '[use {{cidade_cliente}}]'}
- Estado: ${cliente.estado ?? '[use {{estado_cliente}}]'}

OUTORGADO (advogado):
- Nome: ${advogadoNome}
- OAB: use {{numero_oab}}/{{estado_oab}}

FINALIDADE: ${objeto ?? 'Representação judicial e extrajudicial em geral'}

Gere o template com {{variavel}} em TODOS os campos que devem ser personalizados por cliente.
O template deve ser reutilizável para outros clientes.`
}
