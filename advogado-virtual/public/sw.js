// Service worker mínimo do SIMAS (escrito à mão — sem next-pwa).
//
// Objetivos, nesta ordem de prioridade:
//  1. NUNCA interferir em /api/** — dados jurídicos e uploads de áudio precisam
//     sempre da rede fresca; requisições de API passam direto.
//  2. Tornar o app instalável e dar um fallback offline decente na navegação.
//  3. Servir os assets estáticos do shell rapidamente (cache-first).
//
// Estratégia: network-first para navegação (HTML sempre atual quando há rede;
// fallback para a home em cache quando offline), cache-first para estáticos.

const VERSAO = 'simas-v1'
const SHELL = ['/dashboard', '/offline.html', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSAO).then((cache) => cache.addAll(SHELL)).catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Só lidamos com GET do mesmo domínio. Tudo mais (POST, /api/**, terceiros)
  // passa direto para a rede — sem cache, sem interceptação.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (url.pathname.startsWith('/auth/')) return

  // Navegação (documentos HTML): network-first com fallback offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copia = res.clone()
          caches.open(VERSAO).then((cache) => cache.put(request, copia)).catch(() => {})
          return res
        })
        .catch(async () => {
          const cache = await caches.open(VERSAO)
          return (
            (await cache.match(request)) ||
            (await cache.match('/dashboard')) ||
            (await cache.match('/offline.html')) ||
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          )
        }),
    )
    return
  }

  // Estáticos (imagens, ícones, _next/static): cache-first, popula em segundo plano.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon') ||
    /\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cacheado) =>
          cacheado ||
          fetch(request).then((res) => {
            const copia = res.clone()
            caches.open(VERSAO).then((cache) => cache.put(request, copia)).catch(() => {})
            return res
          }),
      ),
    )
  }
})
