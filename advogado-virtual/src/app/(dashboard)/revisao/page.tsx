import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { BotoesRevisao } from './BotoesRevisao'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { Calendar, ScrollText, User, ChevronRight } from 'lucide-react'
import { formatarDataRelativa } from '@/lib/utils'

const ROLES_REVISORES = ['admin', 'advogado']

const LABELS_AREA: Record<string, string> = {
  previdenciario: 'Previdenciário',
  civel:          'Cível',
  trabalhista:    'Trabalhista',
  criminal:       'Criminal',
  tributario:     'Tributário',
  empresarial:    'Empresarial',
}

export default async function RevisaoPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  if (!ROLES_REVISORES.includes(usuario.role)) {
    redirect('/dashboard')
  }

  // Busca peças aguardando revisão com dados do atendimento, cliente e criador
  const { data: pecas } = await supabase
    .from('pecas')
    .select(`
      id, tipo, area, status, created_at,
      atendimentos(
        id, area,
        clientes(id, nome)
      ),
      users!pecas_created_by_fkey(id, nome, role)
    `)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aguardando_revisao')
    .order('created_at', { ascending: true })

  return (
    <>
      <Header
        titulo="Fila de Revisão"
        subtitulo="Peças aguardando aprovação de revisor ou advogado"
        nomeUsuario={usuario.nome}
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          {(!pecas || pecas.length === 0) ? (
            <EmptyState
              icon={<ScrollText className="h-8 w-8" />}
              title="Nenhuma peça aguardando revisão"
              description="Quando estagiários gerarem peças, elas aparecerão aqui para aprovação."
            />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 mb-4">
                {pecas.length} peça{pecas.length > 1 ? 's' : ''} aguardando revisão
              </p>

              {pecas.map((peca) => {
                const atendimento = peca.atendimentos as unknown as {
                  id: string
                  area: string
                  clientes: { id: string; nome: string } | null
                } | null
                const criador = peca.users as unknown as { id: string; nome: string; role: string } | null
                const tipoPeca = TIPOS_PECA[peca.tipo]

                return (
                  <Card key={peca.id} className="overflow-hidden">
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          {/* Tipo e área */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <ScrollText className="h-4 w-4 text-emerald-500 shrink-0" />
                            <span className="font-semibold text-gray-900">
                              {tipoPeca?.nome ?? peca.tipo}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {LABELS_AREA[peca.area] ?? peca.area}
                            </Badge>
                            <Badge variant="warning" className="text-xs">
                              Aguardando Revisão
                            </Badge>
                          </div>

                          {/* Cliente */}
                          {atendimento?.clientes && (
                            <div className="mt-1.5 flex items-center gap-1.5 text-sm text-gray-600">
                              <User className="h-3.5 w-3.5 text-gray-400" />
                              <Link
                                href={`/clientes/${atendimento.clientes.id}`}
                                className="font-medium hover:text-primary-800 hover:underline"
                              >
                                {atendimento.clientes.nome}
                              </Link>
                            </div>
                          )}

                          {/* Criador e data */}
                          <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                            {criador && (
                              <span>Gerada por <span className="text-gray-600">{criador.nome}</span></span>
                            )}
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatarDataRelativa(peca.created_at)}
                            </span>
                          </div>

                          {/* Botões de revisão */}
                          <BotoesRevisao pecaId={peca.id} />
                        </div>

                        {/* Link para o editor */}
                        <Link
                          href={`/${peca.area}/editor/${peca.id}`}
                          className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                          title="Ver peça no editor"
                          target="_blank"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
