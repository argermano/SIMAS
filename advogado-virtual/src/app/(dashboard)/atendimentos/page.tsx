import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { NovoAtendimentoGlobalButton } from '@/components/atendimento/NovoAtendimentoModal'
import { AtendimentosClient } from './AtendimentosClient'

export const metadata = { title: 'Atendimentos' }
export const dynamic = 'force-dynamic'

// Lista GLOBAL de atendimentos/casos do tenant (menu novo, 057). A busca, os
// filtros e a paginação são client-side (GET /api/atendimentos) — a página só
// resolve auth + shell.
export default async function AtendimentosPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')

  return (
    <>
      <Header
        titulo="Atendimentos"
        subtitulo="Todos os atendimentos e casos do escritório"
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={<NovoAtendimentoGlobalButton />}
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          <AtendimentosClient />
        </div>
      </main>
    </>
  )
}
