import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AREAS } from '@/lib/constants/areas'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { ChevronLeft, Zap, Brain } from 'lucide-react'

export const metadata = { title: 'Novo Atendimento' }

export default async function NovoAtendimentoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')

  const { data: cliente } = await supabase
    .from('clientes')
    .select('nome')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!cliente) notFound()

  const areasAtivas = Object.values(AREAS).filter((a) => a.ativo)

  return (
    <>
      <Header
        titulo="Novo Atendimento"
        subtitulo={`Cliente: ${cliente.nome}`}
        nomeUsuario={usuario.nome}
        acoes={
          <Button asChild variant="secondary" size="md">
            <Link href={`/clientes/${id}`}>
              <ChevronLeft className="h-4 w-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <p className="text-muted-foreground">
            Escolha a área jurídica e o tipo de peça para iniciar o atendimento de{' '}
            <strong className="text-foreground">{cliente.nome}</strong>.
          </p>

          {areasAtivas.map((area) => (
            <Card key={area.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{area.nome}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Peças com IA */}
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Zap className="h-3.5 w-3.5" />
                    Peças com IA
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {area.pecas.map((tipoPecaId) => {
                      const tipo = TIPOS_PECA[tipoPecaId]
                      if (!tipo) return null
                      return (
                        <Link
                          key={tipo.id}
                          href={`/${area.id}/pecas/${tipo.id}?clienteId=${id}`}
                          className="group flex flex-col rounded-xl border-2 border-border bg-card p-3 text-left transition-all hover:border-primary/30 hover:bg-primary/10 hover:shadow-sm"
                        >
                          <span className="text-sm font-semibold text-foreground group-hover:text-primary leading-tight">
                            {tipo.nome}
                          </span>
                          <span className="mt-0.5 text-xs text-muted-foreground leading-tight">
                            {tipo.descricao}
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                </div>

                {/* Consultoria */}
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Brain className="h-3.5 w-3.5" />
                    Consultoria / Análise IA
                  </div>
                  <Link
                    href={`/${area.id}/consultoria?clienteId=${id}`}
                    className="group inline-flex flex-col rounded-xl border-2 border-border bg-card px-4 py-3 text-left transition-all hover:border-primary/30 hover:bg-primary/5"
                  >
                    <span className="text-sm font-semibold text-foreground group-hover:text-primary">
                      Análise de Caso
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Consultoria jurídica completa com IA
                    </span>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </>
  )
}
