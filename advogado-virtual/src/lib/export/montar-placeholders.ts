// Fonte ÚNICA do mapeamento de dados → placeholders {{campo}} usada por TODOS os
// documentos preenchidos a partir de modelo .docx (contratos, procurações, declarações,
// substabelecimentos). Centralizar aqui garante que uma correção vale para todos os pontos.

export function formatarMoeda(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return Number.isNaN(n) ? String(v) : n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
}

export function formatarOAB(numero: unknown, estado: unknown): string {
  const n = numero != null && numero !== '' ? String(numero) : ''
  if (!n) return ''
  const e = estado != null && estado !== '' ? `/${estado}` : ''
  return `${n}${e}`
}

export function dataPorExtenso(d: Date): string {
  return d.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  })
}

export interface MontarPlaceholdersOpts {
  /** Linha de `tenants` com os campos profissionais do escritório */
  tenant?: Record<string, unknown> | null
  /** Linha de `clientes` JÁ DECIFRADA (passe por decryptClienteFields antes) */
  cliente?: Record<string, unknown> | null
  /** Dados do contrato (titulo, area, valor_fixo, percentual_exito, forma_pagamento) */
  contrato?: Record<string, unknown> | null
  /** camposExtras livres (objeto, renda_mensal, nome_substabelecido, ...) — sobrescrevem o resto */
  extras?: Record<string, string | undefined | null> | null
  /** Data de referência (injetável para testes) */
  hoje?: Date
}

/**
 * Monta o dicionário de placeholders a partir de cliente + escritório (+ contrato/extras).
 * Emite um SUPERSET de nomes (ex.: `oab` e `numero_oab`/`estado_oab`; `data` e `data_extenso`)
 * para que qualquer convenção que o advogado use no seu .docx seja preenchida.
 * Campos sem valor saem como string vazia.
 */
export function montarPlaceholders(opts: MontarPlaceholdersOpts): Record<string, string> {
  const cli = (opts.cliente ?? {}) as Record<string, unknown>
  const t = (opts.tenant ?? {}) as Record<string, unknown>
  const ctr = (opts.contrato ?? {}) as Record<string, unknown>
  const hoje = opts.hoje ?? new Date()

  const s = (v: unknown): string => (v == null ? '' : String(v))
  const data = dataPorExtenso(hoje)

  const dados: Record<string, string> = {
    // Cliente
    nome_cliente: s(cli.nome),
    nacionalidade_cliente: s(cli.nacionalidade),
    estado_civil_cliente: s(cli.estado_civil),
    profissao_cliente: s(cli.profissao),
    cpf_cliente: s(cli.cpf),
    rg_cliente: s(cli.rg),
    orgao_expedidor_cliente: s(cli.orgao_expedidor),
    endereco_cliente: s(cli.endereco),
    bairro_cliente: s(cli.bairro),
    cidade_cliente: s(cli.cidade),
    estado_cliente: s(cli.estado),
    cep_cliente: s(cli.cep),
    telefone_cliente: s(cli.telefone),
    email_cliente: s(cli.email),

    // Advogado / escritório
    escritorio: s(t.nome),
    cnpj_escritorio: s(t.cnpj),
    nome_advogado: s(t.nome_responsavel),
    oab: formatarOAB(t.oab_numero, t.oab_estado), // combinado "12345/SP"
    numero_oab: s(t.oab_numero),                  // aliases (convenção dos modelos gerados)
    estado_oab: s(t.oab_estado),
    cpf_advogado: s(t.cpf_responsavel),
    rg_advogado: s(t.rg_responsavel),
    orgao_expedidor_advogado: s(t.orgao_expedidor),
    estado_civil_advogado: s(t.estado_civil),
    nacionalidade_advogado: s(t.nacionalidade),
    endereco_escritorio: s(t.endereco),
    cidade_escritorio: s(t.cidade),
    estado_escritorio: s(t.estado),
    email_advogado: s(t.email_profissional),
    telefone_advogado: s(t.telefone),

    // Geral
    data,
    data_extenso: data,                  // alias
    cidade: s(cli.cidade) || s(t.cidade), // cidade do fecho
  }

  // Contrato (quando aplicável)
  if (opts.contrato) {
    dados.titulo = s(ctr.titulo)
    dados.area = s(ctr.area)
    dados.valor_fixo = formatarMoeda(ctr.valor_fixo)
    dados.percentual_exito =
      ctr.percentual_exito != null && ctr.percentual_exito !== '' ? `${ctr.percentual_exito}%` : ''
    dados.forma_pagamento = s(ctr.forma_pagamento)
  }

  // Extras (camposExtras) — sobrescrevem; ignora vazios para não apagar o base
  if (opts.extras) {
    for (const [k, v] of Object.entries(opts.extras)) {
      if (v != null && v !== '') dados[k] = String(v)
    }
  }

  return dados
}
