import { completionJSON } from '@/lib/anthropic/client'

export interface ParDetectado {
  find: string
  replace: string
}

const SYSTEM =
  'Você transforma documentos jurídicos JÁ PREENCHIDOS (com dados de exemplo) em MODELOS ' +
  'reutilizáveis: identifica os trechos VARIÁVEIS (que mudam a cada cliente/caso) e mapeia ' +
  'cada um ao placeholder correspondente. Responde APENAS em JSON.'

const LISTA_PLACEHOLDERS = `Placeholders disponíveis (use exatamente estes nomes):
- Cliente: {{nome_cliente}}, {{nacionalidade_cliente}}, {{estado_civil_cliente}}, {{profissao_cliente}}, {{cpf_cliente}}, {{rg_cliente}}, {{orgao_expedidor_cliente}}, {{endereco_cliente}}, {{bairro_cliente}}, {{cidade_cliente}}, {{estado_cliente}}, {{cep_cliente}}, {{telefone_cliente}}, {{email_cliente}}
- Escritório/advogado: {{escritorio}}, {{cnpj_escritorio}}, {{nome_advogado}}, {{oab}}, {{cpf_advogado}}, {{rg_advogado}}, {{orgao_expedidor_advogado}}, {{estado_civil_advogado}}, {{nacionalidade_advogado}}, {{endereco_escritorio}}, {{cidade_escritorio}}, {{estado_escritorio}}, {{email_advogado}}, {{telefone_advogado}}
- Geral: {{data}} (data por extenso), {{cidade}}
- Caso (digitado ao gerar): {{objeto}} (finalidade/objeto), {{renda_mensal}}, {{numero_dependentes}}, {{nome_substabelecido}}, {{oab_substabelecido}}`

/**
 * Pede à IA para mapear os valores variáveis do documento (texto extraído) a placeholders.
 * Retorna apenas pares cujo `find` realmente existe no texto e cujo `replace` é um placeholder
 * válido — protege contra alucinação (substituição só ocorre se o trecho for encontrado).
 */
export async function detectarPlaceholders(texto: string, tipoNome: string): Promise<ParDetectado[]> {
  const prompt = `Documento do tipo "${tipoNome}", preenchido com dados de exemplo. Texto:

"""
${texto}
"""

${LISTA_PLACEHOLDERS}

Tarefa: liste os trechos VARIÁVEIS do texto (dados do cliente, do caso/finalidade, data, local do fecho) e mapeie cada um ao placeholder correspondente.

Regras OBRIGATÓRIAS:
- "find" deve ser uma cópia EXATA e contígua de um trecho do texto acima (mesma grafia, acentos e pontuação), para poder ser localizado e substituído.
- Prefira o MAIOR trecho coerente por valor (nome completo, endereço completo, número do processo etc.).
- NÃO inclua texto fixo/boilerplate (artigos de lei, enumeração de poderes, frases-padrão).
- Dados do escritório/advogado: mapeie aos placeholders de escritório apenas se tiver certeza; na dúvida, ignore (ficam fixos no modelo).
- Finalidade/objeto específico do caso → {{objeto}}. Data → {{data}}. Local do fecho (cidade) → {{cidade}}.
- Não invente trechos que não aparecem no texto.

Responda no formato: {"pares":[{"find":"<trecho exato>","replace":"{{placeholder}}"}]}`

  const { result } = await completionJSON<{ pares?: ParDetectado[] }>({ system: SYSTEM, prompt })

  const pares = Array.isArray(result?.pares) ? result.pares : []
  // Sanitização: só aceita pares localizáveis e com placeholder válido
  const vistos = new Set<string>()
  return pares
    .filter((p): p is ParDetectado =>
      !!p &&
      typeof p.find === 'string' &&
      typeof p.replace === 'string' &&
      p.find.trim().length >= 2 &&
      /^\{\{[a-z_]+\}\}$/.test(p.replace.trim()) &&
      texto.includes(p.find),
    )
    .map((p) => ({ find: p.find, replace: p.replace.trim() }))
    .filter((p) => {
      if (vistos.has(p.find)) return false
      vistos.add(p.find)
      return true
    })
}
