import type { NextConfig } from 'next'

// Headers de segurança aplicados a todas as respostas.
// Obs.: 'microphone=(self)' é necessário porque o app grava áudio (GravadorAudio).
// Uma Content-Security-Policy de conteúdo completa (script-src/style-src) deve ser
// adicionada após validação em browser — aqui usamos frame-ancestors para anti-clickjacking.
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), geolocation=(), microphone=(self)',
  },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
]

// Identificação do build (avaliada em build-time; exibida na tela de Configurações).
// Na Vercel, VERCEL_GIT_COMMIT_SHA e VERCEL_ENV são preenchidos automaticamente.
const buildSha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'local'
const buildEnv = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'
const buildTime = new Date().toISOString()

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha,
    NEXT_PUBLIC_BUILD_ENV: buildEnv,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
