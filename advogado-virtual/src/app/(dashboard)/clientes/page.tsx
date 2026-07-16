import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ListaClientesClient } from './ListaClientesClient'
import { Plus, Users, Mail, Phone, ChevronRight } from 'lucide-react'
import { iniciais, formatarDataCurta, truncar } from '@/lib/utils'
import { formatarCnj, rotularArea } from '@/lib/tarefas/vinculo'
import { decryptClienteFields } from '@/lib/encryption'

export const metadata = { title: 'Clientes' }

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; letra?: string }>
}) {
  const { q = '', page = '1', letra = '' } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  // Buscar primeiras letras disponíveis para o índice
  const { data: todosNomes } = await supabase
    .from('clientes')
    .select('nome')
    .eq('tenant_id', usuario.tenant_id)
    .neq('status_cadastro', 'pre_cadastro') // pré-cadastros do funil não poluem o cadastro

  const letrasDisponiveis = [...new Set(
    (todosNomes ?? [])
      .map(c => c.nome?.charAt(0).toUpperCase())
      .filter(Boolean)
  )].sort() as string[]

  const pageNum = parseInt(page)
  const limit   = 20
  const offset  = (pageNum - 1) * limit

  let query = supabase
    .from('clientes')
    .select('*', { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .neq('status_cadastro', 'pre_cadastro') // esconde pré-cadastros do funil
    .order('nome', { ascending: true })
    .range(offset, offset + limit - 1)

  if (q) {
    query = query.ilike('nome', `%${q}%`)
  } else if (letra) {
    query = query.ilike('nome', `${letra}%`)
  }

  const { data: clientesRaw, count } = await query
  const clientes = (clientesRaw ?? []).map(decryptClienteFields)

  // Enriquecimento do card em 2 queries em lote (só os ids da página, sem N+1):
  // (1) área do caso mais recente; (2) processo mais recente + seu último movimento.
  const clienteIds = clientes.map(c => c.id)
  const areaPorCliente = new Map<string, string>()
  const processoPorCliente = new Map<string, { cnj: string; situacao: string; movimento: string | null }>()

  if (clienteIds.length > 0) {
    const [{ data: atends }, { data: procs }] = await Promise.all([
      supabase
        .from('atendimentos')
        .select('cliente_id, area, created_at')
        .eq('tenant_id', usuario.tenant_id)
        .in('cliente_id', clienteIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('processos')
        .select('cliente_id, numero_cnj, situacao, created_at, processo_movimentos(nome, data_hora)')
        .eq('tenant_id', usuario.tenant_id)
        .in('cliente_id', clienteIds)
        .order('created_at', { ascending: false })
        .order('data_hora', { referencedTable: 'processo_movimentos', ascending: false })
        .limit(1, { referencedTable: 'processo_movimentos' }),
    ])

    // Listas já vêm desc: a 1ª ocorrência por cliente é a mais recente.
    for (const a of atends ?? []) {
      if (!areaPorCliente.has(a.cliente_id)) areaPorCliente.set(a.cliente_id, a.area)
    }
    for (const p of procs ?? []) {
      if (processoPorCliente.has(p.cliente_id)) continue
      const mov = Array.isArray(p.processo_movimentos) ? p.processo_movimentos[0] : null
      processoPorCliente.set(p.cliente_id, { cnj: p.numero_cnj, situacao: p.situacao, movimento: mov?.nome ?? null })
    }
  }

  const totalPaginas = Math.ceil((count ?? 0) / limit)

  // Query string base para paginação
  const baseParams = new URLSearchParams()
  if (q) baseParams.set('q', q)
  else if (letra) baseParams.set('letra', letra)
  const baseStr = baseParams.toString()

  return (
    <>
      <Header
        titulo="Clientes"
        subtitulo={`${count ?? 0} cliente${(count ?? 0) !== 1 ? 's' : ''} cadastrado${(count ?? 0) !== 1 ? 's' : ''}`}
        acoes={
          <Button asChild size="md">
            <Link href="/clientes/novo">
              <Plus className="h-4 w-4" />
              Novo Cliente
            </Link>
          </Button>
        }
        nomeUsuario={usuario.nome}
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">

          {/* Barra de busca + índice alfabético */}
          <ListaClientesClient
            busca={q}
            letraAtiva={q ? '' : letra}
            letrasDisponiveis={letrasDisponiveis}
          />

          {/* Lista de clientes */}
          {!clientes || clientes.length === 0 ? (
            <EmptyState
              icon={<Users className="h-10 w-10" />}
              title={q ? 'Nenhum cliente encontrado' : letra ? `Nenhum cliente com "${letra}"` : 'Nenhum cliente cadastrado'}
              description={
                q
                  ? `Nenhum cliente com o nome "${q}". Tente outro termo.`
                  : letra
                    ? `Nenhum cliente com nome iniciando em "${letra}".`
                    : 'Comece cadastrando o primeiro cliente do escritório.'
              }
              action={
                q || letra
                  ? undefined
                  : { label: 'Cadastrar primeiro cliente', href: '/clientes/novo' }
              }
            />
          ) : (
            <>
              <div className="space-y-2">
                {clientes.map(cliente => {
                  const area = areaPorCliente.get(cliente.id)
                  const proc = processoPorCliente.get(cliente.id)
                  // Status do cadastro → badge (pre_cadastro fica fora da lista, mas mapeado por segurança)
                  const status = cliente.status_cadastro === 'inativo'
                    ? { label: 'INATIVO', cls: 'bg-muted text-muted-foreground' }
                    : cliente.status_cadastro === 'pre_cadastro'
                      ? { label: 'CADASTRO INCOMPLETO', cls: 'bg-warning/10 text-warning' }
                      : { label: 'ATIVO', cls: 'bg-success/10 text-success' }
                  return (
                  <Link key={cliente.id} href={`/clientes/${cliente.id}`}>
                    <Card className="transition-shadow hover:shadow-card-hover">
                      <CardContent className="flex items-center gap-4 py-4">
                        {/* Avatar de iniciais (quadrado arredondado) */}
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
                          {iniciais(cliente.nome)}
                        </div>

                        {/* Empilha no mobile; vira colunas no desktop */}
                        <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center md:gap-4">
                          {/* Identidade + badges + contato */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {/* Nome INTEIRO (pedido do dono: o conteúdo manda; sem truncar). */}
                              <p className="text-base font-semibold text-foreground">{cliente.nome}</p>
                              {cliente.cpf && (
                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">PF</span>
                              )}
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>{status.label}</span>
                              {area && (
                                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                                  {rotularArea(area)}
                                </span>
                              )}
                            </div>

                            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                              {cliente.email && (
                                <span className="inline-flex min-w-0 items-center gap-1.5">
                                  <Mail className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{cliente.email}</span>
                                </span>
                              )}
                              {cliente.telefone && (
                                <span className="inline-flex items-center gap-1.5">
                                  <Phone className="h-3.5 w-3.5 shrink-0" />
                                  {cliente.telefone}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Colunas contextuais (lado a lado no mobile, à direita no desktop) */}
                          <div className="flex gap-6 md:shrink-0">
                            {/* Último processo */}
                            <div className="min-w-0 flex-1 md:w-52 md:flex-none">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Último processo</p>
                              {proc ? (
                                <>
                                  <p className="truncate text-sm font-medium text-foreground">{formatarCnj(proc.cnj)}</p>
                                  {proc.movimento ? (
                                    <p className="truncate text-xs text-blue-600 dark:text-blue-400">{truncar(proc.movimento, 40)}</p>
                                  ) : proc.situacao === 'encerrado' ? (
                                    <p className="text-xs text-muted-foreground">Encerrado</p>
                                  ) : (
                                    <p className="text-xs text-blue-600 dark:text-blue-400">Ativo</p>
                                  )}
                                </>
                              ) : (
                                <p className="text-sm text-muted-foreground">—</p>
                              )}
                            </div>

                            {/* Cadastrado */}
                            <div className="shrink-0">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Cadastrado</p>
                              <p className="text-sm text-foreground">{formatarDataCurta(cliente.created_at)}</p>
                            </div>
                          </div>
                        </div>

                        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </Link>
                  )
                })}
              </div>

              {/* Paginação */}
              {totalPaginas > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  {pageNum > 1 && (
                    <Link href={`/clientes?${baseStr}${baseStr ? '&' : ''}page=${pageNum - 1}`}>
                      <Button variant="secondary" size="sm">← Anterior</Button>
                    </Link>
                  )}
                  <span className="text-sm text-muted-foreground">
                    Página {pageNum} de {totalPaginas}
                  </span>
                  {pageNum < totalPaginas && (
                    <Link href={`/clientes?${baseStr}${baseStr ? '&' : ''}page=${pageNum + 1}`}>
                      <Button variant="secondary" size="sm">Próxima →</Button>
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  )
}
