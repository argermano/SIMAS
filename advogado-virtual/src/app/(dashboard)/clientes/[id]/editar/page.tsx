import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { FormCliente } from '@/components/clientes/FormCliente'
import { ChevronLeft } from 'lucide-react'

export const metadata = { title: 'Editar Cliente' }

export default async function EditarClientePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!cliente) notFound()

  return (
    <>
      <Header
        titulo="Editar Cliente"
        subtitulo={cliente.nome}
        nomeUsuario={usuario.nome}
        acoes={
          <Link
            href={`/clientes/${id}`}
            className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
            Dossiê
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="pt-6">
              <FormCliente cliente={cliente} />
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
