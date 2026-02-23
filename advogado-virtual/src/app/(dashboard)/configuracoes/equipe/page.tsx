import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { AlterarRole, DesativarUsuario, FormConvite, DefinirPrincipal, ReenviarConvite } from './EquipeClient'
import { LABELS_ROLE } from '@/types'
import { Users, UserPlus, Clock, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { formatarDataRelativa } from '@/lib/utils'

export const metadata = { title: 'Gestão de Equipe' }

const BADGE_ROLE: Record<string, 'success' | 'warning' | 'secondary' | 'default'> = {
  admin:       'success',
  advogado:    'default',
  colaborador: 'secondary',
}

export default async function EquipePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('users')
    .select('id, nome, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!admin) redirect('/login')

  // Apenas administradores acessam esta página
  if (admin.role !== 'admin') redirect('/configuracoes')

  // Todos os usuários ativos do escritório
  const { data: usuarios } = await supabase
    .from('users')
    .select('id, nome, email, role, status, created_at, auth_user_id, is_advogado_principal')
    .eq('tenant_id', admin.tenant_id)
    .eq('status', 'ativo')
    .order('created_at', { ascending: true })

  const listaUsuarios = usuarios ?? []
  const pendentes     = listaUsuarios.filter(u => !u.auth_user_id)
  const ativos        = listaUsuarios.filter(u => !!u.auth_user_id)

  return (
    <>
      <Header
        titulo="Gestão de Equipe"
        subtitulo="Convide colaboradores e gerencie os perfis de acesso"
        nomeUsuario={admin.nome}
        acoes={
          <Link
            href="/configuracoes"
            className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
            Configurações
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">

          {/* Convidar novo membro */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary-600" />
                Convidar novo membro
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-gray-500">
                O convidado receberá um e-mail com um link para definir sua senha e acessar o sistema.
              </p>
              <FormConvite />
            </CardContent>
          </Card>

          {/* Convites pendentes */}
          {pendentes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4 text-amber-500" />
                  Convites pendentes
                  <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    {pendentes.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {pendentes.map((u) => (
                    <div key={u.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium text-gray-800">{u.nome}</p>
                        <p className="text-sm text-gray-400">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={BADGE_ROLE[u.role] ?? 'default'} className="text-xs">
                          {LABELS_ROLE[u.role as keyof typeof LABELS_ROLE] ?? u.role}
                        </Badge>
                        <span className="text-xs text-amber-600">Aguardando aceite</span>
                        <ReenviarConvite email={u.email} />
                        <DesativarUsuario usuarioId={u.id} nomeUsuario={u.nome} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Membros ativos */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-gray-400" />
                Membros ativos
                <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                  {ativos.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ativos.length === 0 ? (
                <EmptyState
                  icon={<Users className="h-6 w-6" />}
                  title="Nenhum membro ainda"
                  description="Convide colaboradores usando o formulário acima."
                />
              ) : (
                <div className="divide-y">
                  {ativos.map((u) => {
                    const isMe = u.id === admin.id
                    return (
                      <div key={u.id} className="flex items-center justify-between py-3 gap-4">
                        {/* Avatar + info */}
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-800">
                            {u.nome.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 flex items-center gap-1.5">
                              {u.nome}
                              {isMe && (
                                <span className="text-xs text-gray-400">(você)</span>
                              )}
                            </p>
                            <p className="text-sm text-gray-400 truncate">{u.email}</p>
                          </div>
                        </div>

                        {/* Ações */}
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="hidden sm:block text-xs text-gray-400">
                            {formatarDataRelativa(u.created_at)}
                          </span>
                          {isMe ? (
                            <Badge variant={BADGE_ROLE[u.role] ?? 'default'} className="text-xs">
                              {LABELS_ROLE[u.role as keyof typeof LABELS_ROLE] ?? u.role}
                            </Badge>
                          ) : (
                            <>
                              <DefinirPrincipal
                                usuarioId={u.id}
                                isPrincipal={!!u.is_advogado_principal}
                              />
                              <AlterarRole usuarioId={u.id} roleAtual={u.role} />
                              <DesativarUsuario usuarioId={u.id} nomeUsuario={u.nome} />
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </main>
    </>
  )
}
