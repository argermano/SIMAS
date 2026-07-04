'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SeloCitacoes, type ResumoCitacoes } from '@/components/pecas/SeloCitacoes'
import { LABELS_AREA } from '@/types'
import { BookMarked, ExternalLink, Gavel, FileText } from 'lucide-react'

export interface TeseRow {
  id: string
  area: string
  status: 'sugerida' | 'aprovada' | 'rejeitada'
  tese: string
  dispositivos: string[]
  sumulas: string[]
  ementas: Array<{ tribunal?: string; processo?: string; relator?: string; julgamento?: string; ementa?: string; fonteUrl?: string; confirmadaSemFonte?: boolean }>
  quando_usar: string | null
  notas: string | null
  verificacao: ResumoCitacoes | null
  origem_arquivo: string | null
  trecho_origem: string | null
  motivo_rejeicao: string | null
}

const nomeArea = (a: string) => LABELS_AREA[a as keyof typeof LABELS_AREA] ?? a

export function BibliotecaTeses({ teses, podeCurar }: { teses: TeseRow[]; podeCurar: boolean }) {
  const aprovadas = teses.filter((t) => t.status === 'aprovada')
  const sugestoes = teses.filter((t) => t.status === 'sugerida')
  const [aba, setAba] = useState<'aprovadas' | 'sugestoes'>(sugestoes.length > 0 && podeCurar ? 'sugestoes' : 'aprovadas')

  const lista = aba === 'aprovadas' ? aprovadas : sugestoes

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-info/30 bg-info/5 p-4 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <BookMarked className="h-4 w-4 text-info" /> Como funciona
        </p>
        <p className="mt-1">
          As teses <strong>aprovadas</strong> são conferidas pelo escritório e passam a fundamentar as peças da área
          correspondente — o modelo pode citá-las <strong>sem</strong> o alerta <code>[VERIFICAR]</code>. Envie peças do
          escritório para a IA <strong>sugerir</strong> teses; você revisa e aprova. Nada é gerado por IA sem sua conferência.
        </p>
      </div>

      {/* Abas */}
      <div className="flex items-center gap-1 border-b border-border">
        <Aba ativa={aba === 'aprovadas'} onClick={() => setAba('aprovadas')} label="Aprovadas" n={aprovadas.length} />
        {podeCurar && <Aba ativa={aba === 'sugestoes'} onClick={() => setAba('sugestoes')} label="Sugestões" n={sugestoes.length} destaque />}
      </div>

      {lista.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Gavel className="h-8 w-8 opacity-60" />
          <p className="text-sm">
            {aba === 'aprovadas'
              ? 'Nenhuma tese aprovada ainda.'
              : 'Nenhuma sugestão pendente. Envie peças do escritório para a IA identificar teses.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map((t) => (
            <Card key={t.id}>
              <CardContent className="space-y-2 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-foreground">{t.tese}</p>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="secondary" className="text-xs">{nomeArea(t.area)}</Badge>
                    {t.status === 'sugerida' && t.verificacao && t.verificacao.total > 0 && (
                      <SeloCitacoes citacoes={t.verificacao} />
                    )}
                  </div>
                </div>

                {t.dispositivos.length > 0 && (
                  <p className="text-sm text-muted-foreground"><span className="font-medium">Fundamentos:</span> {t.dispositivos.join('; ')}</p>
                )}
                {t.sumulas.length > 0 && (
                  <p className="text-sm text-muted-foreground"><span className="font-medium">Súmulas:</span> {t.sumulas.join('; ')}</p>
                )}
                {t.quando_usar && <p className="text-xs italic text-muted-foreground">Quando usar: {t.quando_usar}</p>}

                {t.ementas.length > 0 && (
                  <div className="space-y-2 border-t pt-2">
                    {t.ementas.map((e, i) => (
                      <blockquote key={i} className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
                        {e.ementa && <p className="italic">&ldquo;{e.ementa}&rdquo;</p>}
                        <p className="mt-0.5 text-xs">
                          {[e.tribunal, e.processo, e.relator, e.julgamento && `j. ${e.julgamento}`].filter(Boolean).join(', ')}
                          {e.fonteUrl && (
                            <a href={e.fonteUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">
                              fonte <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </p>
                      </blockquote>
                    ))}
                  </div>
                )}

                {t.status === 'sugerida' && t.origem_arquivo && (
                  <p className="flex items-center gap-1 pt-1 text-[11px] text-muted-foreground/70">
                    <FileText className="h-3 w-3" /> minerada de: {t.origem_arquivo}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Aba({ ativa, onClick, label, n, destaque }: { ativa: boolean; onClick: () => void; label: string; n: number; destaque?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        ativa ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
      {n > 0 && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${destaque && !ativa ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'}`}>{n}</span>
      )}
    </button>
  )
}
