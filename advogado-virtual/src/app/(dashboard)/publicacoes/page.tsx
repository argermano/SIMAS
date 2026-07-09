import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { CaixaPublicacoes } from '@/components/publicacoes/CaixaPublicacoes'

export const metadata = { title: 'Publicações' }
export const dynamic = 'force-dynamic'

export default async function PublicacoesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, role, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')
  if (!['admin', 'advogado'].includes(usuario.role)) redirect('/dashboard')

  const { data: membros } = await supabase
    .from('users')
    .select('id, nome')
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'ativo')
    .order('nome')

  return (
    <>
      <Header
        titulo="Publicações"
        subtitulo="Triagem de intimações e publicações do DJEN"
        acoes={
          <Link href="/dashboard" className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </Link>
        }
        nomeUsuario={usuario.nome}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          <CaixaPublicacoes teamMembers={(membros ?? []) as { id: string; nome: string | null }[]} />
        </div>
      </main>
    </>
  )
}
