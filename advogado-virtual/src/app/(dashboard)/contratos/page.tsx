import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatarDataRelativa } from '@/lib/utils'
import { FileSignature, Plus, ChevronRight } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { BotaoExcluirContrato } from '@/components/contratos/BotaoExcluirContrato'
import { FiltroContratosClient } from './FiltroContratosClient'

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

export default async function ContratosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>
}) {
  const { q = '', status = '', page = '1' } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  const pageNum = parseInt(page)
  const limit   = 20
  const offset  = (pageNum - 1) * limit

  let query = supabase
    .from('contratos_honorarios')
    .select('id, titulo, area, status, valor_fixo, percentual_exito, created_at, clientes(nome)', { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (q) {
    query = query.or(`titulo.ilike.%${q}%,clientes.nome.ilike.%${q}%`)
  }

  if (status) {
    query = query.eq('status', status)
  }

  const { data: contratos, count } = await query

  const totalPaginas = Math.ceil((count ?? 0) / limit)

  const baseParams = new URLSearchParams()
  if (q) baseParams.set('q', q)
  if (status) baseParams.set('status', status)
  const baseStr = baseParams.toString()

  return (
    <>
      <Header
        titulo="Contratos de Honorários"
        subtitulo={`${count ?? 0} contrato${(count ?? 0) !== 1 ? 's' : ''}`}
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link
            href="/contratos/novo"
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Novo contrato
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          <FiltroContratosClient busca={q} statusAtivo={status} />

          {!contratos || contratos.length === 0 ? (
            <EmptyState
              icon={<FileSignature className="h-10 w-10" />}
              title={q ? 'Nenhum contrato encontrado' : status ? 'Nenhum contrato com esse status' : 'Nenhum contrato ainda'}
              description={
                q
                  ? `Nenhum contrato encontrado para "${q}". Tente outro termo.`
                  : status
                    ? 'Nenhum contrato com o status selecionado.'
                    : 'Crie seu primeiro contrato de honorários advocatícios com auxílio da IA.'
              }
              action={
                q || status
                  ? undefined
                  : { label: 'Criar contrato', href: '/contratos/novo' }
              }
            />
          ) : (
            <>
              <div className="space-y-3">
                {(contratos ?? []).map(c => {
                  const badge = BADGE_STATUS[c.status] ?? BADGE_STATUS.rascunho
                  const honorario = c.valor_fixo
                    ? `R$ ${(c.valor_fixo as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                    : c.percentual_exito !== null
                      ? `${c.percentual_exito}% êxito`
                      : '—'
                  const clienteNome = Array.isArray(c.clientes)
                    ? (c.clientes[0] as { nome?: string })?.nome
                    : (c.clientes as { nome?: string } | null)?.nome

                  return (
                    <Link key={c.id} href={`/contratos/${c.id}`} className="block">
                      <Card className="transition-shadow hover:shadow-card-hover">
                        <CardContent className="flex items-center justify-between gap-4 py-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-foreground truncate">{c.titulo}</p>
                              <Badge variant={badge.variant}>{badge.label}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {clienteNome ?? 'Sem cliente'}
                              {c.area ? ` · ${LABEL_AREA[c.area] ?? c.area}` : ''}
                              {` · ${honorario}`}
                              {` · ${formatarDataRelativa(c.created_at)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <BotaoExcluirContrato contratoId={c.id} />
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  )
                })}
              </div>

              {/* Paginação */}
              {totalPaginas > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  {pageNum > 1 && (
                    <Link href={`/contratos?${baseStr}${baseStr ? '&' : ''}page=${pageNum - 1}`}>
                      <button className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
                        ← Anterior
                      </button>
                    </Link>
                  )}
                  <span className="text-sm text-muted-foreground">
                    Página {pageNum} de {totalPaginas}
                  </span>
                  {pageNum < totalPaginas && (
                    <Link href={`/contratos?${baseStr}${baseStr ? '&' : ''}page=${pageNum + 1}`}>
                      <button className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
                        Próxima →
                      </button>
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  )
}
