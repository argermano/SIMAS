import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatarDataRelativa } from '@/lib/utils'
import { FileSignature, Plus, ChevronRight } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export const metadata = { title: 'Contratos de Honorários' }

const BADGE_STATUS: Record<string, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  rascunho:   { variant: 'secondary', label: 'Rascunho'   },
  em_revisao: { variant: 'warning',   label: 'Em revisão' },
  aprovado:   { variant: 'success',   label: 'Aprovado'   },
  exportado:  { variant: 'success',   label: 'Exportado'  },
}

const LABEL_AREA: Record<string, string> = {
  previdenciario: 'Previdenciário',
  trabalhista:    'Trabalhista',
  civel:          'Cível',
  criminal:       'Criminal',
  tributario:     'Tributário',
  empresarial:    'Empresarial',
  familia:        'Família',
  consumidor:     'Consumidor',
  imobiliario:    'Imobiliário',
  administrativo: 'Administrativo',
}

type ContratoRow = {
  id: string
  titulo: string
  area: string | null
  status: string
  valor_fixo: number | null
  percentual_exito: number | null
  created_at: string
  clientes: { nome: string } | null
}

export default async function ContratosPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  const { data: contratos } = await supabase
    .from('contratos_honorarios')
    .select('id, titulo, area, status, valor_fixo, percentual_exito, created_at, clientes(nome)')
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <>
      <Header
        titulo="Contratos de Honorários"
        subtitulo="Gerencie contratos de prestação de serviços advocatícios"
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link
            href="/contratos/novo"
            className="flex items-center gap-2 rounded-lg bg-primary-800 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-900 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Novo contrato
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          {!contratos || contratos.length === 0 ? (
            <EmptyState
              icon={<FileSignature className="h-10 w-10" />}
              title="Nenhum contrato ainda"
              description="Crie seu primeiro contrato de honorários advocatícios com auxílio da IA."
              action={{ label: 'Criar contrato', href: '/contratos/novo' }}
            />
          ) : (
            <div className="space-y-3">
              {(contratos ?? []).map(c => {
                const badge = BADGE_STATUS[c.status] ?? BADGE_STATUS.rascunho
                const honorario = c.valor_fixo
                  ? `R$ ${(c.valor_fixo as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                  : c.percentual_exito !== null
                    ? `${c.percentual_exito}% êxito`
                    : '—'
                // Supabase returns clientes as array or single object
                const clienteNome = Array.isArray(c.clientes)
                  ? (c.clientes[0] as { nome?: string })?.nome
                  : (c.clientes as { nome?: string } | null)?.nome

                return (
                  <Link key={c.id} href={`/contratos/${c.id}`} className="block">
                    <Card className="transition-shadow hover:shadow-card-hover">
                      <CardContent className="flex items-center justify-between gap-4 py-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-gray-900 truncate">{c.titulo}</p>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </div>
                          <p className="text-sm text-gray-500 mt-0.5">
                            {clienteNome ?? 'Sem cliente'}
                            {c.area ? ` · ${LABEL_AREA[c.area] ?? c.area}` : ''}
                            {` · ${honorario}`}
                            {` · ${formatarDataRelativa(c.created_at)}`}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
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
