import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { KanbanFunil, type LeadData } from '@/components/funil/KanbanFunil'

export const metadata = { title: 'Funil comercial' }
export const dynamic = 'force-dynamic'

export default async function FunilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: usuario } = await supabase
    .from('users').select('id, nome, role, tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) redirect('/login')

  const { data: leads } = await supabase
    .from('funil_leads')
    .select(`
      id, nome_informado, telefone, email, area, unidade, origem, etapa, valor_estimado,
      consulta_data, consulta_formato, meet_url, aguardando_confirmacao, sugerir_perda,
      consulta_cancelada, ultima_mensagem, ultima_mensagem_em, ultima_mensagem_autor,
      ultimo_contato_em, chatwoot_conversation_id, created_at, updated_at,
      clientes ( id, nome, status_cadastro )
    `)
    .eq('tenant_id', usuario.tenant_id)
    .order('updated_at', { ascending: false })

  const chatwootBase = process.env.CHATWOOT_PUBLIC_URL ?? ''
  const chatwootAccount = process.env.CHATWOOT_ACCOUNT_ID ?? '1'

  return (
    <>
      <Header
        titulo="Funil comercial"
        subtitulo="Leads do primeiro contato ao contrato fechado"
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link href="/funil/metricas"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
            <BarChart3 className="h-4 w-4" /> Métricas
          </Link>
        }
      />
      <main className="flex-1 overflow-hidden">
        <KanbanFunil
          leadsIniciais={(leads ?? []) as unknown as LeadData[]}
          nomeUsuario={usuario.nome ?? 'Usuário'}
          chatwootBase={chatwootBase}
          chatwootAccount={chatwootAccount}
        />
      </main>
    </>
  )
}
