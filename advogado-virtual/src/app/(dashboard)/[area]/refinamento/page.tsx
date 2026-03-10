import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { TelaRefinamento } from '@/components/atendimento/TelaRefinamento'
import { ChevronLeft } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string }>
}) {
  const { area } = await params
  const config = AREAS[area as AreaId]
  return { title: `Refinamento de Peça — ${config?.nome ?? 'Área'}` }
}

export default async function RefinamentoPage({
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
    .select('id, nome, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  return (
    <>
      <Header
        titulo="Refinamento de Peça"
        subtitulo={`${areaConfig.nome} — Envie sua peça e documentos para a IA refinar`}
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link
            href={`/${area}`}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {areaConfig.nome}
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <TelaRefinamento
            area={area}
            areaNome={areaConfig.nome}
            tenantId={usuario.tenant_id}
            userId={usuario.id}
            roleUsuario={usuario.role ?? 'advogado'}
            tiposDocumento={[...areaConfig.tipos_documento]}
          />
        </div>
      </main>
    </>
  )
}
