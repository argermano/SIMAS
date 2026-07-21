// server-only: CORAÇÃO do espelho no Google Drive. Monta o estado DESEJADO da
// árvore de um cliente a partir do banco (nome do cliente, docs + vínculos N:N,
// títulos de casos, CNJ/apelido de processos) e RECONCILIA com o bookkeeping
// (drive_espelho, migration 066) + o Drive: cria o que falta (idempotente via
// consulta ao bookkeeping e resgate por appProperties), sobe arquivos novos,
// cria/remove atalhos conforme os vínculos, renomeia pastas/arquivos e manda para a
// lixeira o que sumiu. NUNCA apaga arquivo de vez (só lixeira); atalho pode remover.
// Best-effort por item: uma falha não aborta o cliente. SERVER-ONLY.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { agruparVinculosPorDoc, type VinculoDoc, type VinculoRow } from '@/lib/documentos/vinculos'
import { driveDisponivel, pastaRaizId, obterAccessToken } from './auth'
import {
  criarPasta,
  criarAtalho,
  uploadArquivo,
  buscarPorAppProperty,
  renomear,
  moverArquivo,
  moverLixeira,
  removerPermanente,
  obterMeta,
  DriveApiError,
} from './api'

type Admin = SupabaseClient

// Janela do CLAIM da fila: um cliente "em processamento" só volta a ser elegível
// por outro dreno após este tempo (protege contra dreno que morreu no meio). Bem
// acima do maxDuration=300 do cron para nunca reclamar algo ainda vivo.
const CLAIM_STALE_MS = 15 * 60_000

// Teto de tentativas: ao atingir este número de falhas consecutivas, o cliente
// vira DEAD-LETTER PASSIVO (fica na fila para inspeção, mas o claim o ignora — não
// queima mais budget). Exportado para o card de status contar só os vivos. Ver 072.
export const TETO_TENTATIVAS = 8

// Código LGPD-safe do erro para a coluna ultimo_erro: SÓ a classe/status HTTP,
// NUNCA a mensagem (o corpo de erro do Google pode conter e-mail). Puro.
function codigoErroDrive(e: unknown): string {
  if (e instanceof DriveApiError) return `http_${e.status}`
  return e instanceof Error ? e.name : 'erro'
}

/* ── PURO: saneamento e formatação de nomes ──────────────────────────────── */

/** Nome seguro para o Drive: sem os separadores/reservados de path, sem controles,
 *  espaços colapsados, sem ponto no fim (regra Windows/Drive) e com teto. Nunca
 *  vazio (fallback). Puro. */
export function sanitizarNome(nome: string | null | undefined): string {
  const limpo = (nome ?? '')
    .replace(/[/\\:*?"<>|]/g, ' ') // separadores de path e reservados
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ') // controles (não imprimíveis)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '') // ponto final quebra no Drive/Windows
    .trim()
  return limpo.slice(0, 200) || 'Sem nome'
}

/** Formata um número CNJ (20 dígitos) como NNNNNNN-DD.AAAA.J.TR.OOOO. Se não tiver
 *  20 dígitos, cai no saneamento do valor original. Puro. */
export function formatarCnj(numero: string | null | undefined): string {
  const s = (numero ?? '').replace(/\D/g, '')
  if (s.length !== 20) return sanitizarNome(numero || 'Processo')
  return `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16, 20)}`
}

/* ── PURO: montagem do estado desejado ───────────────────────────────────── */

export type NoTipo = 'cliente' | 'subraiz' | 'pasta_caso' | 'pasta_processo' | 'arquivo' | 'atalho'

// Um nó da árvore desejada. `parent` é a CHAVE do pai (`${tipo}:${ref}`) ou null
// (RAIZ). `chave(no)` é a identidade global (bate com UNIQUE de drive_espelho e com
// o appProperties.simasRef de resgate).
export interface NoDesejado {
  tipo: NoTipo
  ref: string
  nome: string
  parent: string | null
  docId?: string // arquivo: id do documento (bytes no bucket)
  fileUrl?: string | null // arquivo: path no bucket documentos
  mime?: string | null // arquivo
  alvoChave?: string // atalho: chave do arquivo alvo (`arquivo:${docId}`)
}

export const chave = (no: { tipo: NoTipo; ref: string }): string => `${no.tipo}:${no.ref}`

// Documento como o banco entrega (origem em atendimento_id/processo_id).
export interface DocEntrada {
  id: string
  file_name: string | null
  file_url: string | null
  mime_type: string | null
  atendimento_id: string | null // ORIGEM (onde nasceu), não o conjunto de pastas
  processo_id: string | null // ORIGEM
}

interface Pasta {
  tipo: 'pasta_caso' | 'pasta_processo'
  ref: string
  nome: string
  parent: string
}

/** Título/rótulo de uma pasta a partir de um vínculo N:N. */
function pastaDoVinculo(clienteId: string, v: VinculoDoc): Pasta {
  if (v.atendimento_id !== null) {
    return {
      tipo: 'pasta_caso',
      ref: v.atendimento_id,
      nome: sanitizarNome(v.titulo || 'Caso'),
      parent: `subraiz:${clienteId}:casos`,
    }
  }
  // processo: prefere CNJ formatado; senão o apelido; senão genérico.
  const nome = v.numero_cnj ? formatarCnj(v.numero_cnj) : sanitizarNome(v.apelido || 'Processo')
  return { tipo: 'pasta_processo', ref: v.processo_id, nome, parent: `subraiz:${clienteId}:processos` }
}

/**
 * Deriva a árvore DESEJADA (lista de nós, PAIS ANTES DOS FILHOS) do estado atual do
 * cliente. Regra por documento:
 *  • sem vínculos → arquivo em Gerais;
 *  • com vínculos → arquivo na 1ª pasta (a ORIGEM se estiver entre elas, senão a
 *    primeira por ordem estável) e ATALHOS nas demais.
 * Só emite os containers (Gerais/Casos/Processos) e pastas realmente usados (lazy).
 * Puro — testável sem rede.
 */
export function montarEstadoDesejado(params: {
  clienteId: string
  clienteNome: string | null
  docs: DocEntrada[]
  vinculosPorDoc: Map<string, VinculoDoc[]>
}): NoDesejado[] {
  const { clienteId, clienteNome, docs, vinculosPorDoc } = params
  const clienteChave = `cliente:${clienteId}`

  let usaGerais = false
  const casos = new Map<string, string>() // ref -> nome
  const processos = new Map<string, string>() // ref -> nome
  const arquivos: NoDesejado[] = []
  const atalhos: NoDesejado[] = []

  for (const doc of docs) {
    const vincs = vinculosPorDoc.get(doc.id) ?? []
    // Pastas do doc (dedup por ref — vínculo é único, mas defensivo).
    const pastas: Pasta[] = []
    const vistos = new Set<string>()
    for (const v of vincs) {
      const p = pastaDoVinculo(clienteId, v)
      if (vistos.has(p.ref)) continue
      vistos.add(p.ref)
      pastas.push(p)
    }

    const nomeArquivo = sanitizarNome(doc.file_name || 'documento')
    let parentPrimario: string

    if (pastas.length === 0) {
      usaGerais = true
      parentPrimario = `subraiz:${clienteId}:gerais`
    } else {
      // Registra todas as pastas usadas (containers viram lazy só se houver pasta).
      for (const p of pastas) {
        if (p.tipo === 'pasta_caso') casos.set(p.ref, p.nome)
        else processos.set(p.ref, p.nome)
      }
      // Primária = a pasta da ORIGEM se o doc está vinculado a ela; senão a 1ª por
      // ordem estável (por chave) — determinístico p/ o teste e p/ idempotência.
      const origem = doc.atendimento_id ?? doc.processo_id
      const ordenadas = [...pastas].sort((a, b) => chave(a).localeCompare(chave(b)))
      const primaria = pastas.find((p) => p.ref === origem) ?? ordenadas[0]
      parentPrimario = chave(primaria)
      for (const s of ordenadas) {
        if (s.ref === primaria.ref) continue
        atalhos.push({
          tipo: 'atalho',
          ref: `doc:${doc.id}:${s.ref}`,
          nome: nomeArquivo,
          parent: chave(s),
          alvoChave: `arquivo:${doc.id}`,
        })
      }
    }

    arquivos.push({
      tipo: 'arquivo',
      ref: doc.id,
      nome: nomeArquivo,
      parent: parentPrimario,
      docId: doc.id,
      fileUrl: doc.file_url,
      mime: doc.mime_type,
    })
  }

  const nos: NoDesejado[] = []
  // Cliente sempre presente (raiz do subtree) — persiste mesmo sem docs.
  nos.push({ tipo: 'cliente', ref: clienteId, nome: sanitizarNome(clienteNome || 'Cliente'), parent: null })
  if (usaGerais)
    nos.push({ tipo: 'subraiz', ref: `${clienteId}:gerais`, nome: 'Gerais', parent: clienteChave })
  if (casos.size)
    nos.push({ tipo: 'subraiz', ref: `${clienteId}:casos`, nome: 'Casos', parent: clienteChave })
  if (processos.size)
    nos.push({ tipo: 'subraiz', ref: `${clienteId}:processos`, nome: 'Processos', parent: clienteChave })

  for (const [ref, nome] of [...casos].sort((a, b) => a[0].localeCompare(b[0])))
    nos.push({ tipo: 'pasta_caso', ref, nome, parent: `subraiz:${clienteId}:casos` })
  for (const [ref, nome] of [...processos].sort((a, b) => a[0].localeCompare(b[0])))
    nos.push({ tipo: 'pasta_processo', ref, nome, parent: `subraiz:${clienteId}:processos` })

  arquivos.sort((a, b) => a.ref.localeCompare(b.ref))
  atalhos.sort((a, b) => a.ref.localeCompare(b.ref))
  return [...nos, ...arquivos, ...atalhos]
}

// Um RE-PARENT planejado: mover o arquivo `driveId` de `removeParent` p/ `addParent`.
export interface MovimentoArquivo {
  ref: string // documento_id (chave = `arquivo:${ref}`)
  driveId: string // id do arquivo no Drive
  addParent: string // drive_id da pasta destino (primária desejada)
  removeParent: string // drive_id da pasta origem (registrada no bookkeeping)
}

/**
 * PURO: dado o estado desejado e o bookkeeping atual (chave → {driveId, parentDriveId}),
 * decide quais ARQUIVOS já espelhados mudaram de pasta PRIMÁRIA e precisam RE-PARENTAR
 * (ex.: doc anexado em Gerais que depois ganha vínculo de caso, ou o inverso). O move
 * tem de ocorrer ANTES da limpeza de pastas, senão a pasta antiga iria para a lixeira
 * com o arquivo dentro. `driveIdDoParent` resolve a chave do pai desejado → drive_id
 * (os pais já foram criados na reconciliação). Só trata 'arquivo' — atalho muda de
 * pasta por recriação (ref_id novo). Linhas sem parentDriveId (antigas) são ignoradas.
 * Testável sem rede.
 */
export function planejarMovimentos(
  desejado: NoDesejado[],
  registro: Map<string, { driveId: string; parentDriveId: string | null }>,
  driveIdDoParent: (chaveDoPai: string) => string | undefined,
): MovimentoArquivo[] {
  const movs: MovimentoArquivo[] = []
  for (const no of desejado) {
    if (no.tipo !== 'arquivo' || no.parent === null) continue
    const reg = registro.get(chave(no))
    if (!reg || !reg.parentDriveId) continue // sem registro anterior → nada a mover
    const destino = driveIdDoParent(no.parent)
    if (!destino || destino === reg.parentDriveId) continue // pasta primária inalterada
    movs.push({ ref: no.ref, driveId: reg.driveId, addParent: destino, removeParent: reg.parentDriveId })
  }
  return movs
}

/* ── IMPURO: reconciliação com o Drive ───────────────────────────────────── */

export interface EspelhoContadores {
  pastas: number
  arquivos: number
  atalhos: number
  lixeira: number
  erros: number
  // Classe/código HTTP do ÚLTIMO erro (LGPD: nunca o corpo) — vira ultimo_erro na
  // fila quando o dreno incrementa a tentativa. undefined enquanto erros===0.
  ultimoErro?: string
}

interface EspelhoRow {
  id: string
  tipo: NoTipo
  ref_id: string
  drive_id: string
  nome: string | null
  parent_drive_id: string | null
}

/**
 * Espelha UM cliente no Drive. No-op silencioso se o espelho não está configurado
 * (INERTE). Best-effort por item: acumula erros mas não aborta. Devolve contadores.
 */
export async function espelharCliente(admin: Admin, clienteId: string): Promise<EspelhoContadores> {
  const cont: EspelhoContadores = { pastas: 0, arquivos: 0, atalhos: 0, lixeira: 0, erros: 0 }
  const raizId = pastaRaizId()
  if (!driveDisponivel() || !raizId) return cont // espelho desligado

  // 1) Estado atual do cliente no banco.
  const { data: cliente } = await admin
    .from('clientes')
    .select('id, nome, tenant_id')
    .eq('id', clienteId)
    .single()
  if (!cliente) return cont // cliente sumiu → nada a espelhar
  const tenantId = cliente.tenant_id as string

  const { data: docsRaw } = await admin
    .from('documentos')
    .select('id, file_name, file_url, mime_type, atendimento_id, processo_id')
    .eq('cliente_id', clienteId)
  const docs = (docsRaw ?? []) as DocEntrada[]

  const docIds = docs.map((d) => d.id)
  let vinculosPorDoc = new Map<string, VinculoDoc[]>()
  if (docIds.length) {
    const { data: vincRaw } = await admin
      .from('documento_vinculos')
      .select('documento_id, atendimento_id, processo_id, atendimentos(titulo), processos(numero_cnj, apelido)')
      .in('documento_id', docIds)
    vinculosPorDoc = agruparVinculosPorDoc((vincRaw ?? []) as unknown as VinculoRow[])
  }

  const desejado = montarEstadoDesejado({ clienteId, clienteNome: cliente.nome, docs, vinculosPorDoc })

  // 2) Bookkeeping do tenant (seed do cache + varredura de órfãos/lixeira).
  const { data: espRaw } = await admin
    .from('drive_espelho')
    .select('id, tipo, ref_id, drive_id, nome, parent_drive_id')
    .eq('tenant_id', tenantId)
  const existentes = (espRaw ?? []) as EspelhoRow[]
  const driveIdDe = new Map<string, string>()
  const nomeDe = new Map<string, string | null>()
  const rowDe = new Map<string, EspelhoRow>()
  for (const r of existentes) {
    const ck = `${r.tipo}:${r.ref_id}`
    driveIdDe.set(ck, r.drive_id)
    nomeDe.set(ck, r.nome)
    rowDe.set(ck, r)
  }

  let token: string
  try {
    token = await obterAccessToken()
  } catch (e) {
    logger.error('drive.espelho.token', {}, e) // LGPD: sem nomes
    cont.ultimoErro = codigoErroDrive(e)
    cont.erros++
    return cont
  }

  const upsertRow = (tipo: NoTipo, ref: string, drive_id: string, nome: string, parentDriveId?: string | null) =>
    admin.from('drive_espelho').upsert(
      { tenant_id: tenantId, tipo, ref_id: ref, drive_id, nome, parent_drive_id: parentDriveId ?? null },
      { onConflict: 'tenant_id,tipo,ref_id' },
    )

  // 3) Cria/renomeia os nós desejados (pais antes dos filhos).
  const desejadoChaves = new Set(desejado.map(chave))
  for (const no of desejado) {
    const ck = chave(no)
    try {
      const parentId = no.parent === null ? raizId : driveIdDe.get(no.parent)
      if (!parentId) {
        cont.ultimoErro = 'pai_nao_resolvido'
        cont.erros++ // pai não resolvido (criação dele falhou antes)
        continue
      }
      // Guardamos a pasta primária SÓ p/ arquivo/atalho (re-parent na etapa 3.5).
      const parentBK = no.tipo === 'arquivo' || no.tipo === 'atalho' ? parentId : null
      let id = driveIdDe.get(ck)
      const jaRegistrado = rowDe.has(ck)

      if (!id) {
        // Resgate: o objeto pode existir no Drive mesmo sem linha no bookkeeping.
        id = (await buscarPorAppProperty(token, 'simasRef', ck, parentId)) ?? undefined
      }
      if (!id) {
        if (no.tipo === 'arquivo') {
          if (!no.fileUrl) {
            cont.ultimoErro = 'sem_file_url'
            cont.erros++
            continue
          }
          const { data: blob, error } = await admin.storage.from('documentos').download(no.fileUrl)
          if (error || !blob) {
            cont.ultimoErro = 'download_falhou'
            cont.erros++
            continue
          }
          const bytes = Buffer.from(await blob.arrayBuffer())
          id = await uploadArquivo(token, no.nome, no.mime || 'application/octet-stream', bytes, parentId, {
            simasRef: ck,
          })
          cont.arquivos++
        } else if (no.tipo === 'atalho') {
          const targetId = no.alvoChave ? driveIdDe.get(no.alvoChave) : undefined
          if (!targetId) {
            cont.ultimoErro = 'alvo_nao_resolvido'
            cont.erros++ // arquivo alvo não resolvido
            continue
          }
          id = await criarAtalho(token, no.nome, targetId, parentId, { simasRef: ck })
          cont.atalhos++
        } else {
          id = await criarPasta(token, no.nome, parentId, { simasRef: ck })
          cont.pastas++
        }
        await upsertRow(no.tipo, no.ref, id, no.nome, parentBK)
      } else {
        // Já existe: registra (caso de resgate) e renomeia se o nome mudou.
        if (!jaRegistrado) await upsertRow(no.tipo, no.ref, id, no.nome, parentBK)
        else if (no.tipo !== 'atalho' && nomeDe.get(ck) !== no.nome) {
          await renomear(token, id, no.nome)
          await admin
            .from('drive_espelho')
            .update({ nome: no.nome })
            .match({ tenant_id: tenantId, tipo: no.tipo, ref_id: no.ref })
        }
      }
      driveIdDe.set(ck, id)
    } catch (e) {
      cont.ultimoErro = codigoErroDrive(e)
      cont.erros++
      logger.error('drive.espelho.no', { tipo: no.tipo }, e) // LGPD: só o tipo
    }
  }

  // 3.5) RE-PARENT: arquivos já espelhados cuja pasta PRIMÁRIA desejada mudou (ex.:
  // Gerais → pasta de caso, ou o inverso). Move ANTES da limpeza (passo 4) — senão a
  // pasta antiga, agora "não desejada", iria para a lixeira com o arquivo dentro.
  const registroMov = new Map<string, { driveId: string; parentDriveId: string | null }>()
  for (const r of existentes) registroMov.set(`${r.tipo}:${r.ref_id}`, { driveId: r.drive_id, parentDriveId: r.parent_drive_id })
  for (const mov of planejarMovimentos(desejado, registroMov, (p) => driveIdDe.get(p))) {
    try {
      await moverArquivo(token, mov.driveId, mov.addParent, mov.removeParent)
      await admin
        .from('drive_espelho')
        .update({ parent_drive_id: mov.addParent })
        .match({ tenant_id: tenantId, tipo: 'arquivo', ref_id: mov.ref })
    } catch (e) {
      cont.ultimoErro = codigoErroDrive(e)
      cont.erros++
      logger.error('drive.espelho.mover', {}, e) // LGPD: sem nomes/refs
    }
  }

  // 4) Remoções deste cliente: nós que ERAM espelhados e não são mais desejados.
  // Atribuição por id (sem varrer outros clientes): casos/processos do cliente e
  // atalhos de docs presentes. Arquivos "some junto" via varredura de órfãos (5).
  const [atendRes, procRes] = await Promise.all([
    admin.from('atendimentos').select('id').eq('cliente_id', clienteId),
    admin.from('processos').select('id').eq('cliente_id', clienteId),
  ])
  const atendIds = new Set(((atendRes.data ?? []) as { id: string }[]).map((r) => r.id))
  const procIds = new Set(((procRes.data ?? []) as { id: string }[]).map((r) => r.id))
  const docIdsSet = new Set(docIds)

  const meuDoCliente = (row: EspelhoRow): boolean => {
    switch (row.tipo) {
      case 'cliente':
        return row.ref_id === clienteId
      case 'subraiz':
        return row.ref_id.startsWith(`${clienteId}:`)
      case 'pasta_caso':
        return atendIds.has(row.ref_id)
      case 'pasta_processo':
        return procIds.has(row.ref_id)
      case 'atalho':
        return docIdsSet.has(row.ref_id.split(':')[1] ?? '') // 'doc:<docId>:<pastaRef>'
      default:
        return false // arquivo → tratado na varredura de órfãos
    }
  }

  for (const row of existentes) {
    const ck = `${row.tipo}:${row.ref_id}`
    if (desejadoChaves.has(ck) || !meuDoCliente(row)) continue
    try {
      if (row.tipo === 'atalho') await removerPermanente(token, row.drive_id)
      else await moverLixeira(token, row.drive_id)
      await admin.from('drive_espelho').delete().eq('id', row.id)
      cont.lixeira++
    } catch (e) {
      cont.ultimoErro = codigoErroDrive(e)
      cont.erros++
      logger.error('drive.espelho.remover', { tipo: row.tipo }, e)
    }
  }

  // 5) Varredura de ÓRFÃOS (doc excluído): linhas arquivo/atalho cujo documento não
  // existe mais em `documentos`. Tenant-wide (um doc inexistente não é de ninguém —
  // remover é seguro e idempotente). Arquivo → lixeira; atalho órfão → remove de vez.
  const refsDocs = new Set<string>()
  for (const r of existentes) {
    if (r.tipo === 'arquivo') refsDocs.add(r.ref_id)
    else if (r.tipo === 'atalho') {
      const d = r.ref_id.split(':')[1]
      if (d) refsDocs.add(d)
    }
  }
  if (refsDocs.size) {
    const { data: vivosRaw } = await admin
      .from('documentos')
      .select('id')
      .in('id', [...refsDocs])
    const vivos = new Set(((vivosRaw ?? []) as { id: string }[]).map((r) => r.id))
    for (const row of existentes) {
      const docId = row.tipo === 'arquivo' ? row.ref_id : row.tipo === 'atalho' ? row.ref_id.split(':')[1] : null
      if (!docId || vivos.has(docId)) continue
      try {
        if (row.tipo === 'atalho') await removerPermanente(token, row.drive_id)
        else await moverLixeira(token, row.drive_id)
        await admin.from('drive_espelho').delete().eq('id', row.id)
        cont.lixeira++
      } catch (e) {
        cont.ultimoErro = codigoErroDrive(e)
        cont.erros++
        logger.error('drive.espelho.orfao', { tipo: row.tipo }, e)
      }
    }
  }

  return cont
}

/* ── Drenagem / status ────────────────────────────────────────────────────── */

/**
 * Drena a fila (mais antigo primeiro) respeitando o teto de tempo (`deadline` =
 * epoch ms absoluto). Remove da fila SÓ em sucesso TOTAL (erros===0); com erros
 * INCREMENTA tentativas + grava ultimo_erro (classe/código HTTP) e libera o claim.
 * Ao atingir TETO_TENTATIVAS o item vira dead-letter passivo (fica na fila fora do
 * claim, para inspeção). No-op se o espelho está desligado. Devolve os totais de
 * clientes (processados/ok/com erro) E os agregados de arquivos enviados e erros —
 * o botão "Sincronizar agora" mostra {clientes, arquivos, erros}. O enfileiramento
 * (gatilhos) vive em ./fila.ts.
 */
export async function processarFilaDrive(
  admin: Admin,
  opts?: { deadline?: number; max?: number },
): Promise<{ clientes: number; sucesso: number; comErro: number; arquivos: number; erros: number }> {
  const resumo = { clientes: 0, sucesso: 0, comErro: 0, arquivos: 0, erros: 0 }
  if (!driveDisponivel()) return resumo
  const deadline = opts?.deadline ?? Date.now() + 45_000
  const { data: fila } = await admin
    .from('drive_sync_fila')
    .select('cliente_id')
    .lt('tentativas', TETO_TENTATIVAS) // ignora dead-letter (não ocupa o lote nem budget)
    .order('enfileirado_em', { ascending: true })
    .limit(opts?.max ?? 50)

  const staleAntes = new Date(Date.now() - CLAIM_STALE_MS).toISOString()

  for (const row of (fila ?? []) as { cliente_id: string }[]) {
    if (Date.now() >= deadline) break
    // CLAIM atômico em DOIS passos (livre; senão, claim velho). Empírico: o
    // .or() com timestamp neste UPDATE falha no PostgREST ("column does not
    // exist", com ou sem aspas) — dois UPDATEs condicionais simples são
    // equivalentes e cada um é atômico; o concorrente recebe 0 linhas e pula.
    // O `.lt('tentativas', TETO)` também barra um item que virou dead-letter entre
    // a leitura da fila e o claim. Trazemos `tentativas` para incrementar na falha.
    const agoraIso = new Date().toISOString()
    let { data: claim } = await admin
      .from('drive_sync_fila')
      .update({ processando_em: agoraIso })
      .eq('cliente_id', row.cliente_id)
      .is('processando_em', null)
      .lt('tentativas', TETO_TENTATIVAS)
      .select('cliente_id, tentativas')
    if (!claim || claim.length === 0) {
      const { data: claimStale } = await admin
        .from('drive_sync_fila')
        .update({ processando_em: agoraIso })
        .eq('cliente_id', row.cliente_id)
        .lt('processando_em', staleAntes)
        .lt('tentativas', TETO_TENTATIVAS)
        .select('cliente_id, tentativas')
      claim = claimStale
    }
    if (!claim || claim.length === 0) continue // outro dreno já pegou (ou dead-letter)
    const tentativasAtuais = (claim[0] as { tentativas: number | null }).tentativas ?? 0
    resumo.clientes++
    const r = await espelharCliente(admin, row.cliente_id)
    resumo.arquivos += r.arquivos
    resumo.erros += r.erros
    if (r.erros === 0) {
      await admin.from('drive_sync_fila').delete().eq('cliente_id', row.cliente_id)
      resumo.sucesso++
    } else {
      // Incrementa a tentativa + grava a classe/código do erro (LGPD: só código) e
      // libera o claim para retomar no próximo ciclo — até atingir o teto (então o
      // filtro .lt() acima o exclui: dead-letter passivo).
      await admin
        .from('drive_sync_fila')
        .update({ processando_em: null, tentativas: tentativasAtuais + 1, ultimo_erro: r.ultimoErro ?? null })
        .eq('cliente_id', row.cliente_id)
      resumo.comErro++
    }
  }

  // Dead-letter passivo: itens no teto de tentativas ficam para inspeção humana.
  // Loga só a CONTAGEM (LGPD: nunca ids) para o item podre virar algo que se vê.
  const { count: mortos } = await admin
    .from('drive_sync_fila')
    .select('cliente_id', { count: 'exact', head: true })
    .gte('tentativas', TETO_TENTATIVAS)
  if (mortos && mortos > 0) logger.warn('drive.fila.dead_letter', { mortos })

  return resumo
}

/**
 * Verifica se a pasta raiz configurada existe e é acessível pela service account
 * (para o card de status em Configurações). NÃO expõe o id. Devolve false se o
 * espelho está inerte, se a raiz não abre (404/403) ou está na lixeira. Nunca lança.
 */
export async function verificarRaiz(): Promise<boolean> {
  const raizId = pastaRaizId()
  if (!driveDisponivel() || !raizId) return false
  try {
    const token = await obterAccessToken()
    const meta = await obterMeta(token, raizId)
    return !!meta && meta.trashed !== true
  } catch {
    return false
  }
}

// Re-export p/ conveniência de quem orquestra (mesma superfície de erro).
export { DriveApiError }
