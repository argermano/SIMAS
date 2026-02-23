import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { TelaAtendimento } from '@/components/atendimento/TelaAtendimento'
import { ChevronLeft } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string; tipoPeca: string }>
}) {
  const { area, tipoPeca } = await params
  const areaConfig = AREAS[area as AreaId]
  const pecaConfig = TIPOS_PECA[tipoPeca]
  return {
    title: pecaConfig
      ? `${pecaConfig.nome} — ${areaConfig?.nome ?? 'Área'}`
      : 'Novo Atendimento',
  }
}

export default async function NovaPecaPage({
  params,
  searchParams,
}: {
  params: Promise<{ area: string; tipoPeca: string }>
  searchParams: Promise<{ id?: string; clienteId?: string }>
}) {
  const { area, tipoPeca } = await params
  const { id: atendimentoIdParam, clienteId: clienteIdParam } = await searchParams

  const areaConfig = AREAS[area as AreaId]
  if (!areaConfig || !areaConfig.ativo) notFound()

  const pecaConfig = TIPOS_PECA[tipoPeca]
  if (!pecaConfig) notFound()

  // Verifica se o tipo de peça pertence a esta área
  if (!(areaConfig.pecas as readonly string[]).includes(tipoPeca)) notFound()

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
        titulo={pecaConfig.nome}
        subtitulo={`${areaConfig.nome} — ${pecaConfig.descricao}`}
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
          <TelaAtendimento
            area={area}
            tipoPeca={tipoPeca}
            tipoPecaNome={pecaConfig.nome}
            tenantId={usuario.tenant_id}
            userId={usuario.id}
            roleUsuario={usuario.role ?? 'advogado'}
            tiposDocumento={[...areaConfig.tipos_documento]}
            atendimentoIdInicial={atendimentoIdParam}
            clienteIdInicial={clienteIdParam}
          />
        </div>
      </main>
    </>
  )
}
