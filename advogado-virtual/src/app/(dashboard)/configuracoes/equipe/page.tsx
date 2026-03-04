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
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
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
                <UserPlus className="h-5 w-5 text-primary" />
                Convidar novo membro
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
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
                  <Clock className="h-4 w-4 text-warning" />
                  Convites pendentes
                  <span className="ml-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                    {pendentes.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {pendentes.map((u) => (
                    <div key={u.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium text-foreground">{u.nome}</p>
                        <p className="text-sm text-muted-foreground">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={BADGE_ROLE[u.role] ?? 'default'} className="text-xs">
                          {LABELS_ROLE[u.role as keyof typeof LABELS_ROLE] ?? u.role}
                        </Badge>
                        <span className="text-xs text-warning">Aguardando aceite</span>
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
                <Users className="h-5 w-5 text-muted-foreground" />
                Membros ativos
                <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
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
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                            {u.nome.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground flex items-center gap-1.5">
                              {u.nome}
                              {isMe && (
                                <span className="text-xs text-muted-foreground">(você)</span>
                              )}
                            </p>
                            <p className="text-sm text-muted-foreground truncate">{u.email}</p>
                          </div>
                        </div>

                        {/* Ações */}
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="hidden sm:block text-xs text-muted-foreground">
                            {formatarDataRelativa(u.created_at)}
                          </span>
                          <DefinirPrincipal
                            usuarioId={u.id}
                            isPrincipal={!!u.is_advogado_principal}
                          />
                          {isMe ? (
                            <Badge variant={BADGE_ROLE[u.role] ?? 'default'} className="text-xs">
                              {LABELS_ROLE[u.role as keyof typeof LABELS_ROLE] ?? u.role}
                            </Badge>
                          ) : (
                            <>
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
