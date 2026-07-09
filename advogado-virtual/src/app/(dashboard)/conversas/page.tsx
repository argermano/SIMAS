import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
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
  if (!['admin', 'advogado'].includes(usuario.role)) redirect('/dashboard')

  return (
    <>
      <Header
        titulo="Conversas"
        subtitulo="Atendimento omnichannel (WhatsApp DF/SC) — leia as conversas e responda pela sua conta conectada."
        acoes={
          <Link href="/dashboard" className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </Link>
        }
        nomeUsuario={usuario.nome}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl">
          <Conversas email={user.email ?? ''} />
        </div>
      </main>
    </>
  )
}
