// Vínculo único da tarefa do Kanban (ver migration 054).
// Uma tarefa referencia UM entre: cliente, caso (atendimento) ou processo.
// Modelo B = 3 colunas FK exclusivas. Aqui ficam só helpers PUROS (mapeamento
// tipo↔coluna, normalização e rótulos) — reusados pela rota, form e cards.

import { AREAS, type AreaId } from '@/lib/constants/areas'

export type VinculoTipo = 'cliente' | 'atendimento' | 'processo'

export interface Vinculo {
  tipo: VinculoTipo
  id: string
}

/** Coluna da tabela `tasks` que guarda cada tipo de vínculo. */
export const COLUNA_POR_TIPO: Record<VinculoTipo, 'cliente_id' | 'process_id' | 'processo_id'> = {
  cliente:     'cliente_id',
  atendimento: 'process_id', // legado 020: process_id aponta para atendimentos(id)
  processo:    'processo_id',
}

/** Tabela onde o id de cada tipo deve existir (validação de propriedade/tenant). */
export const TABELA_POR_TIPO: Record<VinculoTipo, 'clientes' | 'atendimentos' | 'processos'> = {
  cliente:     'clientes',
  atendimento: 'atendimentos',
  processo:    'processos',
}

export const ROTULO_TIPO: Record<VinculoTipo, string> = {
  cliente:     'Cliente',
  atendimento: 'Caso',
  processo:    'Processo',
}

export function ehVinculoTipo(v: unknown): v is VinculoTipo {
  return v === 'cliente' || v === 'atendimento' || v === 'processo'
}

/**
 * Converte um vínculo (ou null) nas 3 colunas: a coluna do tipo recebe o id,
 * as outras vão a null. Usado no INSERT/UPDATE para sempre manter exclusividade.
 */
export function vinculoParaColunas(
  v: Vinculo | null,
): { cliente_id: string | null; process_id: string | null; processo_id: string | null } {
  const base = { cliente_id: null, process_id: null, processo_id: null }
  if (!v) return base
  return { ...base, [COLUNA_POR_TIPO[v.tipo]]: v.id }
}

/** Extrai o vínculo único das colunas de uma task (null se nenhuma preenchida). */
export function colunasParaVinculo(row: {
  cliente_id?: string | null
  process_id?: string | null
  processo_id?: string | null
}): Vinculo | null {
  if (row.cliente_id)  return { tipo: 'cliente',     id: row.cliente_id }
  if (row.processo_id) return { tipo: 'processo',    id: row.processo_id }
  if (row.process_id)  return { tipo: 'atendimento', id: row.process_id }
  return null
}

/** Máscara CNJ a partir de 20 dígitos; devolve a entrada crua se não bater. */
export function formatarCnj(numero: string | null | undefined): string {
  const s = (numero ?? '').replace(/\D/g, '')
  if (s.length !== 20) return (numero ?? '').trim()
  return `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16, 20)}`
}

/** CPF formatado (000.000.000-00) quando tiver 11 dígitos; senão o valor cru/trim. */
export function formatarCpf(cpf: string | null | undefined): string | null {
  const s = (cpf ?? '').replace(/\D/g, '')
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9, 11)}`
  const cru = (cpf ?? '').trim()
  return cru || null
}

/** Nome amigável da área do atendimento (fallback: capitaliza o valor cru). */
export function rotularArea(area: string | null | undefined): string {
  const a = (area ?? '').trim()
  if (!a) return 'Caso'
  const conhecida = (AREAS as Record<string, { nome: string }>)[a as AreaId]
  if (conhecida) return conhecida.nome
  return a.charAt(0).toUpperCase() + a.slice(1)
}

/** Sublabel do cliente na busca: CPF formatado, senão telefone. */
export function sublabelCliente(cpf?: string | null, telefone?: string | null): string | null {
  const doc = formatarCpf(cpf)
  if (doc) return doc
  const tel = (telefone ?? '').trim()
  return tel || null
}

// ─── Resolução para exibição (chip/selo/link) ───────────────────────────────

interface RelNome { id?: string | null; nome?: string | null }
interface AtendEmbed { id?: string | null; area?: string | null; numero_processo?: string | null; clientes?: RelNome | RelNome[] | null }
interface ProcEmbed  { id?: string | null; numero_cnj?: string | null; apelido?: string | null; clientes?: RelNome | RelNome[] | null }

/** Dados embutidos que a task carrega para render (join da rota /api/tasks). */
export interface TaskVinculoData {
  cliente_id?:  string | null
  process_id?:  string | null
  processo_id?: string | null
  cliente?:      RelNome | RelNome[] | null       // via tasks.cliente_id
  atendimentos?: AtendEmbed | AtendEmbed[] | null // via tasks.process_id
  processo?:     ProcEmbed | ProcEmbed[] | null   // via tasks.processo_id
}

export interface VinculoView {
  tipo:     VinculoTipo
  id:       string
  label:    string
  sublabel: string | null
  href:     string | null
  removido: boolean // entidade sumiu (join vazio) → exibir discreto, sem link
}

function um<T>(rel: T | T[] | null | undefined): T | null {
  return (Array.isArray(rel) ? rel[0] : rel) ?? null
}

/**
 * Monta a visão de exibição do vínculo da task a partir das colunas + joins.
 * Retorna null se não houver vínculo. `removido: true` quando a coluna aponta
 * para uma entidade que não veio no join (apagada) — a UI mostra "Vínculo removido".
 */
export function resolverVinculoView(t: TaskVinculoData): VinculoView | null {
  const v = colunasParaVinculo(t)
  if (!v) return null
  const removido = (label: string): VinculoView => ({ tipo: v.tipo, id: v.id, label, sublabel: null, href: null, removido: true })

  if (v.tipo === 'cliente') {
    const c = um(t.cliente)
    if (!c?.nome) return removido('Cliente removido')
    return { tipo: 'cliente', id: v.id, label: c.nome, sublabel: null, href: `/clientes/${v.id}`, removido: false }
  }

  if (v.tipo === 'atendimento') {
    const a = um(t.atendimentos)
    if (!a) return removido('Caso removido')
    const cli = um(a.clientes)
    const numero = a.numero_processo?.trim() || null
    const sub = [cli?.nome?.trim() || null, numero].filter(Boolean).join(' · ') || null
    const href = cli?.id ? `/clientes/${cli.id}/casos/${v.id}` : null
    return { tipo: 'atendimento', id: v.id, label: rotularArea(a.area), sublabel: sub, href, removido: false }
  }

  // processo
  const p = um(t.processo)
  if (!p) return removido('Processo removido')
  const cli = um(p.clientes)
  const label = p.apelido?.trim() || formatarCnj(p.numero_cnj)
  const href = cli?.id ? `/clientes/${cli.id}` : null
  return { tipo: 'processo', id: v.id, label, sublabel: cli?.nome?.trim() || null, href, removido: false }
}
