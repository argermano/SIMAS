import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { AberturaClient } from './AberturaClient'
import { ChevronLeft } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string }>
}) {
  const { area } = await params
  const config = AREAS[area as AreaId]
  return { title: `Abertura de Caso — ${config?.nome ?? 'Área'}` }
}

export default async function AberturaPage({
  params,
}: {
  params: Promise<{ area: string }>
}) {
  const { area } = await params

  const areaConfig = AREAS[area as AreaId]
  if (!areaConfig || !areaConfig.ativo) notFound()

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
        titulo="Abertura de Caso"
        subtitulo={`${areaConfig.nome} — Classificação do serviço e checklist de documentos`}
        nomeUsuario={usuario?.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link
            href={`/${area}`}
            className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
            {areaConfig.nome}
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <AberturaClient area={area} areaNome={areaConfig.nome} />
        </div>
      </main>
    </>
  )
}
