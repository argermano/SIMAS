import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { NovoAtendimentoForm } from '@/components/atendimento/NovoAtendimentoForm'
import { ChevronLeft } from 'lucide-react'

export const metadata = { title: 'Novo atendimento' }
export const dynamic = 'force-dynamic'

// Página de criação do atendimento leve (o dono rejeitou o modal: formulário
// alto cortava em telas menores). ?clienteId= pré-fixa o cliente (entrada pela
// página do cliente); sem ele, o formulário busca/pré-cadastra pelo nome.
export default async function NovoAtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ clienteId?: string }>
}) {
  const { clienteId } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')

  // Nome do cliente resolvido no servidor (RLS garante o tenant); id inválido
  // simplesmente cai no modo global em vez de quebrar a página.
  let clienteNome: string | undefined
  if (clienteId) {
    const { data: cliente } = await supabase
      .from('clientes')
      .select('nome')
      .eq('id', clienteId)
      .single()
    clienteNome = cliente?.nome ?? undefined
  }
  const clienteValido = clienteId && clienteNome ? clienteId : undefined

  return (
    <>
      <Header
        titulo="Novo atendimento"
        subtitulo="Registre a conversa inicial com o cliente — vira caso quando você quiser"
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link
            href={clienteValido ? `/clientes/${clienteValido}` : '/atendimentos'}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          <NovoAtendimentoForm clienteId={clienteValido} clienteNome={clienteNome} />
        </div>
      </main>
    </>
  )
}
