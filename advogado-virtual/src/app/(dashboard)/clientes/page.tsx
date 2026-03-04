import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ListaClientesClient } from './ListaClientesClient'
import { Plus, Users } from 'lucide-react'
import { formatarData, mascaraCPF, iniciais } from '@/lib/utils'

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
    .order('nome', { ascending: true })
    .range(offset, offset + limit - 1)

  if (q) {
    query = query.ilike('nome', `%${q}%`)
  } else if (letra) {
    query = query.ilike('nome', `${letra}%`)
  }

  const { data: clientes, count } = await query

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
                {clientes.map(cliente => (
                  <Link key={cliente.id} href={`/clientes/${cliente.id}`}>
                    <Card className="transition-shadow hover:shadow-card-hover">
                      <CardContent className="flex items-center gap-4 py-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
                          {iniciais(cliente.nome)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-lg font-semibold text-foreground truncate">
                            {cliente.nome}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                            {cliente.cpf && (
                              <span>CPF: {mascaraCPF(cliente.cpf)}</span>
                            )}
                            {cliente.telefone && (
                              <span>{cliente.telefone}</span>
                            )}
                            <span className="text-muted-foreground">
                              Cadastrado em {formatarData(cliente.created_at)}
                            </span>
                          </div>
                        </div>

                        <svg className="h-5 w-5 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
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
