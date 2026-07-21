import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PecasPorArea } from '@/components/atendimento/PecasPorArea'
import { OutraPecaChip } from '@/components/atendimento/OutraPecaChip'
import { CapaProcesso, type DadosProcesso } from '@/components/atendimento/CapaProcesso'
import { RegistrosAtendimento, type RegistroItem } from '@/components/atendimento/RegistrosAtendimento'
import { AcoesAtendimento } from '@/components/atendimento/AcoesAtendimento'
import { CartaoContatoCliente } from '@/components/atendimento/CartaoContatoCliente'
import { TarefasDoCaso, type TarefaDoCaso } from '@/components/atendimento/TarefasDoCaso'
import { AnexosDoCaso } from '@/components/atendimento/AnexosDoCaso'
import { decryptTranscricaoFields } from '@/lib/encryption'
import { AREAS } from '@/lib/constants/areas'
import { MODELOS_PRONTOS, TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { formatarData, formatarDataHora, formatarDataRelativa, formatarReais } from '@/lib/utils'
import {
  Brain, ChevronLeft, ChevronDown, ScrollText, FilePlus, FileText, FileSignature,
  AlertTriangle, Clock, CheckCircle, ArrowRight, History, Briefcase, Tag, Lock,
  Scale, Link2,
} from 'lucide-react'
import { rotularArea, formatarCnj } from '@/lib/tarefas/vinculo'
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
    .select('id, nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')

  const { data: at } = await supabase
    .from('atendimentos')
    .select('id, area, status, created_at, numero_processo, dados_processo, titulo, etiquetas, estagio, encerrado_em, transcricao_raw, transcricao_editada, clientes(id, nome, telefone, email), analises(id, plano_a, created_at), pecas(id, tipo, area, versao, status, created_at)')
    .eq('id', atendimentoId)
    .eq('cliente_id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()
  if (!at) notFound()

  const { data: contratos } = await supabase
    .from('contratos_honorarios')
    .select('id, titulo, status, area, valor_fixo, percentual_exito, created_at')
    .eq('atendimento_id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })

  // Diário do atendimento (056) — busca server-side p/ hidratar a timeline sem flicker.
  type PessoaEmbed = { id: string; nome: string | null }
  const um = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
  const { data: registrosRaw } = await supabase
    .from('atendimento_registros')
    .select('id, texto, created_at, user_id, users(id, nome)')
    .eq('atendimento_id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: true })
  const registros: RegistroItem[] = ((registrosRaw ?? []) as Array<{ id: string; texto: string; created_at: string; user_id: string | null; users: PessoaEmbed | PessoaEmbed[] | null }>).map((r) => ({
    id: r.id,
    texto: r.texto,
    created_at: r.created_at,
    autor: um(r.users) ?? (r.user_id ? { id: r.user_id, nome: null } : null),
  }))

  // Tarefas do caso: vínculo 054 = tasks.process_id → atendimentos(id).
  const { data: tarefasRaw } = await supabase
    .from('tasks')
    .select('id, description, due_date, priority, completed_at, assignee:users!tasks_assignee_id_fkey(id, nome), coluna:kanban_columns!tasks_kanban_column_id_fkey(id, name)')
    .eq('process_id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
  const tarefas: TarefaDoCaso[] = ((tarefasRaw ?? []) as Array<{ id: string; description: string; due_date: string | null; priority: string; completed_at: string | null; assignee: PessoaEmbed | PessoaEmbed[] | null; coluna: { id: string; name: string } | { id: string; name: string }[] | null }>).map((t) => ({
    id: t.id,
    description: t.description,
    due_date: t.due_date,
    priority: t.priority,
    completed_at: t.completed_at,
    assignee: um(t.assignee),
    coluna: um(t.coluna),
  }))

  // Equipe (p/ o TaskFormModal pré-vinculado a este caso).
  const { data: membros } = await supabase
    .from('users')
    .select('id, nome')
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'ativo')
    .order('nome')
  const teamMembers = (membros ?? []) as Array<{ id: string; nome: string }>

  // telefone/email não são cifrados (só cpf/rg), então vêm em texto-plano aqui.
  const cliente = at.clientes as unknown as { id: string; nome: string; telefone: string | null; email: string | null } | null
  const analiseRow = (at.analises as Array<{ id: string; plano_a: ResultadoAnaliseGeral; created_at: string }> | null)?.[0] ?? null
  const analise = analiseRow?.plano_a ?? null
  const areasIdent = analise?.areas_identificadas ?? []
  const pecas = (at.pecas ?? []) as Array<{ id: string; tipo: string; area: string; versao: number; status: string; created_at: string }>

  // Documentos do caso (063): listados por VÍNCULO N:N — inclui os que nasceram
  // aqui E os vinculados de outras pastas (atalho). Removê-los remove só a linha
  // de vínculo; a coluna documentos.atendimento_id continua sendo a ORIGEM.
  type DocCaso = { id: string; file_name: string; tipo: string; created_at: string; atendimento_id: string | null }
  const { data: vincDocsRaw } = await supabase
    .from('documento_vinculos')
    .select('documentos(id, file_name, tipo, created_at, atendimento_id)')
    .eq('atendimento_id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
  const documentos = ((vincDocsRaw ?? []) as Array<{ documentos: DocCaso | DocCaso[] | null }>)
    .map((v) => um(v.documentos))
    .filter((d): d is DocCaso => !!d)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  // Anexos do caso p/ o card: doc cuja ORIGEM é este caso segue a regra de sempre
  // (X exclui); atalho de outra pasta → X só remove o vínculo deste caso.
  const anexosDoCaso = documentos.map((d) => ({
    id: d.id,
    file_name: d.file_name,
    created_at: d.created_at,
    nascido_neste_caso: d.atendimento_id === atendimentoId,
  }))
  const status = at.status as string
  const badge = BADGE_STATUS[status] ?? BADGE_STATUS.caso_novo

  // Cabeçalho leve (056): título com fallback, estágio, encerramento e etiquetas.
  const estagio = ((at as { estagio?: string }).estagio ?? 'caso') as 'atendimento' | 'caso'
  const encerradoEm = (at as { encerrado_em?: string | null }).encerrado_em ?? null
  const etiquetas = ((at as { etiquetas?: string[] | null }).etiquetas ?? []) as string[]
  const tituloCaso = ((at as { titulo?: string | null }).titulo ?? '').trim()
    || areaMeta(at.area)?.nome
    || (estagio === 'atendimento' ? 'Atendimento' : 'Caso')
  // Relato inicial da timeline — decifrado no servidor (nunca no client).
  const atDec = decryptTranscricaoFields(at as Record<string, unknown>)
  const relatoInicial =
    ((atDec.transcricao_editada as string | null)?.trim() || (atDec.transcricao_raw as string | null)?.trim()) || null

  // Vínculo opcional (057) — outro caso/atendimento ou processo. Buscado à parte
  // para não derrubar a página se a migration ainda não estiver aplicada (colunas
  // ausentes → erro isolado nesta query, vinc = null, apenas sem o chip).
  const { data: vinc } = await supabase
    .from('atendimentos')
    .select('vinculo_atendimento_id, vinculo_processo_id, alvoAtend:atendimentos!vinculo_atendimento_id(id, titulo, area, cliente_id), alvoProc:processos!vinculo_processo_id(id, apelido, numero_cnj, cliente_id)')
    .eq('id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()

  type AlvoAtend = { id: string; titulo: string | null; area: string | null; cliente_id: string | null }
  type AlvoProc  = { id: string; apelido: string | null; numero_cnj: string | null; cliente_id: string | null }
  let vinculoChip: { tipo: 'atendimento' | 'processo'; id: string; label: string; href: string | null } | null = null
  if (vinc) {
    const v = vinc as {
      vinculo_atendimento_id?: string | null; vinculo_processo_id?: string | null
      alvoAtend?: AlvoAtend | AlvoAtend[] | null; alvoProc?: AlvoProc | AlvoProc[] | null
    }
    if (v.vinculo_atendimento_id) {
      const alvo = um(v.alvoAtend)
      if (alvo) vinculoChip = {
        tipo: 'atendimento', id: alvo.id,
        label: (alvo.titulo ?? '').trim() || rotularArea(alvo.area),
        href: alvo.cliente_id ? `/clientes/${alvo.cliente_id}/casos/${alvo.id}` : null,
      }
    } else if (v.vinculo_processo_id) {
      const alvo = um(v.alvoProc)
      if (alvo) vinculoChip = {
        tipo: 'processo', id: alvo.id,
        label: (alvo.apelido ?? '').trim() || formatarCnj(alvo.numero_cnj),
        href: alvo.cliente_id ? `/clientes/${alvo.cliente_id}` : null,
      }
    }
  }
  const vinculoAtual = vinculoChip
    ? { tipo: vinculoChip.tipo, id: vinculoChip.id, label: vinculoChip.label, sublabel: null }
    : null

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
        titulo={tituloCaso}
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
        {/* Layout 2 colunas (inspirado no Astrea): à esquerda os detalhes do
            atendimento (diário como protagonista); à direita as ações e os
            complementos. No mobile empilha — principal primeiro, sidebar depois. */}
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">

          {/* ───────────── COLUNA PRINCIPAL — detalhes do atendimento ───────────── */}
          <div className="min-w-0 space-y-5">

          {/* Cabeçalho leve: estágio, encerramento e etiquetas */}
          <div className="flex flex-wrap items-center gap-2">
            {estagio === 'atendimento' ? (
              <Badge variant="default" className="gap-1 px-2 py-0.5 text-xs">
                <Briefcase className="h-3.5 w-3.5" /> Atendimento
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 px-2 py-0.5 text-xs">
                <Briefcase className="h-3.5 w-3.5" /> Caso
              </Badge>
            )}
            {encerradoEm ? (
              <Badge variant="success" className="gap-1 px-2 py-0.5 text-xs">
                <Lock className="h-3.5 w-3.5" /> Encerrado em {formatarData(encerradoEm)}
              </Badge>
            ) : (
              <Badge variant={badge.variant} className="px-2 py-0.5 text-xs">{badge.label}</Badge>
            )}
            {etiquetas.map((et) => (
              <Badge key={et} variant="secondary" className="gap-1 px-2 py-0.5 text-xs">
                <Tag className="h-3 w-3" /> {et}
              </Badge>
            ))}
            {/* Chip do vínculo (057): outro caso/atendimento ou processo relacionado */}
            {vinculoChip && (() => {
              const IconeVinc = vinculoChip.tipo === 'processo' ? Scale : Briefcase
              const conteudo = (
                <>
                  <Link2 className="h-3 w-3 text-muted-foreground" />
                  <IconeVinc className="h-3 w-3" />
                  <span className="truncate max-w-[220px]">{vinculoChip.label}</span>
                </>
              )
              const cls = 'inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground'
              return vinculoChip.href ? (
                <Link href={vinculoChip.href} className={`${cls} hover:bg-muted hover:text-foreground transition-colors`} title={`Vínculo: ${vinculoChip.label}`}>
                  {conteudo}
                </Link>
              ) : (
                <span className={cls} title={`Vínculo: ${vinculoChip.label}`}>{conteudo}</span>
              )
            })()}
          </div>

          {/* Registros do atendimento (diário) — protagonista da coluna principal */}
          <RegistrosAtendimento
            atendimentoId={atendimentoId}
            registrosIniciais={registros}
            relatoInicial={relatoInicial}
            relatoData={at.created_at as string}
          />

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
                        {/* Chips do catálogo + "Outra…" p/ digitar uma peça fora do catálogo */}
                        <div className="flex flex-wrap items-center gap-2">
                          {pecasArea.map((tipo) => (
                            <Link
                              key={tipo}
                              href={`/${a.area}/pecas/${tipo}?id=${atendimentoId}`}
                              className="rounded-lg border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:border-primary/30 hover:bg-primary/10 transition-colors"
                            >
                              {TIPOS_PECA[tipo]?.nome ?? tipo}
                            </Link>
                          ))}
                          <OutraPecaChip area={a.area} atendimentoId={atendimentoId} />
                          {pecasArea.length === 0 && (
                            <span className="text-xs text-muted-foreground">Sem peças mapeadas — digite a que precisa</span>
                          )}
                        </div>
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

          </div>{/* /coluna principal */}

          {/* ───────────── COLUNA DIREITA — ações e complementos ───────────── */}
          <aside className="space-y-4">

            {/* (a) Contato do cliente — nome (dossiê), telefone/WhatsApp e e-mail */}
            {cliente && (
              <CartaoContatoCliente
                clienteId={cliente.id}
                atendimentoId={atendimentoId}
                nome={cliente.nome}
                telefoneInicial={cliente.telefone}
                email={cliente.email}
              />
            )}

            {/* (b) Ações do atendimento — lista vertical discreta (antes no header) */}
            <AcoesAtendimento
              atendimentoId={atendimentoId}
              clienteId={id}
              estagio={estagio}
              encerrado={!!encerradoEm}
              vinculoAtual={vinculoAtual}
              variant="lista"
            />

            {/* (c) Capa do processo (nº CNJ + DataJud) — cabe na coluna de 360px */}
            <CapaProcesso
              atendimentoId={atendimentoId}
              numeroInicial={(at as { numero_processo?: string | null }).numero_processo ?? null}
              dadosIniciais={(at as { dados_processo?: DadosProcesso | null }).dados_processo ?? null}
            />

          {/* (d) Documentos do caso */}
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

              {/* Anexos — inclui "Adicionar do cadastro" (vincula um doc geral do
                  cliente) e distingue docs "do cadastro" (X desvincula) dos do caso. */}
              <AnexosDoCaso
                clienteId={id}
                atendimentoId={atendimentoId}
                documentosIniciais={anexosDoCaso}
              />
            </CardContent>
          </Card>

          {/* (e) Tarefas do caso (vínculo 054: tasks.process_id → este atendimento) */}
          <TarefasDoCaso
            atendimentoId={atendimentoId}
            vinculoLabel={tituloCaso}
            vinculoSublabel={cliente?.nome ?? null}
            teamMembers={teamMembers}
            currentUserId={usuario.id}
            currentUserName={usuario.nome ?? user.email ?? 'Você'}
            tarefas={tarefas}
          />

          {/* (f) Honorários (contratos deste caso + atalho p/ o financeiro do cliente) */}
          {cliente && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileSignature className="h-5 w-5 text-blue-500" />
                  Honorários
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {(contratos ?? []).length > 0 ? (
                  (contratos as Array<{ id: string; titulo: string; status: string; valor_fixo: number | null; percentual_exito: number | null }>).map((c) => {
                    const valor = [
                      c.valor_fixo != null ? formatarReais(Number(c.valor_fixo)) : null,
                      c.percentual_exito != null ? `${Number(c.percentual_exito)}% de êxito` : null,
                    ].filter(Boolean).join(' + ')
                    const aprovado = c.status === 'aprovado' || c.status === 'exportado'
                    const statusLabel = c.status === 'aprovado' ? 'Aprovado' : c.status === 'exportado' ? 'Exportado' : c.status === 'em_revisao' ? 'Em revisão' : 'Rascunho'
                    return (
                      <Link key={c.id} href={`/contratos/${c.id}`} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors group">
                        <span className="flex min-w-0 items-center gap-2">
                          <FileSignature className="h-4 w-4 shrink-0 text-blue-500" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{c.titulo}</span>
                            {valor && <span className="block text-xs text-muted-foreground">{valor}</span>}
                          </span>
                        </span>
                        <Badge variant={aprovado ? 'success' : 'secondary'} className="shrink-0 px-1.5 py-0 text-[10px]">{statusLabel}</Badge>
                      </Link>
                    )
                  })
                ) : (
                  <p className="text-sm italic text-muted-foreground">Nenhum contrato de honorários neste caso.</p>
                )}
                <Link href={`/financeiro?clienteId=${cliente.id}`} className="inline-flex items-center gap-1 pt-1 text-sm font-semibold text-primary hover:underline">
                  Ver financeiro do cliente <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>
          )}

          </aside>{/* /coluna direita */}

        </div>
      </main>
    </>
  )
}
