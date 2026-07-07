// Fase 5 (complemento) — publicações do DJEN (Diário de Justiça Eletrônico
// Nacional) via API Comunica do CNJ. Diferente do DataJud (movimentos em lote,
// dias de atraso, sem texto), o DJEN entrega em D+1 o INTEIRO TEOR dos atos
// publicados (sentenças, decisões, intimações) e permite cobrir a carteira
// inteira com 1 consulta diária por OAB (cross-tribunal), em vez de 1 consulta
// por processo. API pública, sem chave; rate ~20 req/min/IP.
//
// Fluxo (cron diário): consulta por OAB → casa numero_processo com processos
// cadastrados → insere como processo_movimentos (íntegra em raw, dedup por id
// da comunicação) → resumo IA a partir do texto real → aviso segue o MESMO
// regime do sync (fila/automático por cliente, categorias do tenant, claim
// atômico). PRIMEIRA execução por tenant = backfill silencioso (nunca notifica
// retroativo). Ver memória fase-5 e docs/PLANO-FASE-5-OPUS.md.

import type { SupabaseClient } from '@supabase/supabase-js'
import { classificarMovimento, categoriasNotificaveis, type CategoriaMovimento } from './categorias'
import { hashMovimento } from './sync'
import { montarTextoAviso, enviarAvisoWhatsApp } from './notificar'
import { completionJSON } from '@/lib/anthropic/client'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

type Admin = SupabaseClient

const DJEN_BASE = process.env.DJEN_BASE ?? 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const BACKFILL_DIAS = 30
const RATE_DELAY_MS = 3200 // ~20 req/min por IP

/* ── helpers puros (testáveis) ─────────────────────────────────────────── */

/** Remove tags/entidades HTML do texto da comunicação (para resumo/классificação). */
export function extrairTextoPlano(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>(\s)*/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface ItemDjen {
  id: number
  numero: string // só dígitos (20)
  tribunal: string
  tipoComunicacao: string
  tipoDocumento: string
  orgao: string
  data: string // YYYY-MM-DD (disponibilização)
  textoPlano: string
  link: string | null
  raw: Record<string, unknown>
}

/** Parse defensivo de um item da API Comunica (shape verificado em produção). */
export function parseItemDjen(raw: Record<string, unknown>): ItemDjen | null {
  const id = Number(raw.id)
  const numero = String(raw.numero_processo ?? raw.numeroprocessocommascara ?? '').replace(/\D/g, '')
  const data = String(raw.data_disponibilizacao ?? raw.datadisponibilizacao ?? '').slice(0, 10)
  if (!id || numero.length !== 20 || !data) return null
  return {
    id,
    numero,
    tribunal: String(raw.siglaTribunal ?? ''),
    tipoComunicacao: String(raw.tipoComunicacao ?? ''),
    tipoDocumento: String(raw.tipoDocumento ?? ''),
    orgao: String(raw.nomeOrgao ?? ''),
    data,
    textoPlano: extrairTextoPlano(raw.texto as string),
    link: (raw.link as string) || null,
    raw,
  }
}

/** Classifica a publicação pela substância (tipo + texto) — assim a intimação de
 * uma juntada cai em movimentacao_comum (não notifica) e a de uma sentença cai em
 * 'sentenca' (notifica). Fallback: 'publicacao'. */
export function classificarPublicacao(item: Pick<ItemDjen, 'tipoDocumento' | 'textoPlano'>): CategoriaMovimento {
  return (
    classificarMovimento({ nome: `${item.tipoDocumento}. ${item.textoPlano.slice(0, 400)}` }) ?? 'publicacao'
  )
}

/** Janela de consulta por tenant. Sem marca d'água (1ª vez) = backfill silencioso
 * dos últimos BACKFILL_DIAS. Depois, da última consulta -1 dia (overlap; o dedup
 * absorve repetidos) até hoje. */
export function janelaConsultaDjen(
  config: unknown,
  hojeISO: string,
): { inicio: string; fim: string; backfill: boolean } {
  const ultima = (config as { djen_ultima_consulta?: string } | null)?.djen_ultima_consulta
  const hoje = new Date(`${hojeISO}T12:00:00Z`)
  if (typeof ultima === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ultima)) {
    const d = new Date(`${ultima}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    return { inicio: d.toISOString().slice(0, 10), fim: hojeISO, backfill: false }
  }
  const ini = new Date(hoje)
  ini.setUTCDate(ini.getUTCDate() - BACKFILL_DIAS)
  return { inicio: ini.toISOString().slice(0, 10), fim: hojeISO, backfill: true }
}

/* ── consulta HTTP ─────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Consulta paginada por OAB. Lança em erro HTTP; devolve `completo:false` quando
 * saiu por deadline ou pelo teto de páginas — o chamador NÃO pode avançar a marca
 * d'água nesses casos (janela não coberta = publicações seriam perdidas p/ sempre). */
async function consultarPorOab(
  numeroOab: string,
  ufOab: string,
  inicio: string,
  fim: string,
  deadline: number,
): Promise<{ itens: ItemDjen[]; completo: boolean }> {
  const itens: ItemDjen[] = []
  for (let pagina = 1; pagina <= 8; pagina++) {
    if (Date.now() > deadline) return { itens, completo: false }
    const url =
      `${DJEN_BASE}?numeroOab=${encodeURIComponent(numeroOab)}&ufOab=${encodeURIComponent(ufOab)}` +
      `&dataDisponibilizacaoInicio=${inicio}&dataDisponibilizacaoFim=${fim}` +
      `&itensPorPagina=1000&pagina=${pagina}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`DJEN HTTP ${res.status}`)
      const data = await res.json()
      const raws = (data?.items as Array<Record<string, unknown>>) ?? []
      for (const r of raws) {
        const p = parseItemDjen(r)
        if (p) itens.push(p)
      }
      if (raws.length < 1000) return { itens, completo: true } // última página
    } finally {
      clearTimeout(timer)
    }
    await sleep(RATE_DELAY_MS)
  }
  return { itens, completo: false } // estourou o teto de páginas
}

/* ── sync principal ────────────────────────────────────────────────────── */

const RESUMO_SYSTEM =
  'Você resume publicações judiciais (DJEN) para um cliente leigo de um escritório de advocacia. ' +
  'Para CADA publicação escreva 1-2 frases curtas, factuais e em português claro, dizendo O QUE foi ' +
  'publicado/decidido, sem jargão, sem opinião, sem valores e sem estratégia. Não mencione "intimação" ' +
  'nem prazos processuais — foque no fato (ex.: "O juiz proferiu a sentença do processo." / ' +
  '"Um documento foi juntado ao processo e a advogada foi comunicada.").'

/** Resumo IA em lote a partir do TEXTO real das publicações (Haiku). Best-effort;
 * para no deadline (itens sem resumo são inseridos com o nome técnico mesmo). */
async function gerarResumosPublicacoes(itens: ItemDjen[], deadline?: number): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(itens.length).fill(null)
  const CHUNK = 8
  for (let i = 0; i < itens.length; i += CHUNK) {
    if (deadline && Date.now() > deadline) break
    const slice = itens.slice(i, i + CHUNK)
    const lista = slice
      .map((it, j) => `${j + 1}. [${it.tipoDocumento || it.tipoComunicacao}] ${it.textoPlano.slice(0, 1200)}`)
      .join('\n\n')
    try {
      const { result } = await completionJSON<{ resumos: string[] }>({
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 1200,
        system: RESUMO_SYSTEM,
        prompt:
          `Resuma cada publicação abaixo. Devolva JSON {"resumos": [...]} com EXATAMENTE ` +
          `${slice.length} itens, na mesma ordem.\n\n${lista}`,
      })
      const rs = Array.isArray(result?.resumos) ? result.resumos : []
      for (let j = 0; j < slice.length; j++) {
        if (typeof rs[j] === 'string' && rs[j].trim()) out[i + j] = rs[j].trim()
      }
    } catch (err) {
      logger.error('djen.resumos', { chunk: i }, err as Error)
    }
  }
  return out
}

interface OabConfig {
  numero: string
  uf: string
}

/** OABs monitoradas do tenant: a do responsável (tenants.oab_numero/oab_estado)
 * + extras em tenants.config.djen_oabs [{numero, uf}]. */
function oabsDoTenant(t: { oab_numero: string | null; oab_estado: string | null; config: unknown }): OabConfig[] {
  const out: OabConfig[] = []
  if (t.oab_numero && t.oab_estado) out.push({ numero: String(t.oab_numero).replace(/\D/g, ''), uf: t.oab_estado })
  const extras = (t.config as { djen_oabs?: Array<{ numero?: string; uf?: string }> } | null)?.djen_oabs
  if (Array.isArray(extras)) {
    for (const e of extras) {
      if (e?.numero && e?.uf) out.push({ numero: String(e.numero).replace(/\D/g, ''), uf: String(e.uf) })
    }
  }
  // dedup
  const vistos = new Set<string>()
  return out.filter((o) => {
    const k = `${o.numero}:${o.uf}`
    if (vistos.has(k) || !o.numero) return false
    vistos.add(k)
    return true
  })
}

/** Sincroniza publicações do DJEN para todos os tenants com OAB configurada.
 * Chamado pelo cron diário (isolado do sync DataJud). */
export async function sincronizarPublicacoesDjen(
  admin: Admin,
  opts?: { deadlineMs?: number; hojeISO?: string },
): Promise<{ tenants: number; casadas: number; novas: number; enviados: number; pendentes: number }> {
  const deadline = Date.now() + (opts?.deadlineMs ?? 20_000)
  const hojeISO = opts?.hojeISO ?? new Date().toISOString().slice(0, 10)

  // Sem filtro de OAB no WHERE: um tenant pode ter só OABs extras em
  // config.djen_oabs — oabsDoTenant decide (e o continue abaixo pula os sem OAB).
  const { data: tenants } = await admin
    .from('tenants')
    .select('id, nome, oab_numero, oab_estado, config')

  let casadas = 0
  let novas = 0
  let enviados = 0
  let pendentes = 0
  let nTenants = 0

  for (const t of tenants ?? []) {
    if (Date.now() > deadline) break
    const oabs = oabsDoTenant(t)
    if (oabs.length === 0) continue
    nTenants++

    const { inicio, fim, backfill } = janelaConsultaDjen(t.config, hojeISO)

    // 1) Consulta todas as OABs do tenant (dedup por id da comunicação).
    // QUALQUER cobertura incompleta (erro, deadline, teto de páginas) marca
    // falhouConsulta ⇒ a marca d'água não avança e a janela é recoberta amanhã.
    let falhouConsulta = false
    const porId = new Map<number, ItemDjen>()
    for (let i = 0; i < oabs.length; i++) {
      if (Date.now() > deadline) {
        falhouConsulta = true
        break
      }
      const oab = oabs[i]
      try {
        const { itens, completo } = await consultarPorOab(oab.numero, oab.uf, inicio, fim, deadline)
        if (!completo) falhouConsulta = true
        for (const it of itens) porId.set(it.id, it)
      } catch (err) {
        falhouConsulta = true
        logger.error('djen.consulta', { tenant: t.id, oab: `${oab.numero}/${oab.uf}` }, err as Error)
      }
      if (i < oabs.length - 1) await sleep(RATE_DELAY_MS) // rate também ENTRE OABs
    }
    if (porId.size === 0) {
      // Nada no período (ou falha). Só avança a marca se as consultas deram certo.
      if (!falhouConsulta) await salvarMarca(admin, t.id, t.config, fim)
      continue
    }

    // 2) Casa com os processos cadastrados do tenant (ativos)
    const { data: procs } = await admin
      .from('processos')
      .select('id, tenant_id, cliente_id, numero_cnj, apelido, situacao, cliente:clientes(nome, telefone, aviso_movimentacao, deleted_at)')
      .eq('tenant_id', t.id)
      .eq('situacao', 'ativo')
    type ProcJoin = {
      id: string
      tenant_id: string
      cliente_id: string
      numero_cnj: string
      apelido: string | null
      cliente: { nome: string | null; telefone: string | null; aviso_movimentacao: string | null; deleted_at: string | null } | null
    }
    const porNumero = new Map<string, ProcJoin>()
    for (const p of (procs ?? []) as unknown as ProcJoin[]) porNumero.set(p.numero_cnj, p)

    const casadasTenant = [...porId.values()].filter((it) => porNumero.has(it.numero))
    casadas += casadasTenant.length
    if (casadasTenant.length === 0) {
      if (!falhouConsulta) await salvarMarca(admin, t.id, t.config, fim)
      continue
    }

    // 3) Dedup contra o banco (raw_hash determinístico pelo id da comunicação).
    // Chunked (URL do PostgREST tem limite) e com erro TRATADO: dedup falho não
    // pode virar "tudo é novo" (regeraria resumos e travaria o cap p/ sempre).
    const comHash = casadasTenant.map((it) => ({ it, hash: hashMovimento({ djen: it.id }) }))
    const procIds = [...new Set(casadasTenant.map((it) => porNumero.get(it.numero)!.id))]
    const jaTem = new Set<string>()
    let dedupFalhou = false
    const hashes = comHash.map((x) => x.hash)
    for (let i = 0; i < hashes.length; i += 200) {
      const { data: existentes, error: exErr } = await admin
        .from('processo_movimentos')
        .select('raw_hash')
        .in('processo_id', procIds)
        .in('raw_hash', hashes.slice(i, i + 200))
      if (exErr) {
        dedupFalhou = true
        logger.error('djen.dedup', { tenant: t.id }, exErr)
        break
      }
      for (const r of existentes ?? []) jaTem.add(r.raw_hash)
    }
    if (dedupFalhou) continue // não avança a marca — reprocessa amanhã

    // Mais antigas primeiro: o drain do cap é determinístico (backfill converge).
    const todosNovos = comHash
      .filter((x) => !jaTem.has(x.hash))
      .sort((a, b) => a.it.data.localeCompare(b.it.data))
    if (todosNovos.length === 0) {
      if (!falhouConsulta) await salvarMarca(admin, t.id, t.config, fim)
      continue
    }
    // Cap por execução (resumo IA custa tempo). Se capar, NÃO avança a marca —
    // a próxima execução recobre a janela e o dedup pula os já processados.
    const CAP = 40
    const capou = todosNovos.length > CAP
    const novosItens = todosNovos.slice(0, CAP)

    // 4) Resumo IA (texto real) + montagem das linhas
    const resumos = await gerarResumosPublicacoes(novosItens.map((x) => x.it), deadline)
    const notificaveis = categoriasNotificaveis(t.config) as Set<string>

    const linhas = novosItens.map((x, i) => {
      const proc = porNumero.get(x.it.numero)!
      const categoria = classificarPublicacao(x.it)
      const aviso = proc.cliente?.aviso_movimentacao
      const clienteAtivo = !!proc.cliente && !proc.cliente.deleted_at
      const podeAvisar =
        !backfill && clienteAtivo && (aviso === 'fila' || aviso === 'automatico') && notificaveis.has(categoria)
      const resumo = resumos[i] ?? null
      return {
        processo_id: proc.id,
        codigo: null,
        nome: `Publicação no DJEN: ${x.it.tipoDocumento || x.it.tipoComunicacao || 'comunicação'}`,
        data_hora: `${x.it.data}T00:00:00-03:00`,
        complementos: [
          { tribunal: x.it.tribunal, orgao: x.it.orgao, tipoComunicacao: x.it.tipoComunicacao, tipoDocumento: x.it.tipoDocumento, link: x.it.link },
        ],
        raw: x.it.raw,
        raw_hash: x.hash,
        resumo_ia: resumo,
        categoria,
        notif_status: podeAvisar ? 'pendente' : 'nao_aplicavel',
        notif_texto: podeAvisar
          ? montarTextoAviso({
              clienteNome: proc.cliente?.nome ?? null,
              resumo,
              nomeTecnico: `Publicação: ${x.it.tipoDocumento || x.it.tipoComunicacao}`,
              rotuloProcesso: proc.apelido || x.it.raw.numeroprocessocommascara as string || null,
              escritorioNome: t.nome ?? null,
            })
          : null,
        _proc: proc, // uso local (removido antes do insert)
      }
    })

    // 5) Insere (idempotente) e envia os automáticos com claim atômico
    const paraInserir = linhas.map(({ _proc, ...l }) => l)
    const { data: inseridos, error } = await admin
      .from('processo_movimentos')
      .upsert(paraInserir, { onConflict: 'processo_id,raw_hash', ignoreDuplicates: true })
      .select('id, processo_id, notif_status, notif_texto')
    if (error) {
      logger.error('djen.insert', { tenant: t.id }, error)
      continue // não avança a marca — reprocessa na próxima
    }
    novas += (inseridos ?? []).length

    for (const r of inseridos ?? []) {
      if (r.notif_status !== 'pendente' || !r.notif_texto) continue
      const proc = linhas.find((l) => l._proc.id === r.processo_id)?._proc
      if (!proc) continue
      // Sem tempo para enviar com segurança? Fica 'pendente' → visível na fila
      // (Movimentações) — melhor um aviso manual do que um órfão em 'aprovada'.
      if (Date.now() > deadline) {
        pendentes++
        continue
      }
      if (proc.cliente?.aviso_movimentacao === 'automatico' && proc.cliente?.telefone) {
        const { data: claim } = await admin
          .from('processo_movimentos')
          .update({ notif_status: 'aprovada' })
          .eq('id', r.id)
          .eq('notif_status', 'pendente')
          .select('id')
        if (!claim || claim.length === 0) continue
        const res = await enviarAvisoWhatsApp(proc.cliente.telefone, r.notif_texto)
        if (res.ok) {
          enviados++
          await admin
            .from('processo_movimentos')
            .update({ notif_status: 'enviada', notif_enviada_em: new Date().toISOString() })
            .eq('id', r.id)
          await logAudit({
            tenantId: t.id,
            action: 'processo.notificacao_enviada',
            resourceType: 'processo',
            resourceId: proc.id,
            metadata: { movimento_id: r.id, cliente_id: proc.cliente_id, origem: 'djen' },
          })
        } else {
          await admin.from('processo_movimentos').update({ notif_status: 'erro' }).eq('id', r.id)
        }
      } else {
        pendentes++
      }
    }

    if (!falhouConsulta && !capou) await salvarMarca(admin, t.id, t.config, fim)
  }

  logger.info('djen.sync', { tenants: nTenants, casadas, novas, enviados, pendentes })
  return { tenants: nTenants, casadas, novas, enviados, pendentes }
}

/** Avança a marca d'água da consulta DJEN preservando o restante do config.
 * RELÊ o config na hora de salvar (não usa o lido no início do loop) para não
 * reverter uma alteração concorrente (ex.: escritório salvando categorias na UI). */
async function salvarMarca(admin: Admin, tenantId: string, _configAtual: unknown, dia: string): Promise<void> {
  const { data: fresco } = await admin.from('tenants').select('config').eq('id', tenantId).single()
  const config = { ...((fresco?.config as Record<string, unknown>) ?? {}), djen_ultima_consulta: dia }
  const { error } = await admin.from('tenants').update({ config }).eq('id', tenantId)
  if (error) logger.error('djen.marca', { tenant: tenantId }, error)
}
