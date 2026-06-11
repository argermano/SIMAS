import type { CSSProperties } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { TaskDueNotification } from '@/components/layout/TaskDueNotification'
import { carregarEstiloTenant } from '@/lib/format/estilo-documento'
import { LABELS_ROLE } from '@/types'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // Verificação de autenticação
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Busca perfil do usuário no banco
  const { data: usuario } = await supabase
    .from('users')
    .select('nome, role, tenant_id, tenants(nome)')
    .eq('auth_user_id', user.id)
    .single()

  const nomeUsuario    = usuario?.nome ?? user.email ?? 'Usuário'
  const roleRaw        = usuario?.role ?? 'advogado'
  const roleUsuario    = LABELS_ROLE[roleRaw as keyof typeof LABELS_ROLE] ?? 'Advogado(a)'
  const nomeEscritorio = (usuario?.tenants as { nome?: string } | null)?.nome ?? 'Meu Escritório'

  // Estilo de formatação do escritório → CSS vars herdadas por editores/previews
  // (.ProseMirror e o preview do EditorPeca leem var(--doc-*) com fallback ABNT).
  const estilo = usuario?.tenant_id ? await carregarEstiloTenant(supabase, usuario.tenant_id) : null
  const docVars = estilo
    ? ({
        '--doc-font': `'${estilo.fonte}', 'Times New Roman', serif`,
        '--doc-size': `${estilo.tamanhoPt}pt`,
        '--doc-ementa-size': `${estilo.tamanhoEmentaPt}pt`,
        '--doc-line-height': `${estilo.entrelinha}`,
        '--doc-indent': `${estilo.recuoPrimeiraLinhaCm}cm`,
        '--doc-blockquote-indent': `${estilo.recuoBlockquoteCm}cm`,
        '--doc-margin-top': `${estilo.margensCm.topo}cm`,
        '--doc-margin-right': `${estilo.margensCm.direita}cm`,
        '--doc-margin-bottom': `${estilo.margensCm.baixo}cm`,
        '--doc-margin-left': `${estilo.margensCm.esquerda}cm`,
      } as CSSProperties)
    : undefined

  return (
    <div className="flex h-screen overflow-hidden bg-background" style={docVars}>
      <Sidebar
        nomeUsuario={nomeUsuario}
        nomeEscritorio={nomeEscritorio}
        roleUsuario={roleUsuario}
        roleRaw={roleRaw}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TaskDueNotification />
        {children}
      </div>
    </div>
  )
}
