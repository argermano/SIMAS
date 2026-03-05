import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ClienteAcoesClient } from './ClienteAcoesClient'
import { BotaoExcluirAtendimento } from '@/components/atendimento/BotaoExcluirAtendimento'
import { BotaoExcluirPeca } from '@/components/pecas/BotaoExcluirPeca'
import { BotaoExcluirContrato } from '@/components/contratos/BotaoExcluirContrato'
import { DocumentoLink } from '@/components/clientes/DocumentoLink'
import { PlayerAudio } from '@/components/atendimento/PlayerAudio'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import {
  Phone, Mail, MapPin, FileText, Plus,
  Calendar, User, StickyNote, ChevronRight, ChevronLeft,
  Brain, ScrollText, Paperclip, Download,
  CheckCircle2, Clock, Edit3, FileCheck, Briefcase, Heart,
  FileSignature,
} from 'lucide-react'
import { formatarData, formatarDataRelativa, formatarDataHora, mascaraCPF, cn } from '@/lib/utils'
import type { AtendimentoStatus } from '@/types'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('clientes')
    .select('nome')
    .eq('id', id)
    .single()
  return { title: data?.nome ?? 'Cliente' }
}

const BADGE_STATUS: Record<AtendimentoStatus, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  caso_novo:   { variant: 'warning',   label: 'Caso Novo'   },
  peca_gerada: { variant: 'secondary', label: 'Peça Gerada' },
  finalizado:  { variant: 'success',   label: 'Finalizado'  },
}

const BADGE_PECA_STATUS: Record<string, { variant: 'success' | 'warning' | 'secondary' | 'default'; label: string }> = {
  rascunho:           { variant: 'warning',   label: 'Rascunho'           },
  revisada:           { variant: 'secondary', label: 'Revisada'           },
  aprovada:           { variant: 'success',   label: 'Aprovada'           },
  exportada:          { variant: 'default',   label: 'Exportada'          },
  aguardando_revisao: { variant: 'warning',   label: 'Aguardando Revisão' },
  rejeitada:          { variant: 'default',   label: 'Rejeitada'          },
}

const BADGE_ANALISE_STATUS: Record<string, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  gerada:   { variant: 'warning',   label: 'Gerada'   },
  revisada: { variant: 'secondary', label: 'Revisada' },
  aprovada: { variant: 'success',   label: 'Aprovada' },
}

const BADGE_CONTRATO_STATUS: Record<string, { variant: 'success' | 'warning' | 'secondary' | 'default'; label: string }> = {
  rascunho:   { variant: 'warning',   label: 'Rascunho'   },
  em_revisao: { variant: 'secondary', label: 'Em revisão' },
  aprovado:   { variant: 'success',   label: 'Aprovado'   },
  exportado:  { variant: 'default',   label: 'Exportado'  },
}

const LABELS_AREA: Record<string, string> = {
  previdenciario: 'Previdenciário',
  civel:          'Cível',
  trabalhista:    'Trabalhista',
  criminal:       'Criminal',
  geral:          'Análise de Caso',
}

const ICONES_AREA: Record<string, string> = {
  previdenciario: 'rose',
  trabalhista:    'amber',
  civel:          'emerald',
  criminal:       'red',
  geral:          'violet',
}

function hrefAtendimento(at: { area: string; tipo_peca_origem?: string | null; id: string }): string {
  if (at.area === 'geral') return `/analise-caso?atendimentoId=${at.id}`
  if (at.tipo_peca_origem) return `/${at.area}/pecas/${at.tipo_peca_origem}?id=${at.id}`
  return `/${at.area}`
}

type Filtro = 'atendimentos' | 'analises' | 'pecas' | 'documentos' | 'contratos' | null

export default async function DossieClientePage({
  params,
  searchParams,
}: {
  params:       Promise<{ id: string }>
  searchParams: Promise<{ filtro?: string }>
}) {
  const { id }              = await params
  const { filtro: filtroRaw } = await searchParams
  const filtro = (filtroRaw ?? null) as Filtro

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!cliente) notFound()

  const { data: atendimentos } = await supabase
    .from('atendimentos')
    .select('id, status, area, tipo_peca_origem, created_at, pedidos_especificos, modo_input, audio_url')
    .eq('cliente_id', id)
    .order('created_at', { ascending: false })

  const atendimentoIds = (atendimentos ?? []).map(a => a.id)

  const [analises, pecas, documentos, todosDocumentosCliente, contratos] = await Promise.all([
    atendimentoIds.length > 0
      ? supabase
          .from('analises')
          .select('id, atendimento_id, status, resumo_fatos, tese_principal, created_at')
          .in('atendimento_id', atendimentoIds)
      : Promise.resolve({ data: [] }),
    atendimentoIds.length > 0
      ? supabase
          .from('pecas')
          .select('id, atendimento_id, tipo, area, versao, status, created_at')
          .in('atendimento_id', atendimentoIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    atendimentoIds.length > 0
      ? supabase
          .from('documentos')
          .select('id, atendimento_id, tipo, file_name')
          .in('atendimento_id', atendimentoIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from('documentos')
      .select('id, atendimento_id, tipo, file_name, created_at')
      .eq('cliente_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('contratos_honorarios')
      .select('id, titulo, status, area, atendimento_id, valor_fixo, percentual_exito, created_at')
      .eq('cliente_id', id)
      .eq('tenant_id', usuario.tenant_id)
      .order('created_at', { ascending: false }),
  ])

  const analisesPorAtendimento = new Map<string, typeof analises.data>()
  for (const a of analises.data ?? []) {
    const lista = analisesPorAtendimento.get(a.atendimento_id) ?? []
    lista.push(a)
    analisesPorAtendimento.set(a.atendimento_id, lista)
  }

  const pecasPorAtendimento = new Map<string, typeof pecas.data>()
  for (const p of pecas.data ?? []) {
    const lista = pecasPorAtendimento.get(p.atendimento_id) ?? []
    lista.push(p)
    pecasPorAtendimento.set(p.atendimento_id, lista)
  }

  const docsPorAtendimento = new Map<string, number>()
  for (const d of documentos.data ?? []) {
    docsPorAtendimento.set(d.atendimento_id, (docsPorAtendimento.get(d.atendimento_id) ?? 0) + 1)
  }

  const contratosList = contratos.data ?? []

  const contratosPorAtendimento = new Map<string, typeof contratosList>()
  for (const c of contratosList) {
    if (!c.atendimento_id) continue
    const lista = contratosPorAtendimento.get(c.atendimento_id) ?? []
    lista.push(c)
    contratosPorAtendimento.set(c.atendimento_id, lista)
  }

  const totalAtendimentos = atendimentos?.length ?? 0
  const totalPecas        = pecas.data?.length ?? 0
  const totalAnalises     = analises.data?.length ?? 0
  const totalDocumentos   = documentos.data?.length ?? 0
  const totalContratos    = contratosList.length

  // null = sem filtro (mostra tudo); filtro X = mostra só X
  const mostrar = (secao: Filtro) => !filtro || filtro === secao

  return (
    <>
      <Header
        titulo={cliente.nome}
        subtitulo="Dossiê do cliente"
        acoes={
          <div className="flex items-center gap-3">
            <Link
              href="/clientes"
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              Clientes
            </Link>
            <ClienteAcoesClient clienteId={id} clienteNome={cliente.nome} />
            <Button asChild size="md">
              <Link href={`/clientes/${id}/atendimentos/novo`}>
                <Plus className="h-4 w-4" />
                Novo Atendimento
              </Link>
            </Button>
          </div>
        }
        nomeUsuario={usuario.nome}
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">

          {/* Dados do cliente */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Dados pessoais</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {cliente.cpf && <DadoItem icone={<User className="h-4 w-4" />} label="CPF" valor={mascaraCPF(cliente.cpf)} />}
                {cliente.rg && <DadoItem icone={<User className="h-4 w-4" />} label="RG" valor={cliente.rg} />}
                {cliente.estado_civil && <DadoItem icone={<Heart className="h-4 w-4" />} label="Estado civil" valor={cliente.estado_civil} />}
                {cliente.profissao && <DadoItem icone={<Briefcase className="h-4 w-4" />} label="Profissão" valor={cliente.profissao} />}
                {cliente.telefone && <DadoItem icone={<Phone className="h-4 w-4" />} label="Telefone" valor={cliente.telefone} link={`tel:${cliente.telefone.replace(/\D/g, '')}`} />}
                {cliente.email && <DadoItem icone={<Mail className="h-4 w-4" />} label="E-mail" valor={cliente.email} link={`mailto:${cliente.email}`} />}
                {cliente.endereco && <DadoItem icone={<MapPin className="h-4 w-4" />} label="Endereço" valor={cliente.endereco} className="sm:col-span-2" />}
                {cliente.bairro && <DadoItem icone={<MapPin className="h-4 w-4" />} label="Bairro" valor={cliente.bairro} />}
                {cliente.cep && <DadoItem icone={<MapPin className="h-4 w-4" />} label="CEP" valor={cliente.cep} />}
                {(cliente.cidade || cliente.estado) && (
                  <DadoItem icone={<MapPin className="h-4 w-4" />} label="Cidade/Estado" valor={[cliente.cidade, cliente.estado].filter(Boolean).join(' / ')} />
                )}
                <DadoItem icone={<Calendar className="h-4 w-4" />} label="Cliente desde" valor={formatarData(cliente.created_at)} />
                {!cliente.cpf && !cliente.rg && !cliente.telefone && !cliente.email && !cliente.endereco && !cliente.profissao && (
                  <p className="col-span-2 text-sm text-muted-foreground italic">
                    Nenhum dado de contato cadastrado.{' '}
                    <Link href={`/clientes/${id}/editar`} className="text-primary hover:underline">Adicionar dados</Link>
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <StickyNote className="h-4 w-4 text-amber-500" />
                  Observações internas
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cliente.notas ? (
                  <p className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">{cliente.notas}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    Nenhuma observação.{' '}
                    <Link href={`/clientes/${id}/editar`} className="text-primary hover:underline">Adicionar</Link>
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Barra de resumo + filtros ── */}
          {totalAtendimentos > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              <ResumoCard href={`/clientes/${id}${filtro === 'atendimentos' ? '' : '?filtro=atendimentos'}`} icone={<FileText className="h-5 w-5" />} label="Atendimentos" valor={totalAtendimentos} cor="primary" ativo={filtro === 'atendimentos'} />
              <ResumoCard href={`/clientes/${id}${filtro === 'analises'     ? '' : '?filtro=analises'}`}     icone={<Brain className="h-5 w-5" />}         label="Análises IA"    valor={totalAnalises}     cor="violet"  ativo={filtro === 'analises'}     />
              <ResumoCard href={`/clientes/${id}${filtro === 'pecas'        ? '' : '?filtro=pecas'}`}        icone={<ScrollText className="h-5 w-5" />}    label="Peças geradas"  valor={totalPecas}        cor="emerald" ativo={filtro === 'pecas'}        />
              <ResumoCard href={`/clientes/${id}${filtro === 'documentos'   ? '' : '?filtro=documentos'}`}   icone={<Paperclip className="h-5 w-5" />}     label="Documentos"     valor={totalDocumentos}   cor="amber"   ativo={filtro === 'documentos'}   />
              <ResumoCard href={`/clientes/${id}${filtro === 'contratos'    ? '' : '?filtro=contratos'}`}    icone={<FileSignature className="h-5 w-5" />} label="Contratos"      valor={totalContratos}    cor="blue"    ativo={filtro === 'contratos'}    />
            </div>
          )}

          {/* ── Atendimentos (e análises / peças como sub-items) ── */}
          {mostrar('atendimentos') && !mostrar('contratos') || (mostrar('atendimentos') && mostrar('analises')) || (mostrar('atendimentos') && mostrar('pecas')) || (!filtro || filtro === 'atendimentos' || filtro === 'analises' || filtro === 'pecas') ? (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  {filtro === 'atendimentos' ? 'Atendimentos' :
                   filtro === 'analises'     ? 'Análises IA' :
                   filtro === 'pecas'        ? 'Peças Geradas' : 'Dossiê Completo'}
                </h2>
                <Button asChild variant="secondary" size="md">
                  <Link href={`/clientes/${id}/atendimentos/novo`}>
                    <Plus className="h-4 w-4" />
                    Novo Atendimento
                  </Link>
                </Button>
              </div>

              {!atendimentos || atendimentos.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-8 w-8" />}
                  title="Nenhum atendimento ainda"
                  description="Registre o primeiro atendimento deste cliente para iniciar a análise jurídica."
                  action={{ label: '+ Registrar Atendimento', href: `/clientes/${id}/atendimentos/novo` }}
                />
              ) : (
                <div className="space-y-4">
                  {atendimentos.map((at, idx) => {
                    const status       = at.status as AtendimentoStatus
                    const badge        = BADGE_STATUS[status] ?? BADGE_STATUS.caso_novo
                    const atAnalises   = analisesPorAtendimento.get(at.id) ?? []
                    const atPecas      = pecasPorAtendimento.get(at.id) ?? []
                    const atContratos  = contratosPorAtendimento.get(at.id) ?? []
                    const numDocs      = docsPorAtendimento.get(at.id) ?? 0
                    const corArea    = ICONES_AREA[at.area] ?? 'gray'
                    const isLast     = idx === atendimentos.length - 1

                    // Filtrar por tipo de sub-item
                    if (filtro === 'analises' && atAnalises.length === 0) return null
                    if (filtro === 'pecas'    && atPecas.length === 0)    return null

                    return (
                      <div key={at.id} className="relative">
                        {!isLast && <div className="absolute left-5 top-14 bottom-0 w-px bg-border" />}
                        <div className="relative">
                          <div className={`absolute left-3 top-5 h-4 w-4 rounded-full border-2 border-white shadow-sm ${
                            status === 'finalizado'  ? 'bg-success/60' :
                            status === 'peca_gerada' ? 'bg-blue-400'  : 'bg-amber-400'
                          }`} />
                          <div className="ml-10">
                            <Card className="overflow-hidden">
                              <div className={`border-l-4 ${
                                corArea === 'rose'    ? 'border-l-rose-400'    :
                                corArea === 'amber'   ? 'border-l-amber-400'   :
                                corArea === 'emerald' ? 'border-l-emerald-400' :
                                corArea === 'violet'  ? 'border-l-violet-400'  : 'border-l-gray-400'
                              }`}>
                                <CardContent className="py-4">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-base font-semibold text-foreground">{LABELS_AREA[at.area] ?? at.area}</span>
                                        {at.tipo_peca_origem && (
                                          <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                                            {TIPOS_PECA[at.tipo_peca_origem]?.nome ?? at.tipo_peca_origem}
                                          </span>
                                        )}
                                        <Badge variant={badge.variant} className="text-xs px-2 py-0.5">{badge.label}</Badge>
                                      </div>
                                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatarDataHora(at.created_at)}</span>
                                        {numDocs > 0 && <span className="flex items-center gap-1"><Paperclip className="h-3 w-3" />{numDocs} doc{numDocs > 1 ? 's' : ''}</span>}
                                      </div>
                                      {at.pedidos_especificos && <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">{at.pedidos_especificos}</p>}
                                      {at.audio_url && <PlayerAudio atendimentoId={at.id} />}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <BotaoExcluirAtendimento atendimentoId={at.id} />
                                      <Link href={hrefAtendimento(at)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors" title="Abrir atendimento">
                                        <ChevronRight className="h-5 w-5" />
                                      </Link>
                                    </div>
                                  </div>

                                  {/* Sub-itens */}
                                  {(atAnalises.length > 0 || atPecas.length > 0 || atContratos.length > 0) && (
                                    <div className="mt-4 border-t pt-3 space-y-2">
                                      {/* Ocultar análises se filtro for apenas 'pecas', e vice-versa */}
                                      {filtro !== 'pecas' && atAnalises.map(analise => {
                                        const anBadge = BADGE_ANALISE_STATUS[analise.status] ?? BADGE_ANALISE_STATUS.gerada
                                        return (
                                          <div key={analise.id} className="flex items-center gap-3 rounded-lg bg-primary/5/60 px-3 py-2 text-sm">
                                            <Brain className="h-4 w-4 text-primary shrink-0" />
                                            <div className="min-w-0 flex-1">
                                              <div className="flex items-center gap-2">
                                                <span className="font-medium text-primary">Análise de Caso</span>
                                                <Badge variant={anBadge.variant} className="text-xs px-1.5 py-0">{anBadge.label}</Badge>
                                              </div>
                                              {analise.tese_principal && <p className="text-xs text-primary truncate mt-0.5">{analise.tese_principal}</p>}
                                            </div>
                                            <span className="text-xs text-muted-foreground shrink-0">{formatarDataRelativa(analise.created_at)}</span>
                                          </div>
                                        )
                                      })}
                                      {filtro !== 'analises' && atPecas.map(peca => {
                                        const pcBadge  = BADGE_PECA_STATUS[peca.status] ?? BADGE_PECA_STATUS.rascunho
                                        const tipoPeca = TIPOS_PECA[peca.tipo]
                                        const StatusIcon =
                                          peca.status === 'aprovada'  ? CheckCircle2 :
                                          peca.status === 'exportada' ? Download :
                                          peca.status === 'revisada'  ? FileCheck :
                                          peca.status === 'rascunho'  ? Edit3 : Clock
                                        return (
                                          <Link key={peca.id} href={`/${peca.area}/editor/${peca.id}`}
                                            className="flex items-center gap-3 rounded-lg bg-emerald-50/60 px-3 py-2 text-sm hover:bg-emerald-100/60 transition-colors group"
                                          >
                                            <ScrollText className="h-4 w-4 text-emerald-500 shrink-0" />
                                            <div className="min-w-0 flex-1">
                                              <div className="flex items-center gap-2">
                                                <span className="font-medium text-emerald-900 group-hover:text-emerald-800">{tipoPeca?.nome ?? peca.tipo}</span>
                                                <Badge variant={pcBadge.variant} className="text-xs px-1.5 py-0">
                                                  <StatusIcon className="h-3 w-3 mr-0.5" />{pcBadge.label}
                                                </Badge>
                                                {peca.versao > 1 && <span className="text-xs text-muted-foreground">v{peca.versao}</span>}
                                              </div>
                                            </div>
                                            <span className="text-xs text-muted-foreground shrink-0">{formatarDataRelativa(peca.created_at)}</span>
                                            <BotaoExcluirPeca pecaId={peca.id} />
                                            <ChevronRight className="h-4 w-4 text-border group-hover:text-muted-foreground shrink-0" />
                                          </Link>
                                        )
                                      })}
                                      {atContratos.map(contrato => {
                                        const ctBadge = BADGE_CONTRATO_STATUS[contrato.status] ?? BADGE_CONTRATO_STATUS.rascunho
                                        return (
                                          <Link key={contrato.id} href={`/contratos/${contrato.id}`}
                                            className="flex items-center gap-3 rounded-lg bg-blue-50/60 px-3 py-2 text-sm hover:bg-blue-100/60 transition-colors group"
                                          >
                                            <FileSignature className="h-4 w-4 text-blue-500 shrink-0" />
                                            <div className="min-w-0 flex-1">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium text-blue-900 group-hover:text-blue-800">{contrato.titulo}</span>
                                                <Badge variant={ctBadge.variant} className="text-xs px-1.5 py-0">{ctBadge.label}</Badge>
                                              </div>
                                              {(contrato.valor_fixo || contrato.percentual_exito) && (
                                                <p className="text-xs text-blue-600 mt-0.5">
                                                  {contrato.valor_fixo ? `R$ ${Number(contrato.valor_fixo).toLocaleString('pt-BR')}` : ''}
                                                  {contrato.valor_fixo && contrato.percentual_exito ? ' · ' : ''}
                                                  {contrato.percentual_exito ? `${contrato.percentual_exito}% êxito` : ''}
                                                </p>
                                              )}
                                            </div>
                                            <span className="text-xs text-muted-foreground shrink-0">{formatarDataRelativa(contrato.created_at)}</span>
                                            <BotaoExcluirContrato contratoId={contrato.id} />
                                            <ChevronRight className="h-4 w-4 text-border group-hover:text-blue-500 shrink-0" />
                                          </Link>
                                        )
                                      })}
                                    </div>
                                  )}

                                  {atAnalises.length === 0 && atPecas.length === 0 && atContratos.length === 0 && (
                                    <div className="mt-3 border-t pt-3">
                                      <p className="text-xs text-muted-foreground italic">
                                        Nenhuma análise ou peça gerada ainda.{' '}
                                        <Link href={hrefAtendimento(at)} className="text-primary hover:underline">
                                          {at.area === 'geral' ? 'Analisar caso' : 'Gerar peça'}
                                        </Link>
                                      </p>
                                    </div>
                                  )}
                                </CardContent>
                              </div>
                            </Card>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          ) : null}

          {/* ── Contratos ── */}
          {mostrar('contratos') && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <FileSignature className="h-5 w-5 text-muted-foreground" />
                  Contratos de Honorários
                  {contratosList.length > 0 && (
                    <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                      {contratosList.length}
                    </span>
                  )}
                </h2>
                <Button asChild variant="secondary" size="md">
                  <Link href={`/contratos/novo?cliente_id=${id}`}>
                    <Plus className="h-4 w-4" />
                    Novo Contrato
                  </Link>
                </Button>
              </div>
              {contratosList.length === 0 ? (
                <EmptyState
                  icon={<FileSignature className="h-8 w-8" />}
                  title="Nenhum contrato"
                  description="Este cliente ainda não possui contratos de honorários."
                  action={{ label: '+ Novo Contrato', href: `/contratos/novo?cliente_id=${id}` }}
                />
              ) : (
                <div className="space-y-2">
                  {contratosList.map(contrato => {
                    const ctBadge = BADGE_CONTRATO_STATUS[contrato.status] ?? BADGE_CONTRATO_STATUS.rascunho
                    return (
                      <Link
                        key={contrato.id}
                        href={`/contratos/${contrato.id}`}
                        className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm hover:border-blue-200 hover:bg-blue-50/40 transition-colors group"
                      >
                        <FileSignature className="h-5 w-5 shrink-0 text-blue-500" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground group-hover:text-blue-900">{contrato.titulo}</span>
                            <Badge variant={ctBadge.variant} className="text-xs px-1.5 py-0">{ctBadge.label}</Badge>
                            {contrato.area && (
                              <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                                {LABELS_AREA[contrato.area] ?? contrato.area}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                            {contrato.valor_fixo && <span>R$ {Number(contrato.valor_fixo).toLocaleString('pt-BR')}</span>}
                            {contrato.percentual_exito && <span>{contrato.percentual_exito}% êxito</span>}
                            <span>{formatarDataRelativa(contrato.created_at)}</span>
                          </div>
                        </div>
                        <BotaoExcluirContrato contratoId={contrato.id} />
                        <ChevronRight className="h-4 w-4 text-border group-hover:text-blue-500 shrink-0" />
                      </Link>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* ── Documentos ── */}
          {mostrar('documentos') && (todosDocumentosCliente.data ?? []).length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Paperclip className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-xl font-semibold text-foreground">Documentos do Cliente</h2>
                <span className="ml-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                  {(todosDocumentosCliente.data ?? []).length}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(todosDocumentosCliente.data ?? []).map((doc) => (
                  <DocumentoLink
                    key={doc.id}
                    docId={doc.id}
                    fileName={doc.file_name}
                    dataRelativa={formatarDataRelativa(doc.created_at)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  )
}

// ─────────────────────────────────────────────────────────────

function ResumoCard({
  href, icone, label, valor, cor, ativo,
}: {
  href:  string
  icone: React.ReactNode
  label: string
  valor: number
  cor:   'primary' | 'violet' | 'emerald' | 'amber' | 'blue'
  ativo: boolean
}) {
  const cores = {
    primary: { bg: 'bg-primary/5',  text: 'text-primary',  ring: 'ring-primary/40'  },
    violet:  { bg: 'bg-primary/5',   text: 'text-primary',   ring: 'ring-primary/40'   },
    emerald: { bg: 'bg-emerald-50',  text: 'text-emerald-600',  ring: 'ring-emerald-400'  },
    amber:   { bg: 'bg-amber-50',    text: 'text-amber-600',    ring: 'ring-amber-400'    },
    blue:    { bg: 'bg-blue-50',     text: 'text-blue-600',     ring: 'ring-blue-400'     },
  }
  const { bg, text, ring } = cores[cor]
  return (
    <Link href={href}>
      <Card className={cn(
        'cursor-pointer transition-all hover:shadow-md',
        ativo && `ring-2 ${ring}`
      )}>
        <CardContent className="flex items-center gap-3 py-3">
          <div className={cn('rounded-lg p-2', bg, text)}>{icone}</div>
          <div>
            <p className="text-2xl font-bold text-foreground">{valor}</p>
            <p className={cn('text-xs', ativo ? cn('font-semibold', text) : 'text-muted-foreground')}>{label}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function DadoItem({
  icone, label, valor, link, className,
}: {
  icone:     React.ReactNode
  label:     string
  valor:     string
  link?:     string
  className?: string
}) {
  return (
    <div className={`flex items-start gap-3 ${className ?? ''}`}>
      <div className="mt-0.5 shrink-0 text-muted-foreground">{icone}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {link ? (
          <a href={link} className="text-base font-medium text-primary hover:underline">{valor}</a>
        ) : (
          <p className="text-base text-foreground">{valor}</p>
        )}
      </div>
    </div>
  )
}
