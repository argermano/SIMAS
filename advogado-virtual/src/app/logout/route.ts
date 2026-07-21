import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /logout — encerra a sessão do Supabase (limpa os cookies) e volta ao /login.
// Um route handler pode gravar cookies (o Server Component do layout não pode), então é
// aqui que a sessão é de fato invalidada. Usado pelo layout do dashboard ao detectar
// conta desativada: redirecionar direto ao /login entraria em loop com o middleware, que
// devolve usuário autenticado ao dashboard — só depois de limpar a sessão o /login "gruda".
export async function GET(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url))
}
