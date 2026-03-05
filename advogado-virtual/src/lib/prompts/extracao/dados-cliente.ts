// Prompt e tipos para extração de dados pessoais de documentos jurídicos

export interface DadosExtraidosAutor {
  nome?: string
  cpf?: string
  rg?: string
  orgao_expedidor?: string
  estado_civil?: string
  nacionalidade?: string
  profissao?: string
  endereco?: string
  bairro?: string
  cidade?: string
  estado?: string
  cep?: string
  telefone?: string
  email?: string
}

export interface DadosExtraidosReu {
  nome?: string
  cnpj_cpf?: string
  endereco?: string
  cidade?: string
  estado?: string
}

export interface DadosExtraidos {
  autor: DadosExtraidosAutor
  reu?: DadosExtraidosReu
}

export const SYSTEM_EXTRACAO = `Você é um assistente jurídico especializado em extração de dados pessoais de documentos brasileiros.
Sua tarefa é analisar documentos (CNIS, procurações, laudos, indeferimentos, cartas de concessão, etc.) e extrair dados pessoais das partes envolvidas.

REGRAS:
- Extraia APENAS dados que aparecem explicitamente nos documentos
- NÃO invente ou presuma dados que não estejam claramente presentes
- Para CPF, mantenha o formato com pontuação (xxx.xxx.xxx-xx) se disponível
- Para RG, mantenha o formato original do documento
- Se um dado não for encontrado, omita o campo (não use null ou string vazia)
- Retorne um JSON válido com a estrutura especificada`

export function buildPromptExtracao(documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>): string {
  const docsTexto = documentos
    .filter(d => d.texto_extraido?.trim())
    .map((d, i) => `--- Documento ${i + 1}: ${d.file_name} (tipo: ${d.tipo}) ---\n${d.texto_extraido}`)
    .join('\n\n')

  return `Analise os documentos abaixo e extraia os dados pessoais do AUTOR (cliente/requerente/segurado) e, se houver, do RÉU (parte contrária/requerido).

DOCUMENTOS:
${docsTexto}

Retorne um JSON com a seguinte estrutura (inclua apenas campos encontrados):
{
  "autor": {
    "nome": "Nome completo",
    "cpf": "xxx.xxx.xxx-xx",
    "rg": "número do RG",
    "orgao_expedidor": "SSP/UF",
    "estado_civil": "solteiro|casado|divorciado|viúvo|união estável",
    "nacionalidade": "brasileiro(a)",
    "profissao": "profissão",
    "endereco": "rua/av, número",
    "bairro": "bairro",
    "cidade": "cidade",
    "estado": "UF",
    "cep": "xxxxx-xxx",
    "telefone": "(xx) xxxxx-xxxx",
    "email": "email@exemplo.com"
  },
  "reu": {
    "nome": "Nome/Razão social",
    "cnpj_cpf": "número",
    "endereco": "endereço completo",
    "cidade": "cidade",
    "estado": "UF"
  }
}

Se não encontrar dados do réu, omita o campo "reu".
Retorne APENAS o JSON, sem explicações.`
}
