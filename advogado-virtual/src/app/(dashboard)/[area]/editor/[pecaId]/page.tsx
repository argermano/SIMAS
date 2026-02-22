import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { EditorPecaClient } from './EditorPecaClient'
import { ChevronLeft } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string; pecaId: string }>
}) {
  const { area } = await params
  const config = AREAS[area as AreaId]
  return { title: `Editor de Peça — ${config?.nome ?? 'Área'}` }
}

export default async function EditorPecaPage({
  params,
}: {
  params: Promise<{ area: string; pecaId: string }>
}) {
  const { area, pecaId } = await params

  const areaConfig = AREAS[area as AreaId]
  if (!areaConfig || !areaConfig.ativo) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')

  // Carrega a peça com dados do atendimento
  const { data: peca } = await supabase
    .from('pecas')
    .select('id, tipo, area, conteudo_markdown, versao, status, atendimento_id')
    .eq('id', pecaId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!peca) notFound()

  const tipoConfig = TIPOS_PECA[peca.tipo]
  const tipoNome = tipoConfig?.nome ?? peca.tipo.replace(/_/g, ' ')

  return (
    <>
      <Header
        titulo={tipoNome}
        subtitulo={`${areaConfig.nome} — v${peca.versao} · ${peca.status}`}
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
        <div className="mx-auto max-w-6xl">
          <EditorPecaClient
            pecaId={peca.id}
            atendimentoId={peca.atendimento_id}
            area={peca.area}
            tipo={peca.tipo}
            conteudoInicial={peca.conteudo_markdown ?? ''}
            versaoInicial={peca.versao ?? 1}
            statusInicial={peca.status ?? 'rascunho'}
          />
        </div>
      </main>
    </>
  )
}
