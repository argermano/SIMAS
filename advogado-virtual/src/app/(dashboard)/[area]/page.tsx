import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { PainelArea } from '@/components/area/PainelArea'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { ChevronLeft } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string }>
}) {
  const { area } = await params
  const config = AREAS[area as AreaId]
  return { title: config?.nome ?? 'Área' }
}

export default async function AreaPage({
  params,
}: {
  params: Promise<{ area: string }>
}) {
  const { area } = await params

  // Valida que a área existe e está ativa
  const config = AREAS[area as AreaId]
  if (!config || !config.ativo) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome')
    .eq('auth_user_id', user.id)
    .single()

  return (
    <>
      <Header
        titulo={config.nome}
        subtitulo="Peças, modelos e análise jurídica com IA"
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
        <div className="mx-auto max-w-5xl">
          <PainelArea area={config} />
        </div>
      </main>
    </>
  )
}
