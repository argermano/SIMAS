import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { History } from 'lucide-react'
import { formatarDataRelativa } from '@/lib/utils'
import type { AtendimentoStatus } from '@/types'

export const metadata = { title: 'Histórico' }

const BADGE_STATUS: Record<AtendimentoStatus, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  caso_novo:   { variant: 'warning',   label: 'Caso Novo'   },
  peca_gerada: { variant: 'secondary', label: 'Peça Gerada' },
  finalizado:  { variant: 'success',   label: 'Finalizado'  },
}

const LABELS_AREA: Record<string, string> = {
  previdenciario: 'Previdenciário',
  trabalhista:    'Trabalhista',
  civel:          'Cível',
  criminal:       'Criminal',
  tributario:     'Tributário',
  empresarial:    'Empresarial',
}

export default async function HistoricoPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  const { data: atendimentos } = await supabase
    .from('atendimentos')
    .select('id, status, area, tipo_peca_origem, created_at, pedidos_especificos, clientes(id, nome)')
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <>
      <Header
        titulo="Histórico"
        subtitulo="Todos os atendimentos do escritório"
        nomeUsuario={usuario.nome}
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          {!atendimentos || atendimentos.length === 0 ? (
            <EmptyState
              icon={<History className="h-10 w-10" />}
              title="Nenhum atendimento registrado"
              description="Os atendimentos realizados aparecerão aqui."
            />
          ) : (
            <div className="space-y-2">
              {atendimentos.map(at => {
                const status  = at.status as AtendimentoStatus
                const badge   = BADGE_STATUS[status] ?? BADGE_STATUS.caso_novo
                const cliente = at.clientes as { id?: string; nome?: string } | null
                return (
                  <Link key={at.id} href={at.tipo_peca_origem ? `/${at.area}/pecas/${at.tipo_peca_origem}?id=${at.id}` : `/${at.area}`}>
                    <Card className="transition-shadow hover:shadow-card-hover">
                      <CardContent className="flex items-center justify-between gap-4 py-4">
                        <div className="min-w-0">
                          <p className="text-base font-semibold text-gray-900">
                            {cliente?.nome ?? 'Cliente'}
                          </p>
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <span>{LABELS_AREA[at.area] ?? at.area}</span>
                            <span>·</span>
                            <span>{formatarDataRelativa(at.created_at)}</span>
                          </div>
                        </div>
                        <Badge variant={badge.variant} className="shrink-0">
                          {badge.label}
                        </Badge>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
