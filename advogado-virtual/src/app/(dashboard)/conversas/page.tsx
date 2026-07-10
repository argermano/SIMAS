import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Conversas } from '@/components/conversas/Conversas'

export const metadata = { title: 'Conversas' }
export const dynamic = 'force-dynamic'

export default async function ConversasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, role, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')
  if (!['admin', 'advogado', 'colaborador'].includes(usuario.role)) redirect('/dashboard')

  // Sem <Header/>: o mock coloca o título dentro da coluna da lista e as
  // 3 colunas ocupam a área de conteúdo em altura cheia.
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Conversas email={user.email ?? ''} />
    </main>
  )
}
