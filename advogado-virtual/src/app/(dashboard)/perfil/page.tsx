import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { preferenciasEfetivas } from '@/lib/notificacoes/catalogo'
import { PerfilClient } from './PerfilClient'

export const metadata = { title: 'Meu perfil' }

export default async function PerfilPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, email, celular, unidade, notificacoes')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')

  return (
    <>
      <Header
        titulo="Meu perfil"
        subtitulo="Seus dados e como você quer ser avisado"
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <PerfilClient
            inicial={{
              nome: usuario.nome ?? '',
              email: usuario.email ?? '',
              celular: usuario.celular ?? null,
              unidade: usuario.unidade ?? null,
              notificacoes: preferenciasEfetivas(usuario.notificacoes),
            }}
          />
        </div>
      </main>
    </>
  )
}
