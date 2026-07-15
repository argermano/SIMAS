import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Header } from '@/components/layout/Header'
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
        acoes={
          <Link
            href="/atendimentos/novo"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Novo atendimento
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          <AtendimentosClient />
        </div>
      </main>
    </>
  )
}
