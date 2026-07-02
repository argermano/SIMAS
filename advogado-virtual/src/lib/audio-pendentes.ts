// Persistência local (IndexedDB) de trechos de áudio ainda não enviados ao
// servidor. Cenário-chave: advogado gravando o relato pelo celular em campo,
// com conexão instável — nenhum trecho pode se perder se o upload falhar ou a
// aba fechar. Cada chunk gravado é salvo aqui ANTES do upload e removido só
// após confirmação do servidor.
//
// Client-only (IndexedDB não existe no server) — os chamadores são componentes
// 'use client'. Todas as funções falham de forma silenciosa e segura quando o
// IndexedDB não está disponível (ex.: modo privado antigo): o fluxo de upload
// continua funcionando, apenas sem a garantia de sobrevivência a crash.

const DB_NAME = 'simas-audio'
const STORE = 'chunks-pendentes'
const DB_VERSION = 1

export interface ChunkPendente {
  /** chave: `${atendimentoId}:${chunkNum}` */
  id: string
  atendimentoId: string
  chunkNum: number
  blob: Blob
  mimeType: string
  criadoEm: number
}

function abrirDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex('atendimentoId', 'atendimentoId', { unique: false })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** Salva (ou substitui) um trecho pendente. */
export async function salvarChunkPendente(chunk: Omit<ChunkPendente, 'id' | 'criadoEm'>): Promise<void> {
  const db = await abrirDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({
        ...chunk,
        id: `${chunk.atendimentoId}:${chunk.chunkNum}`,
        criadoEm: Date.now(),
      } satisfies ChunkPendente)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
  db.close()
}

/** Remove um trecho após confirmação de upload. */
export async function removerChunkPendente(atendimentoId: string, chunkNum: number): Promise<void> {
  const db = await abrirDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(`${atendimentoId}:${chunkNum}`)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
  db.close()
}

/** Lista os trechos pendentes de um atendimento, em ordem de chunk. */
export async function listarChunksPendentes(atendimentoId: string): Promise<ChunkPendente[]> {
  const db = await abrirDb()
  if (!db) return []
  const itens = await new Promise<ChunkPendente[]>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const idx = tx.objectStore(STORE).index('atendimentoId')
      const req = idx.getAll(IDBKeyRange.only(atendimentoId))
      req.onsuccess = () => resolve((req.result as ChunkPendente[]) ?? [])
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
  db.close()
  return itens.sort((a, b) => a.chunkNum - b.chunkNum)
}

/** Descarta todos os trechos pendentes de um atendimento. */
export async function descartarChunksPendentes(atendimentoId: string): Promise<void> {
  const pendentes = await listarChunksPendentes(atendimentoId)
  for (const p of pendentes) {
    await removerChunkPendente(atendimentoId, p.chunkNum)
  }
}
