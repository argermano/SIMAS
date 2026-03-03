import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { MODELOS_PRONTOS } from '@/lib/constants/tipos-peca'
import { ModeloProntoClient } from './ModeloProntoClient'
import { ChevronLeft } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string; modeloId: string }>
}) {
  const { area, modeloId } = await params
  const areaConfig = AREAS[area as AreaId]
  const modelo = MODELOS_PRONTOS[modeloId]
  return {
    title: modelo
      ? `${modelo.nome} — ${areaConfig?.nome ?? 'Área'}`
      : 'Modelo',
  }
}

export default async function ModeloProntoPage({
  params,
  searchParams,
}: {
  params: Promise<{ area: string; modeloId: string }>
  searchParams: Promise<{ clienteId?: string }>
}) {
  const { area, modeloId } = await params
  const { clienteId: clienteIdParam } = await searchParams

  const areaConfig = AREAS[area as AreaId]
  if (!areaConfig || !areaConfig.ativo) notFound()

  const modelo = MODELOS_PRONTOS[modeloId]
  if (!modelo) notFound()

  if (!(areaConfig.modelos as readonly string[]).includes(modeloId)) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  return (
    <>
      <Header
        titulo={modelo.nome}
        subtitulo={`${areaConfig.nome} — ${modelo.descricao}`}
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
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
          <ModeloProntoClient
            tipo={modeloId}
            tipoNome={modelo.nome}
            clienteIdInicial={clienteIdParam}
          />
        </div>
      </main>
    </>
  )
}
