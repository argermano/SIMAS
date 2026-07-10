import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AgendaCalendario } from '@/components/agenda/AgendaCalendario'
import type { Pessoa } from '@/lib/agenda/tipos'

export const metadata = { title: 'Agenda' }
export const dynamic = 'force-dynamic'

const ROLES_PERMITIDOS = ['admin', 'advogado', 'colaborador']

export default async function AgendaPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, role, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')
  if (!ROLES_PERMITIDOS.includes(usuario.role)) redirect('/dashboard')

  // Pessoas do tenant (para o filtro Pessoas e o EventoModal).
  const { data: membros } = await supabase
    .from('users')
    .select('id, nome')
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'ativo')
    .order('nome')

  const pessoas = (membros ?? []) as Pessoa[]

  // O cabeçalho editorial da agenda (título "Agenda." + toolbar) é renderizado
  // pelo próprio AgendaCalendario/BarraTopo — sem o <Header> padrão do dashboard.
  // overflow-y-auto: a página rola verticalmente (coluna direita sticky).
  return (
    <main className="flex-1 overflow-y-auto">
      <AgendaCalendario meUserId={usuario.id} pessoas={pessoas} />
    </main>
  )
}
