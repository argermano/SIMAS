// Copia os assets pré-compilados do ogv.js (runtime + demuxers/decoders WASM +
// Web Workers) de node_modules/ogv/dist para public/ogv, de onde o app os serve
// SAME-ORIGIN. Em runtime o player aponta OGVLoader.base = '/ogv', então esses
// arquivos precisam existir com os nomes originais.
//
// Uso manual:  node scripts/copiar-ogv.mjs
// No build:    roda automaticamente (passo do "build" no package.json).
//
// public/ogv/ está no .gitignore — binários (WASM) NÃO são versionados; quem
// clonar o repo os regenera rodando o build (ou este script).

import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const origem = join(raiz, 'node_modules', 'ogv', 'dist')
const destino = join(raiz, 'public', 'ogv')

if (!existsSync(origem)) {
  console.error('✗ node_modules/ogv/dist não encontrado — rode `npm i` (ou `npm i ogv`) antes.')
  process.exit(1)
}

// Idempotente: zera o destino e recopia (evita restos de versões antigas do ogv).
await rm(destino, { recursive: true, force: true })
await mkdir(destino, { recursive: true })
await cp(origem, destino, { recursive: true })

const arquivos = await readdir(destino)
console.log(`✓ ogv: ${arquivos.length} arquivos copiados para public/ogv/`)
