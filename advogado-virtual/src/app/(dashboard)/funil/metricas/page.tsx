import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { MetricasFunil } from '@/components/funil/MetricasFunil'

export const metadata = { title: 'Métricas do funil' }
export const dynamic = 'force-dynamic'

export default async function MetricasFunilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: usuario } = await supabase
    .from('users').select('id, nome, role, tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) redirect('/login')
  // Métricas são de gestão — admin/advogado (a API também barra).
  if (!['admin', 'advogado'].includes(usuario.role)) redirect('/funil')

  return (
    <>
      <Header
        titulo="Métricas do funil"
        subtitulo="Conversão, valores e tempo por etapa"
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link href="/funil"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
            <ArrowLeft className="h-4 w-4" /> Voltar ao funil
          </Link>
        }
      />
      <main className="flex-1 overflow-y-auto p-6">
        <MetricasFunil />
      </main>
    </>
  )
}
