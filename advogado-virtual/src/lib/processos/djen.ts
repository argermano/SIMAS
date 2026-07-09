// Fase 5 (complemento) + Módulo de Publicações (Lote 1) — publicações do DJEN
// (Diário de Justiça Eletrônico Nacional) via API Comunica do CNJ. Diferente do
// DataJud (movimentos em lote, dias de atraso, sem texto), o DJEN entrega em D+1
// o INTEIRO TEOR dos atos publicados (sentenças, decisões, intimações) e permite
// cobrir a carteira inteira com 1 consulta diária por OAB (cross-tribunal), em
// vez de 1 consulta por processo. API pública, sem chave; rate ~20 req/min/IP.
//
// Fluxo (cron diário), por tenant e por OAB:
//   1) consulta por OAB (janela deslizante D-2, dedup por id da comunicação);
//   2) PERSISTE TODAS as publicações parseadas em `publicacoes` (caixa de
//      entrada auditável — status 'nova'), não só as que casam com processos;
//   3) MATCH: as que casam com processos cadastrados viram processo_movimentos
//      (íntegra em raw) + resumo IA + aviso ao cliente VIP (regime da Fase 5),
//      e a linha de `publicacoes` recebe processo_id/movimento_id;
//   4) AUDITORIA: grava `capturas_publicacoes` por (tenant, oab) em TODA rodada
//      — inclusive zero encontradas (ausência de linha do dia = falha silenciosa);
//   5) ALERTA: falha na consulta da OAB dispara e-mail/Sentry (alertas.ts).
//
// Invariantes preservadas: marca d'água só avança com cobertura COMPLETA de
// todas as OABs (erro/deadline/teto de páginas ⇒ não avança); dedup por id;
// cap 40 no MATCH (resumo IA) com drain antigas-primeiro; claim atômico no envio;
// PRIMEIRA execução por tenant / reprocessamento = backfill silencioso (nunca
// notifica retroativo). LGPD: nunca logar `texto` (só ids/hashes/contagens).
// Ver docs/PLANO-PUBLICACOES-OPUS.md §3 e docs/PLANO-FASE-5-OPUS.md.

import type { SupabaseClient } from '@supabase/supabase-js'
import { classificarMovimento, categoriasNotificaveis, type CategoriaMovimento } from './categorias'
import { hashMovimento } from './sync'
import { montarTextoAviso, enviarAvisoWhatsApp } from './notificar'
import { hojeSaoPauloISO, proximoDiaUtil, normalizarOab } from './util'
import { alertarFalhaPublicacoes } from './alertas'
import { completionJSON } from '@/lib/anthropic/client'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

type Admin = SupabaseClient

const DJEN_BASE = process.env.DJEN_BASE ?? 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const BACKFILL_DIAS = 30
const RATE_DELAY_MS = 3200 // ~20 req/min por IP
const CAP = 40 // teto de movimentos com resumo IA por execução/tenant (não capa a persistência)

/* ── helpers puros (testáveis) ─────────────────────────────────────────── */

/** Remove tags/entidades HTML do texto da comunicação (para resumo/classificação). */
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

/** Linha da caixa de entrada `publicacoes` (o que se persiste da API). */
export interface LinhaPublicacao {
  tenant_id: string
  fonte: 'djen'
  chave_fonte: string
  numero_processo: string | null
  numero_mascara: string | null
  sigla_tribunal: string | null
  orgao_julgador: string | null
  tipo_comunicacao: string | null
  tipo_documento: string | null
  nome_classe: string | null
  texto: string | null
  data_disponibilizacao: string
  data_publicacao_sugerida: string
  destinatarios: unknown
  oab_consultada: string
  uf_oab: string
  meta: Record<string, unknown>
  status: 'nova'
}

/** Mapeia um ItemDjen para a linha da tabela `publicacoes` (helper puro, testável).
 * `oab`/`uf` são a inscrição CONSULTADA (não necessariamente a única destinatária).
 * `data_publicacao_sugerida` é o próximo dia útil (só pula fds; SEM feriados) —
 * referência de leitura, NUNCA prazo. */
export function montarLinhaPublicacao(
  item: ItemDjen,
  tenantId: string,
  oab: string,
  uf: string,
): LinhaPublicacao {
  const raw = item.raw
  return {
    tenant_id: tenantId,
    fonte: 'djen',
    chave_fonte: String(item.id),
    numero_processo: item.numero || null,
    numero_mascara: (raw.numeroprocessocommascara as string) || null,
    sigla_tribunal: item.tribunal || null,
    orgao_julgador: item.orgao || null,
    tipo_comunicacao: item.tipoComunicacao || null,
    tipo_documento: item.tipoDocumento || null,
    nome_classe: (raw.nomeClasse as string) || null,
    texto: (raw.texto as string) ?? null, // HTML integral (inteiro teor)
    data_disponibilizacao: item.data,
    data_publicacao_sugerida: proximoDiaUtil(item.data),
    destinatarios: raw.destinatarioadvogados ?? [],
    oab_consultada: oab,
    uf_oab: uf,
    meta: raw, // item bruto da API
    status: 'nova',
  }
}

/** Janela de consulta por tenant. Sem marca d'água (1ª vez) = backfill silencioso
 * dos últimos BACKFILL_DIAS. Depois, da última consulta -2 dias (overlap de 2 dias;
 * o dedup por id absorve os repetidos) até hoje. As datas de "hoje" vêm SEMPRE no
 * fuso America/Sao_Paulo (hojeSaoPauloISO) — nunca em UTC. */
export function janelaConsultaDjen(
  config: unknown,
  hojeISO: string,
): { inicio: string; fim: string; backfill: boolean } {
  const ultima = (config as { djen_ultima_consulta?: string } | null)?.djen_ultima_consulta
  const hoje = new Date(`${hojeISO}T12:00:00Z`)
  if (typeof ultima === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ultima)) {
    const d = new Date(`${ultima}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 2) // overlap de 2 dias (spec §3.1; dedup absorve)
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

/* ── resumo IA ─────────────────────────────────────────────────────────── */

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

/* ── OABs monitoradas ──────────────────────────────────────────────────── */

interface OabConfig {
  numero: string
  uf: string
}

/** OABs monitoradas do tenant: a do responsável (tenants.oab_numero/oab_estado)
 * + extras em tenants.config.djen_oabs [{numero, uf, ativa?}]. Normaliza o número
 * com normalizarOab (PRESERVA o sufixo de inscrição suplementar — '75.503-A' →
 * '75503A'; usar replace(/\D/g,'') aqui ZERARIA a OAB de SC no piloto, achado
 * crítico do plano §1) e respeita a flag `ativa` (só exclui quando ativa === false;
 * ausente/true continua monitorada). Exportado para teste. */
export function oabsDoTenant(t: {
  oab_numero: string | null
  oab_estado: string | null
  config: unknown
}): OabConfig[] {
  const out: OabConfig[] = []
  if (t.oab_numero && t.oab_estado) {
    out.push({ numero: normalizarOab(String(t.oab_numero)), uf: String(t.oab_estado).toUpperCase() })
  }
  const extras = (t.config as { djen_oabs?: Array<{ numero?: string; uf?: string; ativa?: boolean }> } | null)
    ?.djen_oabs
  if (Array.isArray(extras)) {
    for (const e of extras) {
      if (e?.numero && e?.uf && e.ativa !== false) {
        out.push({ numero: normalizarOab(String(e.numero)), uf: String(e.uf).toUpperCase() })
      }
    }
  }
  // dedup por (numero, uf) — evita consultar a mesma inscrição duas vezes.
  const vistos = new Set<string>()
  return out.filter((o) => {
    const k = `${o.numero}:${o.uf}`
    if (vistos.has(k) || !o.numero) return false
    vistos.add(k)
    return true
  })
}

/* ── auditoria ─────────────────────────────────────────────────────────── */

type StatusCaptura = 'sucesso' | 'parcial' | 'falha'

interface TenantRow {
  id: string
  nome: string | null
  oab_numero: string | null
  oab_estado: string | null
  config: unknown
}

/** Grava uma linha de trilha de execução por (tenant, oab). SEMPRE chamada — mesmo
 * com zero encontradas. `erro` NUNCA carrega texto de publicação (só a mensagem
 * técnica) — LGPD. Best-effort: uma falha ao auditar não derruba a rodada. */
async function gravarCaptura(
  admin: Admin,
  p: {
    tenantId: string
    oab: OabConfig
    inicio: string
    fim: string
    iniciadaEm: string
    status: StatusCaptura
    encontradas: number
    novas: number
    duplicadas: number
    erro?: string | null
  },
): Promise<void> {
  const { error } = await admin.from('capturas_publicacoes').insert({
    tenant_id: p.tenantId,
    oab: p.oab.numero,
    uf: p.oab.uf,
    janela_inicio: p.inicio,
    janela_fim: p.fim,
    iniciada_em: p.iniciadaEm,
    finalizada_em: new Date().toISOString(),
    status: p.status,
    qtd_encontradas: p.encontradas,
    qtd_novas: p.novas,
    qtd_duplicadas: p.duplicadas,
    erro: p.erro ?? null,
  })
  if (error) logger.error('djen.captura.insert', { tenant: p.tenantId }, error)
}

/* ── pipeline ──────────────────────────────────────────────────────────── */

interface TenantCounters {
  encontradasPub: number
  novasPub: number
  duplicadasPub: number
  casadas: number
  novasMov: number
  enviados: number
  pendentes: number
}

type ProcJoin = {
  id: string
  tenant_id: string
  cliente_id: string
  numero_cnj: string
  apelido: string | null
  cliente: {
    nome: string | null
    telefone: string | null
    aviso_movimentacao: string | null
    deleted_at: string | null
  } | null
}

/** Processa UM tenant: consulta todas as OABs, persiste TODAS as publicações,
 * casa com processos (fluxo Fase 5), audita e (opcionalmente) avança a marca.
 *
 * `avancarMarca` é false no reprocessamento/backfill manual (janela explícita,
 * nunca mexe na marca). `backfill` desliga o aviso ao cliente. A marca só avança
 * quando avancarMarca && cobertura COMPLETA (nenhuma OAB falhou/parcial) && !capou. */
async function processarTenantDjen(
  admin: Admin,
  t: TenantRow,
  cfg: { inicio: string; fim: string; backfill: boolean; avancarMarca: boolean; deadline: number },
): Promise<TenantCounters> {
  const { inicio, fim, backfill, avancarMarca, deadline } = cfg
  const oabs = oabsDoTenant(t)

  let encontradasPub = 0
  let novasPub = 0
  let duplicadasPub = 0
  let falhouConsulta = false // qualquer cobertura incompleta ⇒ marca não avança
  const porId = new Map<number, ItemDjen>()

  // 1) Consulta OAB a OAB. Persiste TODAS as parseadas em `publicacoes` e grava
  // a trilha de auditoria por (tenant, oab), inclusive quando não achou nada.
  for (let i = 0; i < oabs.length; i++) {
    const oab = oabs[i]
    const iniciadaEm = new Date().toISOString()

    // Sem tempo para consultar esta OAB: registra 'parcial' (não coberta) e segue.
    if (Date.now() > deadline) {
      falhouConsulta = true
      await gravarCaptura(admin, {
        tenantId: t.id, oab, inicio, fim, iniciadaEm,
        status: 'parcial', encontradas: 0, novas: 0, duplicadas: 0, erro: 'deadline antes da consulta',
      })
      continue
    }

    let itens: ItemDjen[] = []
    let completo = false
    let erro: string | null = null
    try {
      const r = await consultarPorOab(oab.numero, oab.uf, inicio, fim, deadline)
      itens = r.itens
      completo = r.completo
    } catch (err) {
      falhouConsulta = true
      erro = (err as Error).message
      logger.error('djen.consulta', { tenant: t.id, oab: `${oab.numero}/${oab.uf}` }, err as Error)
    }
    if (!completo && !erro) falhouConsulta = true // deadline no meio / teto de páginas

    // Dedup por id DENTRO da OAB (a API não deveria repetir, mas garante o upsert).
    const unicos = new Map<number, ItemDjen>()
    for (const it of itens) unicos.set(it.id, it)
    const itensUnicos = [...unicos.values()]

    // Persiste TODAS (upsert ignoreDuplicates) — a persistência NÃO é capada (o
    // cap 40 vale só p/ o MATCH). Chunked p/ não estourar o payload num backfill
    // grande (cada linha carrega o inteiro teor em `texto`/`meta`).
    let novas = 0
    if (itensUnicos.length > 0) {
      const linhas = itensUnicos.map((it) => montarLinhaPublicacao(it, t.id, oab.numero, oab.uf))
      const PUB_CHUNK = 500
      for (let j = 0; j < linhas.length; j += PUB_CHUNK) {
        const { data: ins, error: pubErr } = await admin
          .from('publicacoes')
          .upsert(linhas.slice(j, j + PUB_CHUNK), { onConflict: 'tenant_id,fonte,chave_fonte', ignoreDuplicates: true })
          .select('id')
        if (pubErr) {
          // Persistência falhou ⇒ não avança a marca (recobre a janela amanhã).
          falhouConsulta = true
          erro = erro ?? pubErr.message
          logger.error('djen.publicacoes.insert', { tenant: t.id }, pubErr)
          break
        }
        novas += (ins ?? []).length
      }
    }
    const encontradas = itensUnicos.length
    const duplicadas = Math.max(0, encontradas - novas)
    encontradasPub += encontradas
    novasPub += novas
    duplicadasPub += duplicadas
    for (const it of itensUnicos) porId.set(it.id, it)

    const status: StatusCaptura = erro ? 'falha' : completo ? 'sucesso' : 'parcial'
    await gravarCaptura(admin, {
      tenantId: t.id, oab, inicio, fim, iniciadaEm,
      status, encontradas, novas, duplicadas, erro,
    })
    // Falha na consulta da OAB ⇒ alerta operacional (e-mail + Sentry; nunca lança).
    if (status === 'falha') {
      await alertarFalhaPublicacoes({
        assunto: `DJEN: falha na captura (OAB ${oab.numero}/${oab.uf})`,
        detalhes:
          `Tenant ${t.id} — OAB ${oab.numero}/${oab.uf}, janela ${inicio}..${fim}.\n` +
          `Erro: ${erro}`,
      })
    }

    if (i < oabs.length - 1) await sleep(RATE_DELAY_MS) // rate também ENTRE OABs
  }

  const semMatch: TenantCounters = {
    encontradasPub, novasPub, duplicadasPub, casadas: 0, novasMov: 0, enviados: 0, pendentes: 0,
  }

  if (porId.size === 0) {
    // Nada no período (ou falha). Só avança a marca se as consultas deram certo.
    if (avancarMarca && !falhouConsulta) await salvarMarca(admin, t.id, t.config, fim)
    return semMatch
  }

  // 2) Casa com os processos cadastrados do tenant (ativos).
  const { data: procs } = await admin
    .from('processos')
    .select('id, tenant_id, cliente_id, numero_cnj, apelido, situacao, cliente:clientes(nome, telefone, aviso_movimentacao, deleted_at)')
    .eq('tenant_id', t.id)
    .eq('situacao', 'ativo')
  const porNumero = new Map<string, ProcJoin>()
  for (const p of (procs ?? []) as unknown as ProcJoin[]) porNumero.set(p.numero_cnj, p)

  const casadasTenant = [...porId.values()].filter((it) => porNumero.has(it.numero))
  if (casadasTenant.length === 0) {
    if (avancarMarca && !falhouConsulta) await salvarMarca(admin, t.id, t.config, fim)
    return { ...semMatch, casadas: 0 }
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
  if (dedupFalhou) return { ...semMatch, casadas: casadasTenant.length } // não avança a marca

  // Mais antigas primeiro: o drain do cap é determinístico (backfill converge).
  const todosNovos = comHash
    .filter((x) => !jaTem.has(x.hash))
    .sort((a, b) => a.it.data.localeCompare(b.it.data))
  if (todosNovos.length === 0) {
    if (avancarMarca && !falhouConsulta) await salvarMarca(admin, t.id, t.config, fim)
    return { ...semMatch, casadas: casadasTenant.length }
  }
  // Cap por execução (resumo IA custa tempo). Se capar, NÃO avança a marca — a
  // próxima execução recobre a janela e o dedup pula os já processados.
  const capou = todosNovos.length > CAP
  const novosItens = todosNovos.slice(0, CAP)

  // 4) Resumo IA (texto real) + montagem das linhas de processo_movimentos.
  const resumos = await gerarResumosPublicacoes(novosItens.map((x) => x.it), deadline)
  const notificaveis = categoriasNotificaveis(t.config) as Set<string>

  const linhas = novosItens.map((x, i) => {
    const proc = porNumero.get(x.it.numero)!
    const categoria = classificarPublicacao(x.it)
    const aviso = proc.cliente?.aviso_movimentacao
    const clienteAtivo = !!proc.cliente && !proc.cliente.deleted_at
    // backfill (1ª execução / reprocessamento) NUNCA notifica retroativo.
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
            rotuloProcesso: proc.apelido || (x.it.raw.numeroprocessocommascara as string) || null,
            escritorioNome: t.nome ?? null,
          })
        : null,
      _proc: proc, // uso local (removido antes do insert)
    }
  })

  // 5) Insere (idempotente) e envia os automáticos com claim atômico.
  const paraInserir = linhas.map(({ _proc, ...l }) => l)
  const { data: inseridos, error } = await admin
    .from('processo_movimentos')
    .upsert(paraInserir, { onConflict: 'processo_id,raw_hash', ignoreDuplicates: true })
    .select('id, processo_id, raw_hash, notif_status, notif_texto')
  if (error) {
    logger.error('djen.insert', { tenant: t.id }, error)
    return { ...semMatch, casadas: casadasTenant.length } // não avança a marca
  }
  type MovInserido = { id: string; processo_id: string; raw_hash: string; notif_status: string; notif_texto: string | null }
  const movimentos = (inseridos ?? []) as MovInserido[]
  const novasMov = movimentos.length
  const itemPorHash = new Map(novosItens.map((x) => [x.hash, x.it]))

  let enviados = 0
  let pendentes = 0
  for (const r of movimentos) {
    // Vínculo bidirecional: a linha de `publicacoes` casada recebe processo_id e
    // movimento_id (a triagem sabe que já virou movimento/aviso). Mapeia pelo
    // raw_hash retornado do upsert → id da comunicação → chave_fonte.
    const it = itemPorHash.get(r.raw_hash)
    if (it) {
      const { error: linkErr } = await admin
        .from('publicacoes')
        .update({ processo_id: r.processo_id, movimento_id: r.id })
        .eq('tenant_id', t.id)
        .eq('fonte', 'djen')
        .eq('chave_fonte', String(it.id))
      if (linkErr) logger.error('djen.publicacoes.link', { tenant: t.id }, linkErr)
    }

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

  if (avancarMarca && !falhouConsulta && !capou) await salvarMarca(admin, t.id, t.config, fim)

  return {
    encontradasPub, novasPub, duplicadasPub,
    casadas: casadasTenant.length, novasMov, enviados, pendentes,
  }
}

/** Itera todos os tenants com OAB configurada e roda o pipeline com a janela e a
 * política de marca fornecidas. Isola tenants entre si (o loop externo respeita o
 * deadline entre tenants). */
async function rodarPipeline(
  admin: Admin,
  cfg: {
    deadline: number
    janela: (config: unknown) => { inicio: string; fim: string; backfill: boolean }
    avancarMarca: boolean
    // Escopo: definido = processa APENAS este tenant (reprocessamento manual por
    // admin, que é papel POR TENANT — invariante f de isolamento); ausente = TODOS
    // os tenants (cron diário / bearer CRON_SECRET, operação de plataforma).
    tenantId?: string
  },
): Promise<{ tenants: number } & TenantCounters> {
  // Sem filtro de OAB no WHERE: um tenant pode ter só OABs extras em
  // config.djen_oabs — oabsDoTenant decide (e o `continue` abaixo pula os sem OAB).
  let query = admin
    .from('tenants')
    .select('id, nome, oab_numero, oab_estado, config')
  if (cfg.tenantId) query = query.eq('id', cfg.tenantId)
  const { data: tenants } = await query

  const agg = {
    tenants: 0,
    encontradasPub: 0, novasPub: 0, duplicadasPub: 0,
    casadas: 0, novasMov: 0, enviados: 0, pendentes: 0,
  }

  for (const t of (tenants ?? []) as TenantRow[]) {
    if (Date.now() > cfg.deadline) break
    if (oabsDoTenant(t).length === 0) continue
    agg.tenants++
    const { inicio, fim, backfill } = cfg.janela(t.config)
    const r = await processarTenantDjen(admin, t, {
      inicio, fim, backfill, avancarMarca: cfg.avancarMarca, deadline: cfg.deadline,
    })
    agg.encontradasPub += r.encontradasPub
    agg.novasPub += r.novasPub
    agg.duplicadasPub += r.duplicadasPub
    agg.casadas += r.casadas
    agg.novasMov += r.novasMov
    agg.enviados += r.enviados
    agg.pendentes += r.pendentes
  }
  return agg
}

/** Sincroniza publicações do DJEN para todos os tenants com OAB configurada.
 * Chamado pelo cron diário (isolado do sync DataJud). Avança a marca d'água por
 * tenant quando a cobertura foi completa. */
export async function sincronizarPublicacoesDjen(
  admin: Admin,
  opts?: { deadlineMs?: number; hojeISO?: string },
): Promise<{ tenants: number; casadas: number; novas: number; enviados: number; pendentes: number }> {
  const deadline = Date.now() + (opts?.deadlineMs ?? 20_000)
  const hojeISO = opts?.hojeISO ?? hojeSaoPauloISO()

  const agg = await rodarPipeline(admin, {
    deadline,
    janela: (config) => janelaConsultaDjen(config, hojeISO),
    avancarMarca: true,
  })

  // LGPD: só contagens — nunca texto de publicação.
  logger.info('djen.sync', {
    tenants: agg.tenants, casadas: agg.casadas, novas: agg.novasMov,
    novasPub: agg.novasPub, enviados: agg.enviados, pendentes: agg.pendentes,
  })
  // `novas` = movimentos novos (compat com a Fase 5); `casadas` = publicações que
  // casaram com processos cadastrados.
  return {
    tenants: agg.tenants, casadas: agg.casadas, novas: agg.novasMov,
    enviados: agg.enviados, pendentes: agg.pendentes,
  }
}

/** Reprocessamento MANUAL / backfill de publicações numa janela EXPLÍCITA
 * {inicio, fim}. Semântica de backfill: NÃO avança a marca d'água e NUNCA notifica
 * clientes — só recompõe a caixa de entrada `publicacoes` (e movimentos casados,
 * sem aviso) e grava a auditoria. Ver docs/PLANO-PUBLICACOES-OPUS.md §3/§4.
 *
 * `tenantId` (opcional) ESCOPA o reprocessamento a um único tenant — usado pelo
 * disparo manual de um admin (papel POR TENANT: nunca pode tocar outros escritórios;
 * invariante f). Ausente = TODOS os tenants, reservado à chamada de plataforma
 * (bearer CRON_SECRET). O retorno `tenants` reflete o escopo efetivo. */
export async function reprocessarPublicacoesDjen(
  admin: Admin,
  { inicio, fim, tenantId }: { inicio: string; fim: string; tenantId?: string },
): Promise<{ tenants: number; encontradas: number; novas: number }> {
  const deadline = Date.now() + 50_000 // disparo manual — orçamento maior (maxDuration 60)

  const agg = await rodarPipeline(admin, {
    deadline,
    janela: () => ({ inicio, fim, backfill: true }), // janela fixa; backfill = sem aviso
    avancarMarca: false, // reprocessamento nunca mexe na marca
    tenantId, // undefined = todos (plataforma); definido = só este tenant (admin)
  })

  // LGPD: só contagens/janela.
  logger.info('djen.reprocessa', {
    tenants: agg.tenants, encontradas: agg.encontradasPub, novas: agg.novasPub,
    duplicadas: agg.duplicadasPub, inicio, fim,
  })
  return { tenants: agg.tenants, encontradas: agg.encontradasPub, novas: agg.novasPub }
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
