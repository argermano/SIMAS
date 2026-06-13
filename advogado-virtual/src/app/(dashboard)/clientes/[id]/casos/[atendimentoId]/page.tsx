import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PecasPorArea } from '@/components/atendimento/PecasPorArea'
import { DocumentoLink } from '@/components/clientes/DocumentoLink'
import { AREAS } from '@/lib/constants/areas'
import { MODELOS_PRONTOS, TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { formatarDataHora, formatarDataRelativa } from '@/lib/utils'
import {
  Brain, ChevronLeft, ChevronDown, ScrollText, FilePlus, FileText, FileSignature,
  AlertTriangle, Clock, CheckCircle, ArrowRight, History,
} from 'lucide-react'
import type { ResultadoAnaliseGeral } from '@/app/api/ia/analise-geral/route'

export const metadata = { title: 'Caso' }
export const dynamic = 'force-dynamic'

const BADGE_STATUS: Record<string, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  caso_novo:   { variant: 'warning',   label: 'Caso novo'   },
  peca_gerada: { variant: 'secondary', label: 'Peça gerada' },
  finalizado:  { variant: 'success',   label: 'Finalizado'  },
}

const URGENCIA: Record<string, { cor: string; label: string; Icone: typeof AlertTriangle }> = {
  alta:  { cor: 'text-destructive', label: 'Urgência alta',  Icone: AlertTriangle },
  media: { cor: 'text-amber-600',   label: 'Urgência média', Icone: Clock },
  baixa: { cor: 'text-success',     label: 'Urgência baixa', Icone: CheckCircle },
}

const areaMeta = (id: string) =>
  (AREAS as Record<string, { nome: string; corBg: string; corTexto: string; modelos: readonly string[]; pecas: readonly string[] }>)[id]

export default async function CasoPage({
  params,
}: {
  params: Promise<{ id: string; atendimentoId: string }>
}) {
  const { id, atendimentoId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')

  const { data: at } = await supabase
    .from('atendimentos')
    .select('id, area, status, created_at, clientes(id, nome), analises(id, plano_a, created_at), pecas(id, tipo, area, versao, status, created_at), documentos(id, file_name, tipo, created_at)')
    .eq('id', atendimentoId)
    .eq('cliente_id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!at) notFound()

  const { data: contratos } = await supabase
    .from('contratos_honorarios')
    .select('id, titulo, status, area, created_at')
    .eq('atendimento_id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })

  const cliente = at.clientes as unknown as { id: string; nome: string } | null
  const analiseRow = (at.analises as Array<{ id: string; plano_a: ResultadoAnaliseGeral; created_at: string }> | null)?.[0] ?? null
  const analise = analiseRow?.plano_a ?? null
  const areasIdent = analise?.areas_identificadas ?? []
  const pecas = (at.pecas ?? []) as Array<{ id: string; tipo: string; area: string; versao: number; status: string; created_at: string }>
  const documentos = (at.documentos ?? []) as Array<{ id: string; file_name: string; tipo: string; created_at: string }>
  const status = at.status as string
  const badge = BADGE_STATUS[status] ?? BADGE_STATUS.caso_novo

  // Linha do tempo do caso — andamento derivado dos eventos (estudo, peças, contratos, documentos)
  type Evento = { quando: string; tipo: 'estudo' | 'peca' | 'contrato' | 'documento'; titulo: string; href?: string }
  const eventos: Evento[] = [
    ...(analiseRow ? [{ quando: analiseRow.created_at, tipo: 'estudo' as const, titulo: 'Estudo de caso', href: `/analise-caso?atendimentoId=${atendimentoId}` }] : []),
    ...pecas.map((p) => {
      const m = areaMeta(p.area)
      return {
        quando: p.created_at,
        tipo: 'peca' as const,
        titulo: `Peça — ${TIPOS_PECA[p.tipo]?.nome ?? p.tipo}${m ? ` (${m.nome})` : ''}`,
        href: `/${p.area}/editor/${p.id}`,
      }
    }),
    ...((contratos ?? []) as Array<{ id: string; titulo: string; created_at: string }>).map((c) => ({
      quando: c.created_at,
      tipo: 'contrato' as const,
      titulo: `Contrato — ${c.titulo}`,
      href: `/contratos/${c.id}`,
    })),
    ...documentos.map((d) => ({ quando: d.created_at, tipo: 'documento' as const, titulo: d.file_name })),
  ].sort((x, y) => new Date(y.quando).getTime() - new Date(x.quando).getTime())

  const ICONE_EVENTO = { estudo: Brain, peca: ScrollText, contrato: FileSignature, documento: FileText } as const

  // Área principal (p/ os modelos): da análise, senão da 1ª peça, senão a do caso; fallback cível
  const areaPrincipalRaw = areasIdent.find((a) => a.relevancia === 'principal')?.area
    ?? areasIdent[0]?.area
    ?? pecas[0]?.area
    ?? (at.area !== 'geral' ? at.area : 'civel')
  const areaPrincipal = areaMeta(areaPrincipalRaw) ? areaPrincipalRaw : 'civel'
  const modelosArea = areaMeta(areaPrincipal)?.modelos ?? []

  // Áreas para "Gerar peça": da análise; se não houver, a área do caso
  const areasParaGerar = areasIdent.length > 0
    ? areasIdent.map((a) => ({ area: a.area, nome: a.nome, principal: a.relevancia === 'principal' }))
    : at.area !== 'geral'
      ? [{ area: at.area, nome: areaMeta(at.area)?.nome ?? at.area, principal: true }]
      : []

  return (
    <>
      <Header
        titulo="Caso"
        subtitulo={`Cliente: ${cliente?.nome ?? '—'} · ${badge.label} · ${formatarDataHora(at.created_at)}`}
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link href={`/clientes/${id}`} className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Cliente
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">

          {/* Estudo de Caso */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Brain className="h-5 w-5 text-primary" />
                Estudo de Caso
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analise ? (
                <div className="space-y-3">
                  {analise.urgencia && (() => {
                    const u = URGENCIA[analise.urgencia] ?? URGENCIA.media
                    return (
                      <p className={`flex items-center gap-1.5 text-sm font-semibold ${u.cor}`}>
                        <u.Icone className="h-4 w-4" /> {u.label}
                      </p>
                    )
                  })()}
                  {analise.resumo_caso && <p className="text-sm text-muted-foreground">{analise.resumo_caso}</p>}
                  <Link href={`/analise-caso?atendimentoId=${atendimentoId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                    Ver / editar estudo <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-sm text-muted-foreground">Este caso ainda não tem um estudo. Um estudo ajuda a identificar as áreas e as peças necessárias.</p>
                  <Link href={`/analise-caso?atendimentoId=${atendimentoId}`} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors">
                    <Brain className="h-4 w-4" /> Fazer estudo de caso
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Linha do tempo (andamento do caso) */}
          {eventos.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <History className="h-5 w-5 text-muted-foreground" />
                  Linha do tempo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="relative space-y-3 border-l border-border pl-5">
                  {eventos.map((ev, i) => {
                    const Icone = ICONE_EVENTO[ev.tipo]
                    const conteudo = (
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 min-w-0">
                          <Icone className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm text-foreground">{ev.titulo}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatarDataRelativa(ev.quando)}</span>
                      </span>
                    )
                    return (
                      <li key={`${ev.tipo}-${ev.quando}-${i}`} className="relative">
                        <span className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary/60" />
                        {ev.href ? (
                          <Link href={ev.href} className="block rounded-md px-2 py-1 hover:bg-muted/50 transition-colors">
                            {conteudo}
                          </Link>
                        ) : (
                          <span className="block px-2 py-1">{conteudo}</span>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </CardContent>
            </Card>
          )}

          {/* Gerar peça (por área) — escolha o tipo e gere com o contexto do caso */}
          {areasParaGerar.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FilePlus className="h-5 w-5 text-muted-foreground" />
                  Gerar peça
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {areasParaGerar.map((a) => {
                  const m = areaMeta(a.area)
                  const pecasArea = m?.pecas ?? []
                  return (
                    <details key={a.area} className="group rounded-lg border bg-card">
                      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors [&::-webkit-details-marker]:hidden">
                        <span className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${m?.corBg ?? 'bg-muted'} ${m?.corTexto ?? 'text-muted-foreground'}`}>
                            {m?.nome ?? a.nome}
                          </span>
                          {a.principal && <span className="text-xs text-muted-foreground">principal</span>}
                        </span>
                        <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                          Gerar peça <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                        </span>
                      </summary>
                      <div className="space-y-2 border-t px-3 py-3">
                        {pecasArea.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {pecasArea.map((tipo) => (
                              <Link
                                key={tipo}
                                href={`/${a.area}/pecas/${tipo}?id=${atendimentoId}`}
                                className="rounded-lg border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:border-primary/30 hover:bg-primary/10 transition-colors"
                              >
                                {TIPOS_PECA[tipo]?.nome ?? tipo}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">Sem peças mapeadas para esta área.</p>
                        )}
                        <Link
                          href={`/${a.area}/consultoria?atendimentoId=${atendimentoId}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary"
                        >
                          ou aprofundar análise (parecer) <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </details>
                  )
                })}
              </CardContent>
            </Card>
          )}

          {/* Peças geradas */}
          {pecas.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ScrollText className="h-5 w-5 text-emerald-500" />
                  Peças do caso
                  <span className="ml-1 text-xs font-normal text-muted-foreground">({pecas.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PecasPorArea pecas={pecas} areaAtual={at.area} />
              </CardContent>
            </Card>
          )}

          {/* Contratos */}
          {contratos && contratos.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileSignature className="h-5 w-5 text-blue-500" />
                  Contratos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {contratos.map((c) => (
                  <Link key={c.id} href={`/contratos/${c.id}`} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors group">
                    <span className="flex items-center gap-2 min-w-0">
                      <FileSignature className="h-4 w-4 text-blue-500 shrink-0" />
                      <span className="truncate font-medium text-foreground">{c.titulo}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Documentos do caso */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-muted-foreground" />
                Documentos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Gerar */}
              {cliente && modelosArea.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Gerar documentos</p>
                  <div className="flex flex-wrap gap-2">
                    {modelosArea.map((modeloId) => {
                      const nome = MODELOS_PRONTOS[modeloId]?.nome ?? modeloId
                      const href = modeloId === 'contrato_honorarios'
                        ? `/contratos/novo?cliente_id=${cliente.id}&atendimentoId=${atendimentoId}`
                        : `/${areaPrincipal}/modelos/${modeloId}?clienteId=${cliente.id}&atendimentoId=${atendimentoId}`
                      return (
                        <Link key={modeloId} href={href} className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">
                          <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                          {nome}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Anexos */}
              {documentos.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Documentos anexados</p>
                  {documentos.map((d) => (
                    <DocumentoLink key={d.id} docId={d.id} fileName={d.file_name} dataRelativa={formatarDataRelativa(d.created_at)} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Nenhum documento anexado.</p>
              )}
            </CardContent>
          </Card>

        </div>
      </main>
    </>
  )
}
