'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Card } from '@/components/ui/card'
import { EnviarWhatsAppModal } from '@/components/atendimento/EnviarWhatsAppModal'
import { cn, formatarData, formatarTelefone } from '@/lib/utils'
import { apenasDigitos } from '@/lib/conversas/telefone'
import { rotularArea } from '@/lib/tarefas/vinculo'
import { Search, X, Loader2, Briefcase, AlertTriangle, ChevronRight, MessageSquare, ListFilter } from 'lucide-react'

// Lista global de atendimentos/casos (GET /api/atendimentos, já enriquecido).
// Linhas ricas no padrão do mock do dono: barra de acento à esquerda, badge de
// estágio + título, meta (cliente · data · #numero), e as colunas PRÓXIMO PASSO /
// RESPONSÁVEL / HONORÁRIOS. Botão WhatsApp por linha abre o modal daquele cliente;
// a linha toda continua clicável (abre a Casa do caso). Busca com debounce.

interface AtendimentoItem {
  id: string
  numero: number
  titulo: string | null
  area: string | null
  estagio: 'atendimento' | 'caso'
  status: string
  etiquetas: string[]
  created_at: string
  encerrado_em: string | null
  cliente: { id: string; nome: string; pre_cadastro: boolean } | null
  telefoneCliente: string | null
  statusCadastroCliente: string | null
  responsavel: { id: string; nome: string } | null
  honorariosValor: number | null
  proximoPasso: { descricao: string; dueDate: string | null } | null
}

// 'todos' = sem filtro de status no servidor (a rota só filtra quando é
// andamento|encerrados). Estágio '' = todos (nenhum chip de tipo aceso).
type Status = 'andamento' | 'encerrados' | 'todos'
type EstagioFiltro = '' | 'atendimento' | 'caso'

// R$ 4.500,00 — mesmo formato que o resto do app usa para valor fixo (reais).
function formatarHonorarios(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Exibe o telefone só quando são 10/11 dígitos (BR local); com DDI (12/13) fica
// como veio, para alimentar o telefoneExibicao do modal sem sair torto.
function exibirTelefone(tel: string): string {
  const d = apenasDigitos(tel)
  return d.length === 10 || d.length === 11 ? formatarTelefone(tel) : tel
}

// Inicial do avatar do responsável: ignora pronome de tratamento (Dr., Dra., …)
// para "Dra. Katlen" virar "K", não "D".
function inicialResponsavel(nome: string): string {
  const limpo = nome.replace(/^\s*(dr|dra|sr|sra|exmo|exma|adv)\.?\s+/i, '').trim()
  return (limpo.charAt(0) || nome.trim().charAt(0) || '?').toUpperCase()
}

// Cor da bolinha do próximo passo pela urgência do prazo (regra do dono):
// vermelho = atrasado; âmbar = hoje/amanhã; azul = futuro ou sem data.
function corBolinha(dueDate: string | null): string {
  if (!dueDate) return 'bg-info'
  const [y, m, d] = dueDate.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return 'bg-info'
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const diffDias = Math.round((new Date(y, m - 1, d).getTime() - hoje.getTime()) / 86400000)
  if (diffDias < 0) return 'bg-destructive'
  if (diffDias <= 1) return 'bg-warning'
  return 'bg-info'
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors',
        ativo ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70',
      )}
    >
      {children}
    </button>
  )
}

// Coluna com rótulo mini uppercase muted + conteúdo (mesma escala nas 3 colunas).
function Coluna({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm text-foreground">{children}</div>
    </div>
  )
}

export function AtendimentosClient() {
  const router = useRouter()

  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [status, setStatus] = useState<Status>('andamento')
  const [estagio, setEstagio] = useState<EstagioFiltro>('')

  const [items, setItems] = useState<AtendimentoItem[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [carregando, setCarregando] = useState(true)
  const [whatsAtivo, setWhatsAtivo] = useState<AtendimentoItem | null>(null) // linha cujo modal está aberto
  const reqSeq = useRef(0) // ordem das requisições: descarta resposta que chegar fora de ordem

  // Debounce da busca (~300ms).
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const carregar = useCallback(async (page: number, replace: boolean) => {
    const seq = ++reqSeq.current
    setCarregando(true)
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (status !== 'todos') params.set('status', status) // 'todos' = sem filtro no servidor
      if (estagio) params.set('estagio', estagio)
      const termo = qDebounced.trim()
      if (termo.length >= 2) params.set('q', termo)
      const r = await fetch(`/api/atendimentos?${params}`)
      const d = await r.json().catch(() => ({}))
      if (seq !== reqSeq.current) return // saiu uma busca mais nova: ignora esta resposta obsoleta
      if (!r.ok) return
      const novos = (d.atendimentos ?? []) as AtendimentoItem[]
      setItems(prev => (replace ? novos : [...prev, ...novos]))
      setTotal(d.total ?? 0)
      setPagina(page)
    } finally {
      if (seq === reqSeq.current) setCarregando(false)
    }
  }, [status, estagio, qDebounced])

  // Refaz a partir da página 1 sempre que busca/filtros mudam.
  useEffect(() => { carregar(1, true) }, [carregar])

  // O servidor busca em título/cliente; aqui a busca cliente-side também cobre o
  // nome do responsável (OR — nunca esconde os resultados que o servidor trouxe).
  const termo = qDebounced.trim().toLowerCase()
  const visiveis = termo.length >= 2
    ? items.filter(a =>
        (a.titulo ?? '').toLowerCase().includes(termo) ||
        (a.cliente?.nome ?? '').toLowerCase().includes(termo) ||
        (a.responsavel?.nome ?? '').toLowerCase().includes(termo),
      )
    : items

  const podeCarregarMais = items.length < total

  return (
    <div className="space-y-4">
      {/* Busca */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por assunto, cliente ou responsável…"
          className="h-11 w-full rounded-md border border-border bg-card py-2 pl-10 pr-10 text-base placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring hover:border-muted-foreground transition-colors"
          aria-label="Buscar atendimentos"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filtros: status + estágio · à direita: ícone de filtro + contador */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip ativo={status === 'andamento'} onClick={() => setStatus('andamento')}>Em andamento</Chip>
          <Chip ativo={status === 'encerrados'} onClick={() => setStatus('encerrados')}>Encerrados</Chip>
          <Chip ativo={status === 'todos'} onClick={() => setStatus('todos')}>Todos</Chip>
          <span className="mx-1 h-5 w-px bg-border" />
          {/* Toggle: clicar no chip aceso volta a "todos os estágios" (estado neutro). */}
          <Chip ativo={estagio === 'atendimento'} onClick={() => setEstagio(estagio === 'atendimento' ? '' : 'atendimento')}>Atendimentos</Chip>
          <Chip ativo={estagio === 'caso'} onClick={() => setEstagio(estagio === 'caso' ? '' : 'caso')}>Casos</Chip>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
          <ListFilter className="h-4 w-4" aria-hidden />
          <span>{total} resultado{total === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* Lista */}
      {carregando && items.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : visiveis.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="h-10 w-10" />}
          title={termo.length >= 2 ? 'Nenhum atendimento encontrado' : 'Nenhum atendimento'}
          description={
            termo.length >= 2
              ? `Nada corresponde a "${qDebounced.trim()}". Tente outro termo.`
              : status === 'encerrados'
                ? 'Nenhum atendimento encerrado por aqui.'
                : 'Crie o primeiro atendimento com "Novo atendimento".'
          }
        />
      ) : (
        <>
          <div className="space-y-2">
            {visiveis.map(a => {
              // Sem assunto (casos legados/importados): a ÁREA identifica melhor
              // que repetir o rótulo do badge ("CASO Caso" era redundante).
              const titulo = (a.titulo ?? '').trim() || rotularArea(a.area)
              const href = a.cliente ? `/clientes/${a.cliente.id}/casos/${a.id}` : null
              const encerrado = !!a.encerrado_em

              // Barra de acento à esquerda: âmbar (atendimento), azul/indigo (caso),
              // muted (encerrado tem prioridade — o caso saiu do fluxo ativo).
              const acento = encerrado
                ? 'border-l-muted-foreground/30'
                : a.estagio === 'atendimento'
                  ? 'border-l-warning'
                  : 'border-l-primary'

              const digitosTel = a.telefoneCliente ? apenasDigitos(a.telefoneCliente) : ''
              const podeWhats = !!a.cliente && digitosTel.length >= 10

              // Mesmo botão em dois pontos (mobile ao lado do título, desktop nas ações).
              const botaoWhats = (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); if (podeWhats) setWhatsAtivo(a) }}
                  disabled={!podeWhats}
                  title={podeWhats ? 'Enviar WhatsApp ao cliente' : 'Informe o telefone do cliente para enviar WhatsApp'}
                  aria-label={`Enviar WhatsApp${a.cliente ? ` para ${a.cliente.nome || 'o cliente'}` : ''}`}
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                    podeWhats
                      ? 'border-success/30 bg-success/10 text-success hover:bg-success/15'
                      : 'cursor-not-allowed border-border bg-muted/40 text-muted-foreground opacity-60',
                  )}
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
              )

              return (
                <Card
                  key={a.id}
                  role={href ? 'button' : undefined}
                  tabIndex={href ? 0 : undefined}
                  aria-label={href ? `Abrir ${titulo}` : undefined}
                  onClick={href ? () => router.push(href) : undefined}
                  onKeyDown={href ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(href) } } : undefined}
                  className={cn(
                    'border-l-4 transition-shadow',
                    acento,
                    href && 'cursor-pointer hover:shadow-card-hover',
                  )}
                >
                  <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:gap-5">
                    {/* Título + meta (e o WhatsApp no mobile) */}
                    <div className="flex items-start gap-3 lg:min-w-0 lg:flex-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span
                            className={cn(
                              'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              a.estagio === 'atendimento' ? 'bg-muted/70 text-muted-foreground' : 'bg-muted text-foreground',
                            )}
                          >
                            {a.estagio === 'atendimento' ? 'Atendimento' : 'Caso'}
                          </span>
                          <h3 className="max-w-full truncate text-base font-semibold text-foreground" title={titulo}>{titulo}</h3>
                          {a.cliente?.pre_cadastro && (
                            <Link
                              href={`/clientes/${a.cliente.id}`}
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning hover:bg-warning/20 transition-colors"
                              title="Cadastro do cliente incompleto — completar dossiê"
                            >
                              <AlertTriangle className="h-3 w-3" /> Cadastro incompleto
                            </Link>
                          )}
                          {encerrado && (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Encerrado
                            </span>
                          )}
                        </div>

                        {/* Meta em LINHA ÚNICA: o nome trunca; data e nº nunca quebram
                            (o dono apontou os dados "espremidos" quebrando em 3 linhas). */}
                        <div className="mt-1 flex min-w-0 items-center gap-x-1.5 text-sm text-muted-foreground">
                          {a.cliente ? (
                            <Link
                              href={`/clientes/${a.cliente.id}`}
                              onClick={e => e.stopPropagation()}
                              className="min-w-0 truncate font-medium text-foreground hover:text-primary hover:underline"
                              title={a.cliente.nome || 'Cliente'}
                            >
                              {a.cliente.nome || 'Cliente'}
                            </Link>
                          ) : (
                            <span className="italic">Sem cliente</span>
                          )}
                          <span aria-hidden className="shrink-0">·</span>
                          <span className="shrink-0 whitespace-nowrap">{formatarData(a.created_at)}</span>
                          <span aria-hidden className="shrink-0">·</span>
                          <span className="shrink-0 tabular-nums">#{a.numero}</span>
                        </div>
                      </div>

                      {/* WhatsApp no mobile (nas ações no desktop) */}
                      <div className="shrink-0 lg:hidden">{botaoWhats}</div>
                    </div>

                    {/* Colunas: próximo passo · responsável · honorários */}
                    {/* Larguras enxutas + gap menor no lg: sobra espaço pra 1ª coluna
                        (título/cliente) respirar em monitores médios. */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-6 sm:gap-y-2 lg:flex-nowrap lg:shrink-0 lg:gap-4 xl:gap-6">
                      <Coluna label="Próximo passo" className="lg:w-40 xl:w-52">
                        {a.proximoPasso ? (
                          <div className="flex items-center gap-1.5" title={a.proximoPasso.descricao}>
                            <span className={cn('h-2 w-2 shrink-0 rounded-full', corBolinha(a.proximoPasso.dueDate))} aria-hidden />
                            <span className="truncate">{a.proximoPasso.descricao || 'Tarefa sem descrição'}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Coluna>

                      <Coluna label="Responsável" className="lg:w-32 xl:w-40">
                        {a.responsavel ? (
                          <div className="flex items-center gap-1.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                              {inicialResponsavel(a.responsavel.nome)}
                            </span>
                            <span className="truncate">{a.responsavel.nome}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Coluna>

                      <Coluna label="Honorários" className="lg:w-28 lg:text-right">
                        {a.honorariosValor != null ? (
                          <span className="font-semibold text-foreground">{formatarHonorarios(a.honorariosValor)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Coluna>
                    </div>

                    {/* Ações (desktop): WhatsApp + chevron */}
                    <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
                      {botaoWhats}
                      {href && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Paginação incremental */}
          {podeCarregarMais && (
            <div className="flex justify-center pt-1">
              <Button variant="secondary" size="md" onClick={() => carregar(pagina + 1, false)} loading={carregando}>
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}

      {/* Modal de WhatsApp da linha selecionada (só quando há cliente + telefone) */}
      {whatsAtivo && whatsAtivo.cliente && whatsAtivo.telefoneCliente && (
        <EnviarWhatsAppModal
          aberto
          onFechar={() => setWhatsAtivo(null)}
          atendimentoId={whatsAtivo.id}
          clienteId={whatsAtivo.cliente.id}
          clienteNome={whatsAtivo.cliente.nome || 'Cliente'}
          telefoneExibicao={exibirTelefone(whatsAtivo.telefoneCliente)}
        />
      )}
    </div>
  )
}
