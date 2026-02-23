import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { AnaliseCasoClient } from './AnaliseCasoClient'
import { ChevronLeft } from 'lucide-react'

export const metadata = { title: 'Análise de Caso' }

export default async function AnaliseCasoPage({
  searchParams,
}: {
  searchParams: Promise<{ atendimentoId?: string }>
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome')
    .eq('auth_user_id', user.id)
    .single()

  const { atendimentoId } = await searchParams

  return (
    <>
      <Header
        titulo="Análise de Caso"
        subtitulo="Descreva o caso e a IA identifica a(s) área(s) jurídica(s) e orienta os próximos passos"
        nomeUsuario={usuario?.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link
            href="/dashboard"
            className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
            Início
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <AnaliseCasoClient atendimentoIdInicial={atendimentoId} />
        </div>
      </main>
    </>
  )
}
