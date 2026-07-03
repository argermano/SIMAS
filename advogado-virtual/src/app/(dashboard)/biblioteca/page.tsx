import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { TESES_POR_AREA } from '@/lib/fundamentacao'
import { LABELS_AREA } from '@/types'
import { BookMarked, ExternalLink, ScrollText, Gavel } from 'lucide-react'

export const metadata = { title: 'Biblioteca de teses' }

export default async function BibliotecaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: usuario } = await supabase
    .from('users').select('nome').eq('auth_user_id', user.id).single()

  const areas = Object.entries(TESES_POR_AREA)
    .map(([area, teses]) => ({ area, teses }))
    .filter(({ teses }) => teses.length > 0)

  const totalReais = areas.reduce((n, a) => n + a.teses.filter((t) => !t.exemplo).length, 0)

  return (
    <>
      <Header
        titulo="Biblioteca de teses"
        subtitulo="Fundamentação verificada pelo escritório — usada na geração das peças"
        nomeUsuario={usuario?.nome ?? user.email ?? 'Usuário'}
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          <div className="rounded-xl border border-info/30 bg-info/5 p-4 text-sm text-muted-foreground">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <BookMarked className="h-4 w-4 text-info" /> Como funciona
            </p>
            <p className="mt-1">
              As teses aqui são <strong>conferidas por advogado</strong> e injetadas na geração das peças da área
              correspondente — o modelo pode citá-las <strong>sem</strong> o alerta <code>[VERIFICAR]</code>. A edição é
              feita no repositório (ativo versionado, com trilha de revisão): arquivos em{' '}
              <code>src/lib/fundamentacao/&#123;área&#125;.ts</code>. Nada aqui é gerado por IA.
            </p>
          </div>

          {totalReais === 0 ? (
            <EmptyState
              icon={<Gavel className="h-8 w-8" />}
              title="Nenhuma tese curada ainda"
              description="Quando o escritório cadastrar teses verificadas (no repositório), elas aparecerão aqui e passarão a fundamentar as peças automaticamente."
            />
          ) : (
            areas.map(({ area, teses }) => (
              <Card key={area}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <ScrollText className="h-5 w-5 text-primary" />
                    {LABELS_AREA[area as keyof typeof LABELS_AREA] ?? area}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({teses.filter((t) => !t.exemplo).length} tese{teses.filter((t) => !t.exemplo).length === 1 ? '' : 's'})
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {teses.map((t) => (
                    <div key={t.id} className="rounded-lg border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-foreground">{t.tese}</p>
                        {t.exemplo && <Badge variant="secondary" className="shrink-0 text-[10px]">exemplo</Badge>}
                      </div>
                      {t.dispositivos.length > 0 && (
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          <span className="font-medium">Fundamentos:</span> {t.dispositivos.join('; ')}
                        </p>
                      )}
                      {t.sumulas.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium">Súmulas:</span> {t.sumulas.join('; ')}
                        </p>
                      )}
                      {t.quandoUsar && (
                        <p className="mt-1 text-xs text-muted-foreground italic">Quando usar: {t.quandoUsar}</p>
                      )}
                      {t.ementas.length > 0 && (
                        <div className="mt-2 space-y-2 border-t pt-2">
                          {t.ementas.map((e, i) => (
                            <blockquote key={i} className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
                              <p className="italic">&ldquo;{e.ementa}&rdquo;</p>
                              <p className="mt-1 text-xs">
                                {e.tribunal}, {e.processo}, {e.relator}, j. {e.julgamento}
                                {e.fonteUrl && (
                                  <a href={e.fonteUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">
                                    fonte <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </p>
                              <p className="text-[10px] text-muted-foreground/70">conferido por {e.verificadoPor} em {e.verificadoEm}</p>
                            </blockquote>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>
    </>
  )
}
