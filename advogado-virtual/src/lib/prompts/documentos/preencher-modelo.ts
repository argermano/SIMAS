// Preenchimento de documento a partir do MODELO do escritório (um exemplo já preenchido):
// a IA segue o modelo e TROCA os dados do exemplo pelos dados do cliente/caso. Confiável —
// sem cirurgia no XML, sem depender de placeholders no arquivo.

export const SYSTEM_PREENCHER_DOCUMENTO = `
Você é um assistente jurídico. Recebeu o MODELO DE DOCUMENTO do escritório (um exemplo já
preenchido com dados de outra pessoa) e os DADOS DO CLIENTE/CASO para gerar um novo documento.

REGRAS OBRIGATÓRIAS:
1. SIGA O MODELO EXATAMENTE — mesma estrutura, redação, cláusulas, ordem e formatação.
2. NÃO invente, NÃO remova e NÃO reescreva o texto do modelo. Apenas TROQUE os dados do
   exemplo (nome, CPF, RG, endereço, estado civil, profissão, valores, nº de processo, datas)
   pelos DADOS DO CLIENTE fornecidos abaixo.
3. MANTENHA os dados do ESCRITÓRIO/ADVOGADO que já constam no modelo (NÃO os troque pelos do cliente).
4. Se algum dado do cliente NÃO foi fornecido, use [PREENCHER: nome_do_campo] no lugar.
5. Atualize a data para a data atual informada.
6. Os DADOS DO CASO informados (ex.: renda mensal, número de dependentes, objeto/finalidade)
   DEVEM constar no documento final. Se o modelo já tiver um campo equivalente, use o valor
   informado; se NÃO houver, incorpore a informação de forma natural e juridicamente adequada
   no ponto pertinente (ex.: na declaração de hipossuficiência, informe a renda mensal e o número
   de dependentes como fundamento da hipossuficiência), sem alterar o restante do texto.
7. Responda APENAS com o documento final em Markdown, sem comentários nem explicações.
`.trim()

interface DadosCliente {
  nome?: string | null
  cpf?: string | null
  rg?: string | null
  orgao_expedidor?: string | null
  estado_civil?: string | null
  nacionalidade?: string | null
  profissao?: string | null
  endereco?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  telefone?: string | null
  email?: string | null
}

const ROTULO_EXTRA: Record<string, string> = {
  objeto: 'Finalidade/objeto',
  renda_mensal: 'Renda mensal',
  numero_dependentes: 'Número de dependentes',
  nome_substabelecido: 'Advogado substabelecido (nome)',
  oab_substabelecido: 'Advogado substabelecido (OAB)',
  objeto_notificacao: 'Objeto da notificação',
  prazo_resposta: 'Prazo (dias)',
}

export function buildPromptPreencherDocumento(opts: {
  modelo: string
  cliente: DadosCliente
  dataExtenso: string
  extras?: Record<string, string | undefined> | null
}): string {
  const { modelo, cliente, dataExtenso, extras } = opts

  const dadosCliente = [
    cliente.nome && `Nome: ${cliente.nome}`,
    cliente.nacionalidade && `Nacionalidade: ${cliente.nacionalidade}`,
    cliente.estado_civil && `Estado civil: ${cliente.estado_civil}`,
    cliente.profissao && `Profissão: ${cliente.profissao}`,
    cliente.cpf && `CPF: ${cliente.cpf}`,
    cliente.rg && `RG: ${cliente.rg}${cliente.orgao_expedidor ? ` ${cliente.orgao_expedidor}` : ''}`,
    cliente.endereco && `Endereço: ${cliente.endereco}${cliente.bairro ? `, ${cliente.bairro}` : ''}`,
    (cliente.cidade || cliente.estado) && `Cidade/UF: ${cliente.cidade ?? ''}${cliente.estado ? `/${cliente.estado}` : ''}`,
    cliente.cep && `CEP: ${cliente.cep}`,
    cliente.telefone && `Telefone: ${cliente.telefone}`,
    cliente.email && `E-mail: ${cliente.email}`,
  ].filter(Boolean).join('\n')

  const dadosExtras = extras
    ? Object.entries(extras)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${ROTULO_EXTRA[k] ?? k}: ${v}`)
        .join('\n')
    : ''

  return `## MODELO DO ESCRITÓRIO (siga EXATAMENTE; troque apenas os dados do exemplo pelos do cliente)

${modelo.substring(0, 8000)}

---

## DADOS DO CLIENTE (use estes no lugar dos dados de exemplo do modelo)
${dadosCliente || '[sem dados de cliente informados]'}
${dadosExtras ? `\n## DADOS DO CASO\n${dadosExtras}` : ''}

Data atual (use para a data do documento): ${dataExtenso}

---

Gere o documento final em Markdown: idêntico ao modelo em estrutura e redação, porém com os
DADOS DO CLIENTE acima no lugar dos dados de exemplo. Mantenha os dados do escritório/advogado
que já estão no modelo. Os DADOS DO CASO informados (renda, dependentes, objeto etc.) DEVEM
aparecer no documento — incorpore-os de forma natural caso o modelo não tenha campo próprio.
NÃO deixe [PREENCHER] para dados que foram fornecidos acima.`
}
