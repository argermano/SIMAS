import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { EditorPecaClient } from './EditorPecaClient'
import type { ValidacaoData } from '@/components/pecas/RelatorioValidacao'
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

  // Carrega a peça com dados do atendimento (inclui cliente p/ voltar à Casa do caso)
  const { data: peca } = await supabase
    .from('pecas')
    .select('id, tipo, area, conteudo_markdown, versao, status, atendimento_id, validacao_coerencia, validacao_fontes, atendimentos(cliente_id)')
    .eq('id', pecaId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!peca) notFound()

  // Reconstrói a revisão automática persistida (validarPecaPosStream) para o
  // editor abrir com o badge/painel prontos, sem re-chamar a IA.
  const vf = peca.validacao_fontes as {
    legislacao?: ValidacaoData['legislacao']
    jurisprudencia?: ValidacaoData['jurisprudencia']
    score?: number
    correcoes?: ValidacaoData['correcoes_sugeridas']
    formatacao?: ValidacaoData['formatacao']
    citacoes?: ValidacaoData['citacoes']
  } | null
  const validacaoInicial: ValidacaoData | null = (peca.validacao_coerencia || vf) ? {
    coerencia: (peca.validacao_coerencia as ValidacaoData['coerencia']) ?? undefined,
    score_confianca: vf?.score,
    legislacao: vf?.legislacao,
    jurisprudencia: vf?.jurisprudencia,
    correcoes_sugeridas: vf?.correcoes,
    formatacao: vf?.formatacao,
    citacoes: vf?.citacoes,
  } : null

  const tipoConfig = TIPOS_PECA[peca.tipo]
  const tipoNome = tipoConfig?.nome ?? peca.tipo.replace(/_/g, ' ')

  // Resolve o cliente do caso (relação 1:N pode vir como objeto ou array)
  const atRel = peca.atendimentos as unknown as { cliente_id?: string } | { cliente_id?: string }[] | null
  const clienteId = Array.isArray(atRel) ? atRel[0]?.cliente_id : atRel?.cliente_id
  const hrefVoltar = peca.atendimento_id && clienteId
    ? `/clientes/${clienteId}/casos/${peca.atendimento_id}`
    : `/${area}`
  const labelVoltar = peca.atendimento_id && clienteId ? 'Voltar ao caso' : areaConfig.nome

  return (
    <>
      <Header
        titulo={tipoNome}
        subtitulo={`${areaConfig.nome} — v${peca.versao} · ${peca.status}`}
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link
            href={hrefVoltar}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {labelVoltar}
          </Link>
        }
      />

      <main className="flex-1 overflow-hidden">
        <EditorPecaClient
          pecaId={peca.id}
          atendimentoId={peca.atendimento_id ?? ''}
          clienteId={clienteId}
          area={peca.area}
          tipo={peca.tipo}
          tipoNome={tipoNome}
          conteudoInicial={peca.conteudo_markdown ?? ''}
          versaoInicial={peca.versao ?? 1}
          statusInicial={peca.status ?? 'rascunho'}
          validacaoInicial={validacaoInicial}
        />
      </main>
    </>
  )
}
