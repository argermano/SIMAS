// Classificador CONTEXTUAL da ação de uma tarefa do Kanban ("Resolver").
//
// Dado o TÍTULO (tasks.description — as tarefas usam a descrição como título) de
// uma tarefa de escritório, decide QUE trabalho ela representa e para ONDE o
// botão "Resolver" deve levar o advogado. Módulo PURO (sem SDK/DB): só regex das
// famílias reais + montagem de URL — testável e reusável pelo card (cliente) e
// pela rota /api/tasks/[id]/acao (servidor).
//
// Famílias derivadas dos exports reais do Astrea:
//   - peça:        ~metade das tarefas ("PARTE x PARTE: APELAÇÃO/CONTRARRAZÕES/
//                  E.D./EMENDA/MANIFESTAR. PUB dd/mm") — a força do SIMAS.
//   - agendamento: ~1/4 ("AGENDAR X", "LIGAÇÃO COM Y").
//   - documento:   ~15% ("JUNTAR COMPROVANTES", "ESCANEAR RG").
//   - processo:    resto (atos/verificações: "RETIRAR RPV", "CONFERIR SE...").
//
// PRECEDÊNCIA (agendamento → peça → documento → processo): os títulos reais
// raramente colidem (peça = substantivo do tipo de peça, sem verbo de contato/
// arquivo; os demais são imperativos sem substantivo de peça). Quando um verbo
// processual (PROTOCOLAR/RETIRAR...) coincide com um substantivo de peça,
// favorecemos 'peca' — a proposta de valor do SIMAS é abrir o motor de peças.

import { AREAS } from '@/lib/constants/areas'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'

export type AcaoTarefa = 'peca' | 'agendamento' | 'documento' | 'processo' | 'indefinido'
export type AcaoConcreta = Exclude<AcaoTarefa, 'indefinido'>

/** Rótulo + ícone (nome lucide) por ação — fonte única do texto do botão. */
export const ACAO_META: Record<AcaoConcreta, { rotulo: string; icone: string }> = {
  peca:        { rotulo: 'Gerar peça',     icone: 'file-pen' },
  agendamento: { rotulo: 'Agendar',        icone: 'calendar-plus' },
  documento:   { rotulo: 'Abrir dossiê',   icone: 'folder-open' },
  processo:    { rotulo: 'Abrir processo', icone: 'scale' },
}

/** minúsculas + sem acentos (comparação insensível a caixa/acento). */
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// ── Regex das famílias (sobre texto normalizado, sem acento) ────────────────
// "e.d." (embargos de declaração): exige boundary ANTES do "e" e que nada de
// letra siga o token (\be\.\s*d\.?(?![a-z])). Sem o boundary, um título como
// "VER CLIENTE. DIGITALIZAR RG" casava "cliente. d…" e virava peça por engano.
const RE_AGENDAMENTO =
  /\b(agendar|agende|agendamento|agenda|ligacao|ligar|ligue|reuniao|atendimento|contato|contatar|entrevista)\b/
// Inclui as peças de execução/cumprimento (caso real do dono: "Protocolar
// requerimento de cumprimento de sentença…"): cumprimento, requerimento e
// impugnação (ao cumprimento) são peças — abrem o motor, não o processo.
const RE_PECA =
  /\b(apelacao|contrarrazoes|contra-?razoes|embargos|recurso|contestacao|impugnacao|impugnar|manifestar|manifestacao|manifestacoes|emenda|emendar|alegacoes|inicial|peticao|requerimento|replica|treplica|tutela|cumprimento|agravo|habeas)\b|\be\.\s*d\.?(?![a-z])/
const RE_DOCUMENTO =
  /\b(juntar|juntada|juntado|escanear|escaneie|digitalizar|digitalize|documentacao|documento|documentos|comprovante|comprovantes|anexar|anexe|anexo)\b/
const RE_PROCESSO =
  /\b(retirar|retire|conferir|confira|verificar|verifique|protocolar|protocole|protocolo|acompanhar|acompanhamento|acompanhe|diligenciar|diligencia|diligencie)\b/

/**
 * Classifica o título em uma das 4 famílias (ou 'indefinido' quando nada casa —
 * a rota decide se aciona a IA). Puro e determinístico.
 */
export function classificarAcaoTarefa(titulo: string): AcaoTarefa {
  const t = norm(titulo)
  if (!t.trim()) return 'indefinido'
  if (RE_AGENDAMENTO.test(t)) return 'agendamento'
  if (RE_PECA.test(t)) return 'peca'
  if (RE_DOCUMENTO.test(t)) return 'documento'
  if (RE_PROCESSO.test(t)) return 'processo'
  return 'indefinido'
}

// ── Detecção do TIPO de peça (para abrir o motor no tipo certo) ─────────────
// Ordem: mais específico primeiro (recurso especial antes de "recurso").
const MAPA_TIPO_PECA: Array<[RegExp, string]> = [
  [/contrarrazoes|contra-?razoes/, 'contrarrazoes'],
  [/recurso\s+especial|\bresp\b/,  'recurso_especial'],
  [/recurso\s+de\s+revista|revista/, 'recurso_revista'],
  [/recurso\s+ordinario/,          'recurso_ordinario'],
  [/apelacao/,                     'apelacao'],
  [/agravo/,                       'agravo'],
  [/embargos|\be\.\s*d\.?(?![a-z])/, 'embargos'],
  // réplica/tréplica antes de contestação: uma réplica cita a contestação, mas
  // uma contestação nunca cita a réplica — o mais específico ganha.
  [/treplica/,                     'replica'],
  [/replica/,                      'replica'],
  [/contestacao/,                  'contestacao'],
  [/alegacoes\s+finais|alegacoes/, 'alegacoes_finais'],
  [/mandado\s+de\s+seguranca/,     'mandado_seguranca'],
  [/habeas/,                       'habeas_corpus'],
  [/resposta\s+a\s+acusacao/,      'resposta_acusacao'],
  [/tutela/,                       'tutela'],
  [/cumprimento/,                  'cumprimento'],
  [/peticao\s+inicial|\binicial\b/, 'peticao_inicial'],
]

/** Devolve o id de TIPOS_PECA sugerido pelo título, ou null se não reconhecer. */
export function detectarTipoPeca(titulo: string): string | null {
  const t = norm(titulo)
  for (const [re, tipo] of MAPA_TIPO_PECA) {
    if (re.test(t)) return tipo
  }
  return null
}

/** Nome (3..80) para o slug "outra" quando o tipo detectado não serve à área. */
function rotuloPecaParaOutra(titulo: string, tipo: string | null): string {
  if (tipo && TIPOS_PECA[tipo]) return TIPOS_PECA[tipo].nome
  let s = (titulo ?? '').trim()
  const idx = s.lastIndexOf(':') // "PARTE x PARTE: <peça>" → fica só a peça
  if (idx >= 0 && idx < s.length - 1) s = s.slice(idx + 1).trim()
  s = s.replace(/\bpub\.?\b.*$/i, '').trim() // remove referência "PUB dd/mm"
  s = s.replace(/[.\s]+$/, '').trim()
  if (s.length < 3) return 'Peça'
  return s.slice(0, 80).trim()
}

/**
 * Resolve o alvo do motor de peças para (título, área): usa o tipo detectado
 * quando ele pertence à área; senão cai no slug "outra" com um nome legível.
 */
export function resolverPecaAlvo(titulo: string, area: string): { tipoPeca: string; nome: string | null } {
  const conf = (AREAS as Record<string, { pecas?: readonly string[] } | undefined>)[area]
  const pecas = conf?.pecas ?? []
  const tipo = detectarTipoPeca(titulo)
  if (tipo && pecas.includes(tipo)) return { tipoPeca: tipo, nome: null }
  return { tipoPeca: 'outra', nome: rotuloPecaParaOutra(titulo, tipo) }
}

// ── Montagem do alvo (URL) ──────────────────────────────────────────────────

/** Contexto mínimo para montar o alvo — derivado do vínculo da tarefa. */
export interface AlvoContexto {
  titulo: string
  /** Vencimento (ISO ou YYYY-MM-DD) — só usado p/ pré-preencher a data na agenda. */
  dueDate: string | null
  atendimentoId: string | null
  /** Área do atendimento vinculado (chave de AREAS) — necessária p/ o motor de peças. */
  area: string | null
  clienteId: string | null
  clienteNome: string | null
  processoId: string | null
}

/** Extrai só o dia (YYYY-MM-DD) de uma data ISO/parcial; null se não houver. */
function diaYMD(v: string | null | undefined): string | null {
  if (!v) return null
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/**
 * Monta a URL de destino do "Resolver" para a ação já resolvida. Retorna null
 * quando falta o dado essencial (ex.: peça sem atendimento nem cliente) — a UI
 * mostra o botão desabilitado com uma dica.
 */
export function construirHref(acao: AcaoConcreta, ctx: AlvoContexto): string | null {
  switch (acao) {
    case 'peca': {
      // Motor de peças DAQUELE atendimento: /{area}/pecas/{tipoPeca}?id={atId}
      if (ctx.atendimentoId && ctx.area && (AREAS as Record<string, unknown>)[ctx.area]) {
        const { tipoPeca, nome } = resolverPecaAlvo(ctx.titulo, ctx.area)
        const qs = new URLSearchParams({ id: ctx.atendimentoId })
        if (nome) qs.set('nome', nome)
        return `/${ctx.area}/pecas/${tipoPeca}?${qs.toString()}`
      }
      // Sem caso (atendimento+área) NÃO há alvo de peça: o motor precisa do caso.
      // Em vez de um atalho morto ao dossiê, a UI mostra o ASSISTENTE DE VÍNCULO
      // (modal) ou o indicador de elo (card). Ver pecaSemCaso() + rota /acao.
      return null
    }
    case 'agendamento': {
      // Receptor /agenda?novo=1 (+ prefill): título, data (=vencimento) e cliente.
      const qs = new URLSearchParams({ novo: '1' })
      const titulo = (ctx.titulo ?? '').trim()
      if (titulo) qs.set('titulo', titulo.slice(0, 200))
      const dia = diaYMD(ctx.dueDate)
      if (dia) qs.set('data', dia)
      if (ctx.clienteId) qs.set('clienteId', ctx.clienteId)
      if (ctx.clienteNome) qs.set('clienteNome', ctx.clienteNome.slice(0, 120))
      return `/agenda?${qs.toString()}`
    }
    case 'documento':
      // Dossiê do cliente do vínculo.
      return ctx.clienteId ? `/clientes/${ctx.clienteId}` : null
    case 'processo':
      // Tela do processo vinculado (convenção do app: página do cliente).
      return ctx.clienteId ? `/clientes/${ctx.clienteId}` : null
  }
}

/**
 * Peça cujo motor NÃO abre direto porque falta o CASO (atendimento + área): não
 * há como pré-montar a URL do motor de peças. Sinaliza que a UI deve oferecer o
 * assistente de vínculo (modal) / o indicador de elo (card) em vez de um atalho
 * morto. Só faz sentido quando a ação já é 'peca'.
 */
export function pecaSemCaso(ctx: AlvoContexto): boolean {
  return !(ctx.atendimentoId && ctx.area && !!(AREAS as Record<string, unknown>)[ctx.area])
}

// ── Adaptação do vínculo da tarefa → AlvoContexto ───────────────────────────

interface Rel { id?: string | null; nome?: string | null }
interface AtendEmbed extends Rel { area?: string | null; clientes?: Rel | Rel[] | null }
interface ProcEmbed extends Rel { clientes?: Rel | Rel[] | null }

/** Campos do vínculo que a tarefa carrega (join da rota /api/tasks ou do card). */
export interface TaskAlvoInput {
  description?: string | null
  due_date?: string | null
  cliente_id?: string | null
  process_id?: string | null   // legado: aponta p/ atendimentos(id)
  processo_id?: string | null
  atendimentos?: AtendEmbed | AtendEmbed[] | null
  cliente?: Rel | Rel[] | null
  processo?: ProcEmbed | ProcEmbed[] | null
}

function um<T>(rel: T | T[] | null | undefined): T | null {
  return (Array.isArray(rel) ? rel[0] : rel) ?? null
}

/**
 * Deriva o AlvoContexto a partir do vínculo único da tarefa (cliente | caso |
 * processo) + seus joins. O cliente é resolvido pela ordem: vínculo direto →
 * cliente do atendimento → cliente do processo.
 */
export function contextoAlvoDaTask(t: TaskAlvoInput): AlvoContexto {
  const at = um(t.atendimentos)
  const proc = um(t.processo)
  const cliDireto = um(t.cliente)
  const cliAt = um(at?.clientes)
  const cliProc = um(proc?.clientes)

  const atendimentoId = t.process_id ?? at?.id ?? null
  const area = at?.area ?? null

  let clienteId: string | null = null
  let clienteNome: string | null = null
  if (t.cliente_id) {
    clienteId = t.cliente_id
    clienteNome = cliDireto?.nome ?? null
  } else if (cliAt?.id) {
    clienteId = cliAt.id
    clienteNome = cliAt.nome ?? null
  } else if (cliProc?.id) {
    clienteId = cliProc.id
    clienteNome = cliProc.nome ?? null
  }

  return {
    titulo: t.description ?? '',
    dueDate: t.due_date ?? null,
    atendimentoId,
    area,
    clienteId,
    clienteNome,
    processoId: t.processo_id ?? proc?.id ?? null,
  }
}

/**
 * Título "não-trivial" o bastante para valer uma chamada de IA quando a regex
 * não decidiu (≥ 8 chars alfanuméricos e ≥ 2 palavras). Evita gastar cota com
 * títulos vazios/de uma palavra.
 */
export function tituloNaoTrivial(titulo: string): boolean {
  const t = norm(titulo).replace(/[^a-z0-9]+/g, ' ').trim()
  return t.length >= 8 && t.split(/\s+/).filter(Boolean).length >= 2
}
