// Texto ORIGINAL de uma movimentação processual — FONTE ÚNICA.
//
// Consumido por (a) a timeline de acompanhamento do processo, coluna
// "Movimentação original" (o advogado precisa da íntegra, não do resumo leigo) e
// (b) o prompt que gera o resumo em linguagem simples (sync.ts / reparo.ts).
//
// Módulo PURO: sem I/O, sem Supabase, sem React — testável isoladamente.
//
// Os complementos chegam do DataJud (`complementosTabelados`) ou do DJEN e são
// gravados crus em processo_movimentos.complementos (JSONB), em dois formatos:
//   1) tabelado do DataJud: { codigo, valor, nome, descricao }
//      → `descricao` é o IDENTIFICADOR do complemento ("tipo_de_documento") e
//        `nome` é o valor tabelado ("Ofício").
//   2) objeto livre (DJEN): { tribunal, orgao, tipoComunicacao, tipoDocumento, link }
//      → cada chave é o rótulo e cada valor string é o conteúdo.
// Ambos viram pares { rótulo, valor } aqui, para não espalhar esse conhecimento.

/** Um complemento cru, como veio do tribunal. */
export type ComplementoBruto = Record<string, unknown>

/** Complemento já legível: "Tipo de documento" + "Ofício". */
export interface ComplementoPar {
  rotulo: string
  valor: string
}

/** Chaves do complemento tabelado do DataJud. */
const CHAVES_TABELADO = new Set(['codigo', 'valor', 'nome', 'descricao'])

/** No formato livre, `codigo`/`valor` são ruído técnico (índices da tabela do CNJ). */
const CHAVES_RUIDO = new Set(['codigo', 'valor'])

/** Rótulos curados dos identificadores mais comuns (acentuação correta). A chave é
 * o identificador normalizado (minúsculas, só letras e dígitos). O que não estiver
 * aqui cai no humanizador genérico. */
const ROTULOS_CURADOS: Record<string, string> = {
  tipodedocumento: 'Tipo de documento',
  tipodocumento: 'Tipo de documento',
  tipodecomunicacao: 'Tipo de comunicação',
  tipocomunicacao: 'Tipo de comunicação',
  tipodeaudiencia: 'Tipo de audiência',
  motivodaremessa: 'Motivo da remessa',
  motivodocancelamento: 'Motivo do cancelamento',
  orgao: 'Órgão',
  orgaojulgador: 'Órgão julgador',
  tribunal: 'Tribunal',
  link: 'Link',
  prazo: 'Prazo',
  destinatario: 'Destinatário',
}

const normalizarChave = (s: string): string =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()

/** Identificador de complemento tem cara de snake_case ("tipo_de_documento"). */
const ehIdentificador = (s: string): boolean => s.includes('_') && s === s.toLowerCase()

/** Texto aproveitável de um valor cru (string ou número); o resto vira ''. */
function texto(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

/** Rótulo humano a partir do identificador/chave do complemento:
 * "tipo_de_documento" → "Tipo de documento"; "tipoDocumento" → "Tipo de documento"
 * (curado); "motivo_x" → "Motivo x". Siglas em caixa alta são preservadas. */
export function humanizarRotulo(bruto: string): string {
  const curado = ROTULOS_CURADOS[normalizarChave(bruto)]
  if (curado) return curado
  const palavras = bruto
    .replace(/[_\-.]+/g, ' ')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => (p.length > 1 && p === p.toUpperCase() ? p : p.toLowerCase()))
  if (palavras.length === 0) return ''
  const [primeira, ...resto] = palavras
  return [primeira.charAt(0).toUpperCase() + primeira.slice(1), ...resto].join(' ')
}

/** Só é tabelado do DataJud quando TODAS as chaves são as conhecidas e há ao menos
 * um lado textual — senão é objeto livre (DJEN) e cada chave vira um par. */
function ehTabelado(c: ComplementoBruto): boolean {
  const chaves = Object.keys(c)
  if (chaves.length === 0) return false
  if (!chaves.every((k) => CHAVES_TABELADO.has(k))) return false
  return typeof c.nome === 'string' || typeof c.descricao === 'string'
}

function paresDoTabelado(c: ComplementoBruto): ComplementoPar[] {
  const nome = texto(c.nome)
  const descricao = texto(c.descricao)
  if (!nome && !descricao) return []
  // Só um dos lados veio: não dá para saber o rótulo — mostra o valor puro.
  if (!nome || !descricao) return [{ rotulo: '', valor: nome || descricao }]
  // Padrão: descricao = identificador, nome = valor. Alguns tribunais invertem —
  // quem tiver cara de identificador (snake_case) assume o papel de rótulo.
  if (!ehIdentificador(descricao) && ehIdentificador(nome)) {
    return [{ rotulo: humanizarRotulo(nome), valor: descricao }]
  }
  return [{ rotulo: humanizarRotulo(descricao), valor: nome }]
}

function paresDoObjetoLivre(c: ComplementoBruto): ComplementoPar[] {
  return Object.entries(c)
    .filter(([k]) => !CHAVES_RUIDO.has(k))
    .map(([k, v]) => ({ rotulo: humanizarRotulo(k), valor: texto(v) }))
    .filter((p) => p.valor !== '')
}

/** Converte os complementos crus (JSONB) em pares legíveis, tolerando formato
 * inesperado (null, string solta, objeto vazio) — nunca lança. */
export function complementosEmPares(complementos: unknown): ComplementoPar[] {
  if (!Array.isArray(complementos)) return []
  const pares: ComplementoPar[] = []
  for (const item of complementos) {
    if (typeof item === 'string') {
      const v = item.trim()
      if (v) pares.push({ rotulo: '', valor: v })
      continue
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const c = item as ComplementoBruto
    pares.push(...(ehTabelado(c) ? paresDoTabelado(c) : paresDoObjetoLivre(c)))
  }
  return pares
}

/** Complementos em uma linha: "Tipo de documento: Ofício; Prazo: 15 dias". */
export function complementosTexto(complementos: unknown): string {
  return complementosEmPares(complementos)
    .map((p) => (p.rotulo ? `${p.rotulo}: ${p.valor}` : p.valor))
    .join('; ')
}

/** Texto ORIGINAL da movimentação, do jeito que o tribunal publicou:
 * "Expedição de documento — Tipo de documento: Ofício".
 * Sem complementos, devolve só o nome técnico. */
export function formatarMovimentoOriginal(
  nome: string | null | undefined,
  complementos?: unknown,
): string {
  const base = (nome ?? '').trim()
  const comp = complementosTexto(complementos)
  if (!base) return comp
  return comp ? `${base} — ${comp}` : base
}
