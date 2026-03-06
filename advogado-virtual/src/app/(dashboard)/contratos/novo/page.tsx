import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { ContratoFormClient } from './ContratoFormClient'
import { ChevronLeft } from 'lucide-react'

export const metadata = { title: 'Novo Contrato de Honorários' }

export default async function NovoContratoPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente_id?: string }>
}) {
  const { cliente_id } = await searchParams

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome, role, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  // Se veio do dossiê do cliente, buscar nome para pré-preencher
  let clienteInicial: { id: string; nome: string } | undefined
  if (cliente_id) {
    const { data: cli } = await supabase
      .from('clientes')
      .select('id, nome')
      .eq('id', cliente_id)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (cli) clienteInicial = { id: cli.id, nome: cli.nome }
  }

  return (
    <>
      <Header
        titulo="Novo Contrato de Honorários"
        subtitulo="Gere o contrato de prestação de serviços com auxílio da IA"
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link
            href="/contratos"
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Contratos
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <ContratoFormClient role={usuario.role} clienteInicial={clienteInicial} />
        </div>
      </main>
    </>
  )
}
