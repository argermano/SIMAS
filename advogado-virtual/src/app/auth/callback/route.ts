import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /auth/callback — troca o code PKCE por uma sessão (convite e reset de senha)
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)

  const code = searchParams.get('code')

  // Open redirect: `next` só pode ser um caminho relativo interno. Precisa
  // começar com '/', não pode começar com '//' (URL protocol-relative) nem
  // conter ':' (esquema/host absoluto). Caso contrário, cai no destino padrão.
  const nextParam = searchParams.get('next') ?? '/definir-senha'
  const next =
    nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.includes(':')
      ? nextParam
      : '/definir-senha'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Código ausente ou inválido — redireciona para definir-senha com indicação de erro
  return NextResponse.redirect(`${origin}/definir-senha?erro=link_invalido`)
}
