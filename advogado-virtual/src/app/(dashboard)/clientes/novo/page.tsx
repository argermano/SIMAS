import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { FormCliente } from '@/components/clientes/FormCliente'
import { UserPlus, ChevronLeft } from 'lucide-react'
import Link from 'next/link'

export const metadata = { title: 'Novo Cliente' }

export default async function NovoClientePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome')
    .eq('auth_user_id', user.id)
    .single()

  return (
    <>
      <Header
        titulo="Novo Cliente"
        subtitulo="Preencha os dados para cadastrar o cliente"
        nomeUsuario={usuario?.nome ?? ''}
        acoes={
          <Link
            href="/clientes"
            className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
            Clientes
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 flex items-center gap-3 rounded-xl bg-primary-50 border border-primary-100 px-5 py-4">
            <UserPlus className="h-6 w-6 shrink-0 text-primary-800" />
            <div>
              <p className="text-base font-semibold text-primary-900">Cadastro de novo cliente</p>
              <p className="text-sm text-primary-700">
                Apenas o nome é obrigatório. Os demais dados podem ser adicionados depois.
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="pt-6">
              <FormCliente />
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
