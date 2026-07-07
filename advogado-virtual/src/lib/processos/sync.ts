// Fase 5 — sincronização de processos com o DataJud.
// Delta por hash do movimento (idempotente pelo índice único), classificação de
// categoria e resumo em linguagem natural (1x, no primeiro sync do movimento).
// NÃO envia notificação — isso é o Lote 2 (fila/automático). Aqui todo movimento
// novo entra com notif_status='nao_aplicavel'. Ver docs/PLANO-FASE-5-OPUS.md §4.

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarProcessoCompletoPorNumero, type MovimentoBruto } from '@/lib/jurisprudencia/datajud'
import { classificarMovimento, sugereEncerramento } from './categorias'
import { completionJSON } from '@/lib/anthropic/client'
import { logger } from '@/lib/logger'

type Admin = SupabaseClient

interface ProcessoRow {
  id: string
  tenant_id: string
  numero_cnj: string
  tribunal_alias: string
  situacao: string
}

/** Hash estável do registro bruto do movimento (dedup no sync). O índice único
 * (processo_id, raw_hash) é a garantia real de idempotência; este hash é a chave. */
export function hashMovimento(raw: unknown): string {
  return createHash('md5').update(JSON.stringify(raw)).digest('hex')
}

const RESUMO_SYSTEM =
  'Você resume movimentações processuais para um cliente leigo de um escritório de advocacia. ' +
  'Para CADA movimento escreva UMA frase curta, factual e em português claro, sem jargão jurídico, ' +
  'sem opinião, sem valores e sem estratégia. Exemplos: "Trânsito em Julgado" → "A decisão se tornou ' +
  'definitiva — não cabe mais recurso."; "Conclusão para despacho" → "O processo foi enviado ao juiz ' +
  'para uma decisão."; "Juntada de Petição" → "Um documento foi anexado ao processo."'

const complementoTexto = (c: Array<Record<string, unknown>> | undefined): string =>
  (c ?? [])
    .map((x) => Object.values(x).filter((v) => typeof v === 'string').join(' '))
    .filter(Boolean)
    .join('; ')

/** Gera resumos em linguagem natural para os movimentos novos (Haiku, em lote). */
async function gerarResumos(movs: MovimentoBruto[]): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(movs.length).fill(null)
  const CHUNK = 30
  for (let i = 0; i < movs.length; i += CHUNK) {
    const slice = movs.slice(i, i + CHUNK)
    const lista = slice
      .map((m, j) => {
        const comp = complementoTexto(m.complementos)
        return `${j + 1}. ${m.nome}${comp ? ` (${comp})` : ''}`
      })
      .join('\n')
    try {
      const { result } = await completionJSON<{ resumos: string[] }>({
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 1500,
        system: RESUMO_SYSTEM,
        prompt:
          `Resuma cada movimento abaixo. Devolva JSON {"resumos": [...]} com EXATAMENTE ` +
          `${slice.length} itens, na mesma ordem dos movimentos.\n\n${lista}`,
      })
      const rs = Array.isArray(result?.resumos) ? result.resumos : []
      for (let j = 0; j < slice.length; j++) {
        if (typeof rs[j] === 'string' && rs[j].trim()) out[i + j] = rs[j].trim()
      }
    } catch (err) {
      // Best-effort: sem resumo o movimento ainda é armazenado (resumo_ia null).
      logger.error('processos.sync.resumos', { chunk: i, total: movs.length }, err as Error)
    }
  }
  return out
}

/** Sincroniza UM processo: busca no DataJud, insere movimentos novos (delta por
 * hash), classifica, resume e atualiza a capa. Retorna nº de novos ou null se a
 * consulta falhou (best-effort: fica para a próxima execução). */
async function syncUmProcesso(admin: Admin, proc: ProcessoRow): Promise<{ novos: number; encerrou: boolean } | null> {
  const dados = await buscarProcessoCompletoPorNumero(proc.tribunal_alias, proc.numero_cnj)
  if (!dados) return null

  const comHash = dados.movimentos.map((m) => ({ m, hash: hashMovimento(m.raw) }))

  const { data: existentes } = await admin
    .from('processo_movimentos')
    .select('raw_hash')
    .eq('processo_id', proc.id)
  const jaTem = new Set((existentes ?? []).map((r: { raw_hash: string }) => r.raw_hash))

  // Novos, deduplicados também localmente (o DataJud às vezes repete um registro).
  const vistos = new Set<string>()
  const novos = comHash.filter((x) => {
    if (jaTem.has(x.hash) || vistos.has(x.hash)) return false
    vistos.add(x.hash)
    return true
  })

  const resumos = novos.length ? await gerarResumos(novos.map((x) => x.m)) : []

  let encerrou = false
  const linhas = novos.map((x, i) => {
    const categoria = classificarMovimento({ codigo: x.m.codigo, nome: x.m.nome, complementos: x.m.complementos })
    if (sugereEncerramento(categoria)) encerrou = true
    return {
      processo_id: proc.id,
      codigo: x.m.codigo,
      nome: x.m.nome,
      data_hora: x.m.dataHora,
      complementos: x.m.complementos,
      raw: x.m.raw,
      raw_hash: x.hash,
      resumo_ia: resumos[i] ?? null,
      categoria,
      notif_status: 'nao_aplicavel', // Lote 1 nunca notifica; Lote 2 acende a fila
    }
  })

  if (linhas.length) {
    const { error } = await admin
      .from('processo_movimentos')
      .upsert(linhas, { onConflict: 'processo_id,raw_hash', ignoreDuplicates: true })
    if (error) {
      logger.error('processos.sync.insert', { processo: proc.id }, error)
      return null
    }
  }

  const patch: Record<string, unknown> = {
    classe: dados.classe || null,
    orgao_julgador: dados.orgaoJulgador || null,
    assuntos: dados.assuntos,
    grau: dados.grau || null,
    data_ajuizamento: dados.dataAjuizamento,
    datajud_atualizado_em: dados.dataHoraUltimaAtualizacao,
    dados_capa: dados.dadosCapa,
    ultima_sincronizacao: new Date().toISOString(),
  }
  if (encerrou && proc.situacao !== 'encerrado') patch.situacao = 'encerrado'
  const { error: upErr } = await admin.from('processos').update(patch).eq('id', proc.id)
  if (upErr) logger.error('processos.sync.capa', { processo: proc.id }, upErr)

  return { novos: linhas.length, encerrou }
}

const COLS = 'id, tenant_id, numero_cnj, tribunal_alias, situacao'

/** Sync imediato de UM processo (ao cadastrar): snapshot histórico completo.
 * Os movimentos históricos entram como 'nao_aplicavel' — nunca notifica retroativo. */
export async function sincronizarProcessoPorId(
  admin: Admin,
  processoId: string,
): Promise<{ novos: number; encerrou: boolean } | null> {
  const { data: proc } = await admin.from('processos').select(COLS).eq('id', processoId).single()
  if (!proc) return null
  return syncUmProcesso(admin, proc as ProcessoRow)
}

/** Sync em lote (cron): processos ativos, mais desatualizados primeiro,
 * concorrência ≤ 3 e teto de tempo — o que não couber fica para a próxima. */
export async function sincronizarProcessos(
  admin: Admin,
  opts?: { deadlineMs?: number; max?: number },
): Promise<{ processos: number; novosMovimentos: number; consultados: number }> {
  const deadline = Date.now() + (opts?.deadlineMs ?? 45_000)
  const max = opts?.max ?? 60

  const { data: pend, error } = await admin
    .from('processos')
    .select(COLS)
    .eq('situacao', 'ativo')
    .order('ultima_sincronizacao', { ascending: true, nullsFirst: true })
    .limit(max)
  if (error) {
    logger.error('processos.sync.listar', {}, error)
    return { processos: 0, novosMovimentos: 0, consultados: 0 }
  }

  const fila = (pend ?? []) as ProcessoRow[]
  let processos = 0
  let novosMovimentos = 0
  let consultados = 0
  let idx = 0

  const worker = async () => {
    while (idx < fila.length && Date.now() < deadline) {
      const proc = fila[idx++]
      consultados++
      const r = await syncUmProcesso(admin, proc)
      if (r) {
        processos++
        novosMovimentos += r.novos
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, fila.length) }, worker))

  logger.info('processos.sync', { processos, consultados, novosMovimentos })
  return { processos, novosMovimentos, consultados }
}
