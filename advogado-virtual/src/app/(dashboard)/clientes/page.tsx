import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { ListaClientesClient } from './ListaClientesClient'
import { Plus, Users } from 'lucide-react'
import { formatarData, mascaraCPF, iniciais } from '@/lib/utils'

export const metadata = { title: 'Clientes' }

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const { q = '', page = '1' } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  const pageNum = parseInt(page)
  const limit   = 20
  const offset  = (pageNum - 1) * limit

  let query = supabase
    .from('clientes')
    .select('*', { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .order('nome', { ascending: true })
    .range(offset, offset + limit - 1)

  if (q) query = query.ilike('nome', `%${q}%`)

  const { data: clientes, count } = await query

  const totalPaginas = Math.ceil((count ?? 0) / limit)

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

          {/* Barra de busca (componente client) */}
          <ListaClientesClient busca={q} />

          {/* Lista de clientes */}
          {!clientes || clientes.length === 0 ? (
            <EmptyState
              icon={<Users className="h-10 w-10" />}
              title={q ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
              description={
                q
                  ? `Nenhum cliente com o nome "${q}". Tente outro termo.`
                  : 'Comece cadastrando o primeiro cliente do escritório.'
              }
              action={
                q
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
                        {/* Avatar com iniciais */}
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-100 text-base font-bold text-primary-800">
                          {iniciais(cliente.nome)}
                        </div>

                        {/* Dados */}
                        <div className="flex-1 min-w-0">
                          <p className="text-lg font-semibold text-gray-900 truncate">
                            {cliente.nome}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-500">
                            {cliente.cpf && (
                              <span>CPF: {mascaraCPF(cliente.cpf)}</span>
                            )}
                            {cliente.telefone && (
                              <span>{cliente.telefone}</span>
                            )}
                            <span className="text-gray-400">
                              Cadastrado em {formatarData(cliente.created_at)}
                            </span>
                          </div>
                        </div>

                        {/* Seta */}
                        <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                    <Link href={`/clientes?q=${q}&page=${pageNum - 1}`}>
                      <Button variant="secondary" size="sm">← Anterior</Button>
                    </Link>
                  )}
                  <span className="text-sm text-gray-600">
                    Página {pageNum} de {totalPaginas}
                  </span>
                  {pageNum < totalPaginas && (
                    <Link href={`/clientes?q=${q}&page=${pageNum + 1}`}>
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
