import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/atendimentos/[id]/audio-url — retorna URLs assinadas para reprodução do áudio
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('audio_url')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimento?.audio_url) {
    return NextResponse.json({ urls: [] })
  }

  // Parseia array de paths (suporta string simples legada)
  let paths: string[] = []
  try {
    const parsed = JSON.parse(atendimento.audio_url)
    paths = Array.isArray(parsed) ? parsed : [atendimento.audio_url]
  } catch {
    paths = [atendimento.audio_url]
  }

  // Gera URLs assinadas com validade de 2 horas
  const resultados = await Promise.all(
    paths.map(path => supabase.storage.from('documentos').createSignedUrl(path, 7200))
  )

  const urls = resultados
    .map(r => r.data?.signedUrl)
    .filter((u): u is string => !!u)

  return NextResponse.json({ urls })
}
