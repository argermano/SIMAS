import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { decryptClienteFields } from '@/lib/encryption'
import { ehVinculoTipo, formatarCnj, rotularArea, sublabelCliente, type VinculoTipo } from '@/lib/tarefas/vinculo'

/**
 * GET /api/tarefas/vinculos?q=...&tipos=atendimento,processo
 * Busca unificada para o campo "Cliente, caso ou processo" da tarefa do Kanban.
 * Mistura até ~8 resultados dos 3 tipos, escopo do tenant. q < 2 chars → [].
 *   cliente     → label=nome,                     sublabel=CPF/telefone
 *   atendimento → label=área,                     sublabel=cliente (· nº processo)
 *   processo    → label=apelido/nº CNJ,           sublabel=cliente
 * ?tipos= (opcional) restringe quais tipos buscar (CSV). Ausente = os 3 (legado).
 *
 * ?clienteId= (opcional) → modo "casos daquele cliente": devolve os atendimentos
 * do cliente (ignora os outros tipos), SEM exigir q. Alimenta o assistente de
 * vínculo (peça sem caso), que prioriza os casos do cliente da tarefa.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Resultado {
  tipo:     VinculoTipo
  id:       string
  label:    string
  sublabel: string | null
}

const POR_TIPO = 4 // teto por tipo antes de intercalar

// Embeds to-one podem vir como objeto ou array — normaliza para o primeiro.
function umNome(rel: unknown): string | null {
  const r = Array.isArray(rel) ? rel[0] : rel
  const nome = (r as { nome?: string } | null)?.nome
  return nome ? nome.trim() : null
}

// Intercala as 3 listas (round-robin) para garantir mistura dos tipos.
function intercalar(...listas: Resultado[][]): Resultado[] {
  const out: Resultado[] = []
  const max = Math.max(0, ...listas.map((l) => l.length))
  for (let i = 0; i < max; i++) {
    for (const l of listas) if (l[i]) out.push(l[i])
  }
  return out
}

export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const sp = new URL(req.url).searchParams
  const q = (sp.get('q') ?? '').trim()

  // ── Modo "casos do cliente" (assistente de vínculo) ──────────────────────
  // clienteId válido → devolve os atendimentos daquele cliente (não exige q).
  // Se q vier junto (≥2), filtra por área/nº/título. Isola do fluxo legado.
  const clienteId = (sp.get('clienteId') ?? '').trim()
  if (clienteId) {
    if (!UUID_RE.test(clienteId)) return NextResponse.json({ resultados: [] })
    let query = supabase
      .from('atendimentos')
      .select('id, area, numero_processo, titulo')
      .eq('tenant_id', usuario.tenant_id)
      .eq('cliente_id', clienteId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(8)
    if (q.length >= 2) {
      const likeQ = `%${q}%`
      query = query.or(`area.ilike.${likeQ},numero_processo.ilike.${likeQ},titulo.ilike.${likeQ}`)
    }
    const { data } = await query
    const resultados: Resultado[] = (data ?? []).map((a) => {
      const titulo = (a as { titulo?: string | null }).titulo?.trim() || null
      const numero = (a as { numero_processo?: string | null }).numero_processo?.trim() || null
      const area = rotularArea((a as { area?: string }).area)
      return {
        tipo: 'atendimento' as const,
        id: a.id as string,
        label: titulo || area,
        sublabel: [titulo ? area : null, numero].filter(Boolean).join(' · ') || null,
      }
    })
    return NextResponse.json({ resultados })
  }

  if (q.length < 2) return NextResponse.json({ resultados: [] })

  // ?tipos= restringe a busca (CSV). Vazio/ausente = os 3 tipos (comportamento legado).
  const pedidos = (sp.get('tipos') ?? '').split(',').map((s) => s.trim()).filter(ehVinculoTipo)
  const tipos = new Set<VinculoTipo>(pedidos.length ? pedidos : ['cliente', 'atendimento', 'processo'])

  const tenantId = usuario.tenant_id
  const like = `%${q}%`
  const digitos = q.replace(/\D/g, '')

  // ── Clientes (por nome) ──────────────────────────────────────────────
  const pCliente = supabase
    .from('clientes')
    .select('id, nome, cpf, telefone')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .neq('status_cadastro', 'pre_cadastro')
    .ilike('nome', like)
    .order('nome', { ascending: true })
    .limit(POR_TIPO)

  // ── Atendimentos / casos (por área ou nº do processo) ────────────────
  const pAtend = supabase
    .from('atendimentos')
    .select('id, area, numero_processo, clientes:cliente_id ( id, nome )')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .or(`area.ilike.${like},numero_processo.ilike.${like}`)
    .order('created_at', { ascending: false })
    .limit(POR_TIPO)

  // ── Processos / Fase 5 (por nº CNJ ou apelido) ───────────────────────
  const orProcesso = digitos.length >= 2
    ? `numero_cnj.ilike.%${digitos}%,apelido.ilike.${like}`
    : `apelido.ilike.${like}`
  const pProc = supabase
    .from('processos')
    .select('id, numero_cnj, apelido, clientes:cliente_id ( id, nome )')
    .eq('tenant_id', tenantId)
    .or(orProcesso)
    .order('created_at', { ascending: false })
    .limit(POR_TIPO)

  // Só dispara a query dos tipos pedidos; os demais viram lista vazia.
  const vazio = Promise.resolve({ data: [] as never[] })
  const [rCliente, rAtend, rProc] = await Promise.all([
    tipos.has('cliente')     ? pCliente : vazio,
    tipos.has('atendimento') ? pAtend   : vazio,
    tipos.has('processo')    ? pProc    : vazio,
  ])

  const clientes: Resultado[] = (rCliente.data ?? []).map((c) => {
    const dec = decryptClienteFields(c as Record<string, unknown>) as { cpf?: string | null; telefone?: string | null }
    return {
      tipo: 'cliente' as const,
      id: c.id as string,
      label: (c.nome as string) ?? 'Cliente',
      sublabel: sublabelCliente(dec.cpf, dec.telefone),
    }
  })

  const atendimentos: Resultado[] = (rAtend.data ?? []).map((a) => {
    const nome = umNome((a as { clientes?: unknown }).clientes)
    const numero = (a as { numero_processo?: string | null }).numero_processo?.trim() || null
    const sub = [nome, numero].filter(Boolean).join(' · ') || null
    return {
      tipo: 'atendimento' as const,
      id: a.id as string,
      label: rotularArea((a as { area?: string }).area),
      sublabel: sub,
    }
  })

  const processos: Resultado[] = (rProc.data ?? []).map((p) => {
    const numeroFmt = formatarCnj((p as { numero_cnj?: string }).numero_cnj)
    const apelido = (p as { apelido?: string | null }).apelido?.trim()
    return {
      tipo: 'processo' as const,
      id: p.id as string,
      label: apelido || numeroFmt,
      sublabel: umNome((p as { clientes?: unknown }).clientes),
    }
  })

  const resultados = intercalar(clientes, atendimentos, processos).slice(0, 8)
  return NextResponse.json({ resultados })
}
