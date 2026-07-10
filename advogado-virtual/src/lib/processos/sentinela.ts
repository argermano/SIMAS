// Sentinela DataJud × DJEN — cruza as duas fontes já integradas: movimentos do
// DataJud (processo_movimentos, Fase 5) × publicações do DJEN (publicacoes).
// O DJEN é a fonte oficial/exclusiva de publicações (Res. CNJ 455/2022 + 569/2024),
// mas há falhas pontuais de envio/indexação pelos tribunais (caso real:
// 1068831-05.2020.4.01.3400, ato de 09/07/2026 que nunca entrou no DJEN).
//
// REGRA: movimento cuja natureza IMPLICA publicação no diário (regex curada em
// ehMovimentoDePublicacao — NÃO inclui "expedição"/"intimação" genéricas, que
// seriam falso positivo de intimação via portal) sem publicação correspondente
// em `publicacoes` (mesmo número por dígitos, disponibilização em ±3 dias) após
// carência de SENTINELA_DIAS_ESPERA e até 45 dias atrás → ALERTA aberto.
// AUTO-RESOLUÇÃO: alerta aberto cuja publicação apareceu → resolvida_auto.
//
// INVARIANTES: a sentinela NUNCA notifica cliente (WhatsApp) e NUNCA calcula
// prazo — é aviso interno de triagem. 1 alerta por movimento (unique
// movimento_id). rodarSentinela nunca lança (best-effort, roda no cron).

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

type Admin = SupabaseClient

/** Sanitiza a env de carência: lixo/vazio/negativo → default 2. Sem isso, um
 * typo na env ("2 dias") viraria NaN e DESLIGARIA a sentinela em silêncio;
 * valor negativo alertaria antes de o DJEN indexar (D/D+1) — ruído diário. */
export function sanitizarDiasEspera(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 2
  const v = Number(raw)
  return Number.isFinite(v) && v >= 0 ? v : 2
}
/** Carência em dias antes de alertar (o DJEN indexa em D/D+1; default 2). */
export const SENTINELA_DIAS_ESPERA = sanitizarDiasEspera(process.env.SENTINELA_DIAS_ESPERA)
/** Teto retroativo: movimentos mais antigos que isso não geram alerta. */
export const SENTINELA_JANELA_DIAS = 45
/** Janela de casamento movimento ↔ publicação: ±3 dias. */
const CASAMENTO_DIAS = 3
const DIA_MS = 86_400_000

/* ── helpers puros (testáveis; sem I/O) ────────────────────────────────── */

const normalizar = (s: string): string =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

const soDigitos = (s: string): string => (s ?? '').replace(/\D/g, '')

// Curadoria: só naturezas que implicam publicação no DIÁRIO. "Expedição" e
// "Intimação" genéricas ficam FORA (intimação via portal/mandado não passa
// pelo DJEN — alertar seria falso positivo).
// Cobre também "Republicação"/"Republicado" e o particípio com o nome por
// extenso ("Disponibilizado no Diário da Justiça Eletrônico"). O \b em "dje"
// blinda contra palavras que apenas contenham a sigla.
const RE_PUBLICACAO =
  /\b(?:re)?publicad|\b(?:re)?publicacao|disponibiliza\w*.*(?:\bdiario|\bdje\b)|remetid.*\bdje\b/

/** O nome do movimento implica publicação no diário? (normaliza acentos/caixa) */
export function ehMovimentoDePublicacao(nome: string): boolean {
  if (!nome) return false
  return RE_PUBLICACAO.test(normalizar(nome))
}

/** Janela de casamento [data do movimento − 3d, + 3d], em YYYY-MM-DD.
 * Âncora no meio-dia UTC (imune a DST/borda de fuso — ver util.proximoDiaUtil). */
export function janelaCasamento(dataMovimentoISO: string): { de: string; ate: string } {
  const [ano, mes, dia] = dataMovimentoISO.slice(0, 10).split('-').map(Number)
  const soma = (delta: number): string => {
    const d = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0))
    d.setUTCDate(d.getUTCDate() + delta)
    return d.toISOString().slice(0, 10)
  }
  return { de: soma(-CASAMENTO_DIAS), ate: soma(CASAMENTO_DIAS) }
}

/** Deve alertar? Respeita a carência (movimento mais novo que `diasEspera` ainda
 * não alerta — o DJEN indexa em D/D+1) e o teto retroativo de 45 dias. */
export function deveAlertar(dataMovimentoISO: string, agoraISO: string, diasEspera: number): boolean {
  const mov = Date.parse(dataMovimentoISO)
  const agora = Date.parse(agoraISO)
  if (!Number.isFinite(mov) || !Number.isFinite(agora)) return false
  const idade = agora - mov
  return idade >= diasEspera * DIA_MS && idade <= SENTINELA_JANELA_DIAS * DIA_MS
}

/** Existe publicação correspondente? Mesmo número por DÍGITOS (aceita máscara)
 * e data_disponibilizacao dentro da janela de ±3 dias do movimento. */
export function casarPublicacoes(
  digitosProcesso: string,
  movimentoISO: string,
  pubs: Array<{ numero: string; data: string }>,
): boolean {
  const alvo = soDigitos(digitosProcesso)
  if (!alvo) return false
  const { de, ate } = janelaCasamento(movimentoISO)
  return pubs.some((p) => {
    if (soDigitos(p.numero) !== alvo) return false
    const dia = (p.data ?? '').slice(0, 10)
    return dia >= de && dia <= ate
  })
}

/* ── rodada (I/O em lote; nunca lança) ─────────────────────────────────── */

export interface SentinelaResultado {
  avaliados: number // movimentos candidatos (natureza de publicação, janela 45d)
  abertos: number // alertas novos inseridos nesta rodada
  autoResolvidos: number // alertas abertos cuja publicação apareceu
}

interface ProcRow {
  id: string
  tenant_id: string
  numero_cnj: string
}
interface MovRow {
  id: string
  processo_id: string
  nome: string
  data_hora: string | null
}
interface AlertaRow {
  id: string
  tenant_id: string
  numero_processo: string
  movimento_data: string
}

const emLotes = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/**
 * Roda a sentinela: abre alertas para movimentos de publicação sem publicação
 * correspondente no DJEN e auto-resolve os abertos cuja publicação apareceu.
 * Queries em LOTE (sem N+1), dedup por unique movimento_id (upsert do nothing),
 * deadline próprio e best-effort — NUNCA lança (retorna as contagens que fez).
 *
 * `deadline` é epoch ms absoluto (default agora + 8s — pega carona no cron
 * diário DEPOIS do sync DataJud e da captura DJEN). `tenantId` escopa a rodada
 * (ausente = todos os tenants, chamada do cron). `agora` é injetável p/ teste.
 */
export async function rodarSentinela(
  admin: Admin,
  opts?: { tenantId?: string; agora?: string; deadline?: number },
): Promise<SentinelaResultado> {
  const r: SentinelaResultado = { avaliados: 0, abertos: 0, autoResolvidos: 0 }
  try {
    const agoraISO = opts?.agora ?? new Date().toISOString()
    const deadline = opts?.deadline ?? Date.now() + 8_000
    const agoraMs = Date.parse(agoraISO)
    const corteMovISO = new Date(agoraMs - SENTINELA_JANELA_DIAS * DIA_MS).toISOString()

    // 1) Processos cadastrados (tenant scoping quando pedido). Clientes
    // soft-deletados ficam FORA (mesmo padrão do sync DataJud) — sem alerta
    // sobre quem o escritório não representa mais.
    let qProc = admin
      .from('processos')
      .select('id, tenant_id, numero_cnj, clientes!inner(deleted_at)')
      .is('clientes.deleted_at', null)
    if (opts?.tenantId) qProc = qProc.eq('tenant_id', opts.tenantId)
    const { data: procs, error: procErr } = await qProc
    if (procErr) {
      logger.error('sentinela.processos', {}, procErr)
      return r
    }
    const procPorId = new Map<string, ProcRow>()
    for (const p of (procs ?? []) as ProcRow[]) procPorId.set(p.id, p)
    if (procPorId.size === 0) return r

    // 2) Movimentos recentes (janela de 45d), em lote.
    const movimentos: MovRow[] = []
    for (const ids of emLotes([...procPorId.keys()], 150)) {
      if (Date.now() > deadline) return r
      const { data, error } = await admin
        .from('processo_movimentos')
        .select('id, processo_id, nome, data_hora')
        .in('processo_id', ids)
        .gte('data_hora', corteMovISO)
        // Movimento SIMULADO (teste on-demand do dono, sync.simularMovimento)
        // nunca vira alerta: é teste, obviamente não há publicação no DJEN.
        .is('raw->_simulado', null)
      if (error) {
        logger.error('sentinela.movimentos', {}, error)
        return r
      }
      movimentos.push(...((data ?? []) as MovRow[]))
    }
    const candidatos = movimentos.filter(
      (m) => !!m.data_hora && procPorId.has(m.processo_id) && ehMovimentoDePublicacao(m.nome),
    )
    r.avaliados = candidatos.length

    // 2b) Cobertura da captura DJEN por tenant: só se pode afirmar "não está no
    // DJEN" quando a janela de casamento do movimento cabe no período já
    // capturado pela(s) OAB(s) do tenant. Sem isso, o snapshot histórico do
    // DataJud no cadastro de um processo (movimentos de 31–45d, além do
    // backfill de 30d do DJEN) geraria rajada de falsos positivos no
    // onboarding. Sem cobertura registrada (tenant sem OAB) → não alerta.
    const coberturaPorTenant = new Map<string, string>() // tenant → 1º dia coberto
    if (candidatos.length > 0) {
      if (Date.now() > deadline) return r
      const tenantsCand = [
        ...new Set(candidatos.map((m) => procPorId.get(m.processo_id)!.tenant_id)),
      ]
      const { data: caps, error: capErr } = await admin
        .from('capturas_publicacoes')
        .select('tenant_id, janela_inicio')
        .in('tenant_id', tenantsCand)
        .eq('status', 'sucesso')
      if (capErr) {
        // Sem cobertura conhecida não se abre alerta (fail-safe contra falso
        // positivo); a auto-resolução abaixo segue normalmente.
        logger.error('sentinela.cobertura', {}, capErr)
      } else {
        for (const c of (caps ?? []) as Array<{ tenant_id: string; janela_inicio: string }>) {
          const atual = coberturaPorTenant.get(c.tenant_id)
          if (!atual || c.janela_inicio < atual) coberturaPorTenant.set(c.tenant_id, c.janela_inicio)
        }
      }
    }

    // 3) Alertas abertos (para auto-resolução).
    let qAb = admin
      .from('sentinela_publicacoes')
      .select('id, tenant_id, numero_processo, movimento_data')
      .eq('status', 'aberta')
    if (opts?.tenantId) qAb = qAb.eq('tenant_id', opts.tenantId)
    const { data: abertosRows, error: abErr } = await qAb
    if (abErr) {
      logger.error('sentinela.abertos', {}, abErr)
      return r
    }
    const alertasAbertos = (abertosRows ?? []) as AlertaRow[]
    if (candidatos.length === 0 && alertasAbertos.length === 0) return r

    // 4) Publicações dos números envolvidos (candidatos + alertas), em lote.
    // Se o deadline estourar no meio, ABORTA sem abrir alertas: publicação não
    // carregada não pode virar falso alerta.
    const numeros = new Set<string>()
    const tenants = new Set<string>()
    for (const m of candidatos) {
      const p = procPorId.get(m.processo_id)!
      numeros.add(soDigitos(p.numero_cnj))
      tenants.add(p.tenant_id)
    }
    for (const a of alertasAbertos) {
      numeros.add(soDigitos(a.numero_processo))
      tenants.add(a.tenant_id)
    }
    // Corte das publicações: cobre a janela dos candidatos (45+3d) E a dos
    // alertas ainda abertos — um alerta cujo movimento passou de ~48d precisa
    // de publicações mais antigas que o corte fixo para auto-resolver (pub
    // capturada tardiamente via backfill/reprocesso).
    let cortePubMs = agoraMs - (SENTINELA_JANELA_DIAS + CASAMENTO_DIAS) * DIA_MS
    for (const a of alertasAbertos) {
      const t = Date.parse(a.movimento_data)
      if (Number.isFinite(t)) cortePubMs = Math.min(cortePubMs, t - CASAMENTO_DIAS * DIA_MS)
    }
    const cortePubISO = new Date(cortePubMs).toISOString().slice(0, 10)
    // chave `${tenant_id}:${digitos}` → publicações (tenant scoping no casamento)
    const pubsPorChave = new Map<string, Array<{ numero: string; data: string }>>()
    for (const nums of emLotes([...numeros], 150)) {
      if (Date.now() > deadline) return r
      const { data, error } = await admin
        .from('publicacoes')
        .select('tenant_id, numero_processo, data_disponibilizacao')
        .in('tenant_id', [...tenants])
        .in('numero_processo', nums)
        .gte('data_disponibilizacao', cortePubISO)
      if (error) {
        logger.error('sentinela.publicacoes', {}, error)
        return r
      }
      for (const p of (data ?? []) as Array<{
        tenant_id: string
        numero_processo: string | null
        data_disponibilizacao: string
      }>) {
        if (!p.numero_processo) continue
        const k = `${p.tenant_id}:${soDigitos(p.numero_processo)}`
        const lista = pubsPorChave.get(k) ?? []
        lista.push({ numero: p.numero_processo, data: p.data_disponibilizacao })
        pubsPorChave.set(k, lista)
      }
    }

    // 5) Auto-resolução: alerta aberto cuja publicação APARECEU. O filtro
    // .eq('status','aberta') no update preserva uma ação humana concorrente.
    const resolverIds = alertasAbertos
      .filter((a) =>
        casarPublicacoes(
          a.numero_processo,
          a.movimento_data,
          pubsPorChave.get(`${a.tenant_id}:${soDigitos(a.numero_processo)}`) ?? [],
        ),
      )
      .map((a) => a.id)
    if (resolverIds.length > 0) {
      const { data: upd, error } = await admin
        .from('sentinela_publicacoes')
        .update({ status: 'resolvida_auto', resolvida_em: agoraISO })
        .in('id', resolverIds)
        .eq('status', 'aberta')
        .select('id')
      if (error) logger.error('sentinela.autoresolver', {}, error)
      else r.autoResolvidos = (upd ?? []).length
    }

    // 6) Alertas novos: carência + teto respeitados e SEM publicação casada.
    // Dedup pelo unique movimento_id (on conflict do nothing) — movimento só
    // alerta 1x, mesmo entre rodadas e mesmo após verificada/ignorada.
    const linhas = candidatos
      .filter((m) => deveAlertar(m.data_hora as string, agoraISO, SENTINELA_DIAS_ESPERA))
      .filter((m) => {
        // Janela de casamento inteira dentro da cobertura DJEN do tenant (2b);
        // fora dela a ausência da publicação não prova nada.
        const cobertura = coberturaPorTenant.get(procPorId.get(m.processo_id)!.tenant_id)
        return !!cobertura && janelaCasamento(m.data_hora as string).de >= cobertura
      })
      .filter((m) => {
        const p = procPorId.get(m.processo_id)!
        return !casarPublicacoes(
          p.numero_cnj,
          m.data_hora as string,
          pubsPorChave.get(`${p.tenant_id}:${soDigitos(p.numero_cnj)}`) ?? [],
        )
      })
      .map((m) => {
        const p = procPorId.get(m.processo_id)!
        return {
          tenant_id: p.tenant_id,
          processo_id: p.id,
          movimento_id: m.id,
          numero_processo: soDigitos(p.numero_cnj),
          movimento_nome: m.nome,
          movimento_data: m.data_hora,
          status: 'aberta',
        }
      })
    if (linhas.length > 0 && Date.now() <= deadline) {
      const { data: ins, error } = await admin
        .from('sentinela_publicacoes')
        .upsert(linhas, { onConflict: 'movimento_id', ignoreDuplicates: true })
        .select('id')
      if (error) logger.error('sentinela.abrir', {}, error)
      else r.abertos = (ins ?? []).length
    }

    logger.info('sentinela.rodada', { ...r })
    return r
  } catch (err) {
    // Best-effort: a sentinela pega carona no cron e NUNCA pode derrubá-lo.
    logger.error('sentinela.excecao', {}, err as Error)
    return r
  }
}
