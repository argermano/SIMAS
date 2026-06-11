import { NextResponse } from 'next/server'

// GET /api/version — endpoint público de health/versão.
// Permite confirmar qual build está no ar (sem login). Não expõe segredos.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({
    sha:       process.env.NEXT_PUBLIC_BUILD_SHA  ?? 'local',
    env:       process.env.NEXT_PUBLIC_BUILD_ENV  ?? 'development',
    buildTime: process.env.NEXT_PUBLIC_BUILD_TIME ?? null,
  })
}
