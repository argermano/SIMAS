import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AREAS } from '@/lib/constants/areas'
import { formatarDataRelativa } from '@/lib/utils'
import { LABELS_AREA, LABELS_STATUS_ATENDIMENTO } from '@/types'
import type { AtendimentoStatus, AreaJuridica } from '@/types'
import {
  Shield, Briefcase, Scale, Gavel, Receipt, Building2,
  ArrowRight, Clock, ChevronRight, Brain,
} from 'lucide-react'

export const metadata = { title: 'Início' }

const ICONE_AREA: Record<string, React.ComponentType<{ className?: string }>> = {
  Shield, Briefcase, Scale, Gavel, Receipt, Building2,
}

const BADGE_STATUS: Record<AtendimentoStatus, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  caso_novo:   { variant: 'warning',   label: 'Caso Novo'   },
  peca_gerada: { variant: 'secondary', label: 'Peça Gerada' },
  finalizado:  { variant: 'success',   label: 'Finalizado'  },
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  const { data: ultimosAtendimentos } = await supabase
    .from('atendimentos')
    .select('id, status, created_at, area, tipo_peca_origem, clientes(nome)')
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })
    .limit(5)

  const hora = new Date().getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
  const primeiroNome = (usuario.nome ?? user.email ?? 'Advogado').split(/[\s@]/)[0]

  const areasOrdenadas = Object.values(AREAS)

  return (
    <>
      <Header
        titulo={`${saudacao}, ${primeiroNome}!`}
        subtitulo="Escolha a área do Direito para começar"
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-10">

          {/* Card de acesso rápido — Análise de Caso */}
          <section>
            <Link href="/analise-caso" className="group block">
              <div className="flex items-center gap-5 rounded-2xl border-2 border-violet-200 bg-gradient-to-r from-violet-50 to-white p-6 transition-all hover:border-violet-400 hover:shadow-md">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-100">
                  <Brain className="h-7 w-7 text-violet-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 group-hover:text-violet-800">
                    Análise de Caso com IA
                  </h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    Descreva o relato do cliente — a IA identifica a área jurídica, avalia a urgência e orienta os próximos passos
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-violet-400 group-hover:text-violet-700 transition-colors" />
              </div>
            </Link>
          </section>

          {/* Cards das áreas */}
          <section aria-label="Áreas do Direito">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {areasOrdenadas.map((area) => {
                const Icone = ICONE_AREA[area.icone] ?? Shield

                if (area.ativo) {
                  return (
                    <Link key={area.id} href={`/${area.id}`} className="group block">
                      <Card className="h-full transition-all hover:shadow-card-hover group-hover:border-primary-300">
                        <CardContent className="flex flex-col gap-3 p-6">
                          <div
                            className={`flex h-14 w-14 items-center justify-center rounded-2xl ${area.corBg}`}
                          >
                            <Icone className={`h-7 w-7 ${area.corTexto}`} />
                          </div>
                          <div className="flex-1">
                            <h2 className="text-lg font-bold text-gray-900 group-hover:text-primary-800">
                              {area.nome}
                            </h2>
                            <p className="mt-1 text-sm text-gray-500">{area.descricao}</p>
                          </div>
                          <div className={`flex items-center gap-1 text-sm font-semibold ${area.corTexto}`}>
                            Acessar <ChevronRight className="h-4 w-4" />
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  )
                }

                return (
                  <div key={area.id} className="block">
                    <Card className="h-full opacity-60">
                      <CardContent className="flex flex-col gap-3 p-6">
                        <div
                          className={`flex h-14 w-14 items-center justify-center rounded-2xl ${area.corBg}`}
                        >
                          <Icone className={`h-7 w-7 ${area.corTexto}`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-gray-900">{area.nome}</h2>
                            <Badge variant="secondary" className="text-xs">Em breve</Badge>
                          </div>
                          <p className="mt-1 text-sm text-gray-500">{area.descricao}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Últimos atendimentos */}
          {ultimosAtendimentos && ultimosAtendimentos.length > 0 && (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
                  <Clock className="h-5 w-5 text-gray-400" />
                  Últimos atendimentos
                </h2>
                <Link
                  href="/historico"
                  className="flex items-center gap-1 text-sm font-medium text-primary-800 hover:underline"
                >
                  Ver todos <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="space-y-2">
                {ultimosAtendimentos.map(at => {
                  const status  = (at.status as AtendimentoStatus) ?? 'caso_novo'
                  const badge   = BADGE_STATUS[status] ?? BADGE_STATUS.caso_novo
                  const cliente = at.clientes as { nome?: string } | null
                  const area    = at.area as AreaJuridica
                  return (
                    <Link key={at.id} href={at.tipo_peca_origem ? `/${at.area}/pecas/${at.tipo_peca_origem}?id=${at.id}` : `/${at.area}`} className="block">
                      <Card className="transition-shadow hover:shadow-card-hover">
                        <CardContent className="flex items-center justify-between gap-4 py-4">
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900">
                              {cliente?.nome ?? 'Cliente'}
                            </p>
                            <p className="text-sm text-gray-500">
                              {LABELS_AREA[area] ?? area} · {formatarDataRelativa(at.created_at)}
                            </p>
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
            </section>
          )}
        </div>
      </main>
    </>
  )
}
