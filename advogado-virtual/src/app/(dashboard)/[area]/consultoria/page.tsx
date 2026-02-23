import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { ConsultoriaClient } from './ConsultoriaClient'
import { ChevronLeft } from 'lucide-react'

const SUBTITULOS: Record<string, string> = {
  caso_novo:  'Análise jurídica completa — caminhos, riscos e estratégia',
  parecer:    'Opinião fundamentada sobre tese ou situação jurídica',
  estrategia: 'Plano de ação e sequência de medidas para o caso',
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string }>
}) {
  const { area } = await params
  const config = AREAS[area as AreaId]
  return { title: `Consultoria IA — ${config?.nome ?? 'Área'}` }
}

export default async function ConsultoriaPage({
  params,
  searchParams,
}: {
  params: Promise<{ area: string }>
  searchParams: Promise<{ tipo?: string; atendimentoId?: string }>
}) {
  const { area } = await params
  const { tipo, atendimentoId } = await searchParams

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

  const tipoConsultoria = tipo && ['parecer', 'estrategia'].includes(tipo) ? tipo : 'caso_novo'
  const subtitulo = SUBTITULOS[tipoConsultoria]

  return (
    <>
      <Header
        titulo="Consultoria / Análise IA"
        subtitulo={`${areaConfig.nome} — ${subtitulo}`}
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
          <ConsultoriaClient
            area={area}
            tiposDocumento={[...areaConfig.tipos_documento]}
            tipoConsultoria={tipoConsultoria}
            atendimentoIdInicial={atendimentoId}
          />
        </div>
      </main>
    </>
  )
}
