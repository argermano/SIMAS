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
  searchParams,
}: {
  params: Promise<{ area: string; tipoPeca: string }>
  searchParams: Promise<{ nome?: string }>
}) {
  const { area, tipoPeca } = await params
  const areaConfig = AREAS[area as AreaId]

  // Peça personalizada ("Outra…"): o título vem do nome digitado (searchParam)
  if (tipoPeca === 'outra') {
    const { nome } = await searchParams
    const nomeLimpo = (nome ?? '').trim()
    return {
      title: nomeLimpo ? `${nomeLimpo} — ${areaConfig?.nome ?? 'Área'}` : 'Nova Peça',
    }
  }

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
  searchParams: Promise<{ id?: string; clienteId?: string; nome?: string }>
}) {
  const { area, tipoPeca } = await params
  const { id: atendimentoIdParam, clienteId: clienteIdParam, nome: nomeParam } = await searchParams

  const areaConfig = AREAS[area as AreaId]
  if (!areaConfig || !areaConfig.ativo) notFound()

  // Slug reservado "outra": peça personalizada digitada pelo advogado (fora do catálogo).
  // O `tipo` passado à tela é o próprio texto — flui ao gerar-peca (prompt genérico)
  // e fica legível em pecas.tipo. Exige `nome` válido (3..80 após trim).
  const outra = tipoPeca === 'outra'
  const nomeDigitado = (nomeParam ?? '').trim()
  if (outra && (nomeDigitado.length < 3 || nomeDigitado.length > 80)) notFound()

  let tipoParaTela: string
  let tipoPecaNome: string
  let subtitulo: string
  if (outra) {
    tipoParaTela = nomeDigitado
    tipoPecaNome = nomeDigitado
    subtitulo = `${areaConfig.nome} — peça personalizada`
  } else {
    const pecaConfig = TIPOS_PECA[tipoPeca]
    if (!pecaConfig) notFound()
    // Verifica se o tipo de peça pertence a esta área
    if (!(areaConfig.pecas as readonly string[]).includes(tipoPeca)) notFound()
    tipoParaTela = tipoPeca
    tipoPecaNome = pecaConfig.nome
    subtitulo = `${areaConfig.nome} — ${pecaConfig.descricao}`
  }

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
        titulo={tipoPecaNome}
        subtitulo={subtitulo}
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
          <TelaAtendimento
            area={area}
            tipoPeca={tipoParaTela}
            tipoPecaNome={tipoPecaNome}
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
