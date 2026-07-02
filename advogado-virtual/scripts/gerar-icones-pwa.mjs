// Gera os ícones PNG do PWA a partir de src/app/icon.svg.
//
// Uso: node scripts/gerar-icones-pwa.mjs
// Requer `sharp` (já presente como dependência transitiva do Next.js).
//
// Saídas em public/:
//   icon-192.png, icon-512.png       — ícones "any" (com cantos arredondados)
//   icon-maskable-512.png            — full-bleed p/ máscara do Android (safe zone)
//   apple-touch-icon.png (180)       — iOS home screen
//
// Rodar novamente sempre que icon.svg mudar. Os PNGs são versionados.

import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgOriginal = readFileSync(join(raiz, 'src/app/icon.svg'), 'utf8')

// Conteúdo interno do SVG (defs + rect + emblema), sem a tag <svg> externa.
const interno = svgOriginal
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim()

// Ícone "any": todo o desenho de 32x32 escalado ao tamanho alvo (mantém os
// cantos arredondados do rect original, aparência de ícone de app).
function svgAny(tamanho) {
  const escala = tamanho / 32
  return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 ${tamanho} ${tamanho}" xmlns="http://www.w3.org/2000/svg"><g transform="scale(${escala})">${interno}</g></svg>`
}

// Ícone maskable: fundo full-bleed (sem cantos, a máscara do SO recorta) e o
// desenho centrado dentro da safe zone (~75% da tela).
function svgMaskable(tamanho) {
  const escala = (tamanho * 0.75) / 32
  const desenhado = 32 * escala
  const offset = (tamanho - desenhado) / 2
  return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 ${tamanho} ${tamanho}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="${tamanho}" y2="${tamanho}" gradientUnits="userSpaceOnUse"><stop stop-color="#2A3E5F"/><stop offset="1" stop-color="#4A6699"/></linearGradient></defs><rect width="${tamanho}" height="${tamanho}" fill="url(#bg)"/><g transform="translate(${offset} ${offset}) scale(${escala})">${interno}</g></svg>`
}

async function png(svg, arquivo, tamanho) {
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(tamanho, tamanho)
    .png()
    .toFile(join(raiz, 'public', arquivo))
  console.log('✓', arquivo)
}

await png(svgAny(192), 'icon-192.png', 192)
await png(svgAny(512), 'icon-512.png', 512)
await png(svgMaskable(512), 'icon-maskable-512.png', 512)
await png(svgAny(180), 'apple-touch-icon.png', 180)
console.log('Ícones do PWA gerados em public/.')
