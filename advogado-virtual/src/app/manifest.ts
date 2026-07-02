import type { MetadataRoute } from 'next'

// Manifesto do PWA (Next 15 gera /manifest.webmanifest a partir daqui).
// Cenário-chave: advogado grava o relato do cliente pelo celular, em campo —
// o app instalável abre em tela cheia e mantém o fluxo próximo do nativo.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SIMAS — Advogado Virtual',
    short_name: 'SIMAS',
    description:
      'Analise casos com IA, gere peças processuais e registre atendimentos — direto do celular ou do computador.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'pt-BR',
    dir: 'ltr',
    background_color: '#F7F5F0', // --background (tema claro)
    theme_color: '#2A3E5F',      // azul da marca (ícone/sidebar)
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
