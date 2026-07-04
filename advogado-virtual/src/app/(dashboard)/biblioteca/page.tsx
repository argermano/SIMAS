import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { BibliotecaTeses, type TeseRow } from '@/components/biblioteca/BibliotecaTeses'

export const metadata = { title: 'Biblioteca de teses' }
export const dynamic = 'force-dynamic'

export default async function BibliotecaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: usuario } = await supabase
    .from('users').select('nome, role, tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) redirect('/login')

  const { data: teses } = await supabase
    .from('teses_escritorio')
    .select('id, area, status, tese, dispositivos, sumulas, ementas, quando_usar, notas, verificacao, origem_arquivo, trecho_origem, motivo_rejeicao')
    .eq('tenant_id', usuario.tenant_id)
    .in('status', ['sugerida', 'aprovada'])
    .order('sugerida_em', { ascending: false })

  const podeCurar = usuario.role === 'admin' || usuario.role === 'advogado'

  return (
    <>
      <Header
        titulo="Biblioteca de teses"
        subtitulo="Fundamentação verificada pelo escritório — usada na geração das peças"
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          <BibliotecaTeses teses={(teses ?? []) as TeseRow[]} podeCurar={podeCurar} />
        </div>
      </main>
    </>
  )
}
