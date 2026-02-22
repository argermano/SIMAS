import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { LABELS_ROLE } from '@/types'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // Verificação de autenticação
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Busca perfil do usuário no banco
  const { data: usuario } = await supabase
    .from('users')
    .select('nome, role, tenant_id, tenants(nome)')
    .eq('auth_user_id', user.id)
    .single()

  const nomeUsuario   = usuario?.nome    ?? user.email ?? 'Usuário'
  const roleUsuario   = usuario?.role    ? LABELS_ROLE[usuario.role as keyof typeof LABELS_ROLE] : 'Advogado(a)'
  const nomeEscritorio = (usuario?.tenants as { nome?: string } | null)?.nome ?? 'Meu Escritório'

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        nomeUsuario={nomeUsuario}
        nomeEscritorio={nomeEscritorio}
        roleUsuario={roleUsuario}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}
