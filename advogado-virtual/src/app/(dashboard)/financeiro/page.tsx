import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { PageLoading } from '@/components/ui/spinner'
import { FinanceiroClient } from '@/components/financeiro/FinanceiroClient'

export const metadata = { title: 'Financeiro' }
export const dynamic = 'force-dynamic'

export default async function FinanceiroPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, role, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')
  // Decisão do dono (Lote 1): toda a equipe vê e opera o financeiro.
  if (!['admin', 'advogado', 'colaborador'].includes(usuario.role)) redirect('/dashboard')

  return (
    <>
      <Header
        titulo="Financeiro"
        subtitulo="Parcelas de honorários — acompanhe vencimentos, envie o Pix e registre os pagamentos."
        acoes={
          <Link href="/dashboard" className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </Link>
        }
        nomeUsuario={usuario.nome}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div>
          {/* Suspense exigido pelo useSearchParams (deep-link ?contrato=) no client component */}
          <Suspense fallback={<PageLoading label="Carregando financeiro..." />}>
            <FinanceiroClient />
          </Suspense>
        </div>
      </main>
    </>
  )
}
