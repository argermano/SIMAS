import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { ContratoFormClient } from './ContratoFormClient'
import { ChevronLeft } from 'lucide-react'

export const metadata = { title: 'Novo Contrato de Honorários' }

export default async function NovoContratoPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  return (
    <>
      <Header
        titulo="Novo Contrato de Honorários"
        subtitulo="Gere o contrato de prestação de serviços com auxílio da IA"
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link
            href="/contratos"
            className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
            Contratos
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <ContratoFormClient role={usuario.role} />
        </div>
      </main>
    </>
  )
}
