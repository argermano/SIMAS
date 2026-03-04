'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Route, ShieldCheck, ShieldAlert, AlertTriangle,
  FileCheck, HelpCircle, Lightbulb, FileText,
} from 'lucide-react'

interface AnaliseData {
  resumo_didatico?: string
  caminho_processual?: {
    recomendado: string
    motivo: string
    alternativas?: Array<{ nome: string; motivo: string; quando_preferir: string }>
  }
  plano_a?: { titulo: string; descricao: string; fundamento_legal: string; probabilidade: string; pre_requisitos: string }
  plano_b?: { titulo: string; descricao: string; fundamento_legal: string; probabilidade: string; pre_requisitos: string }
  riscos?: Array<{ tipo: string; descricao: string; severidade: string; como_mitigar: string }>
  checklist_documentos?: Array<{ documento: string; classificacao: string; status: string; observacao?: string }>
  perguntas_faltantes?: Array<{ pergunta: string; motivo: string }>
  acoes_sugeridas?: Array<{ tipo_peca: string; label: string; descricao: string; prioridade: number }>
}

const BADGE_SEV: Record<string, string> = {
  alta:  'bg-destructive/10 text-destructive',
  media: 'bg-warning/10 text-warning',
  baixa: 'bg-success/10 text-success',
}

const BADGE_DOC: Record<string, string> = {
  fornecido:  'bg-success/10 text-success',
  incompleto: 'bg-warning/10 text-warning',
  faltante:   'bg-destructive/10 text-destructive',
}

export function RelatorioAnalise({ data, onGerarPeca }: { data: AnaliseData; onGerarPeca?: (tipo: string) => void }) {
  return (
    <div className="space-y-4">

      {/* Resumo */}
      {data.resumo_didatico && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />
              Resumo do caso
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-foreground">{data.resumo_didatico}</p>
          </CardContent>
        </Card>
      )}

      {/* Caminho processual */}
      {data.caminho_processual && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Route className="h-4 w-4 text-primary" />
              Caminho processual recomendado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="font-semibold text-foreground">{data.caminho_processual.recomendado}</p>
            <p className="text-sm text-muted-foreground">{data.caminho_processual.motivo}</p>
            {data.caminho_processual.alternativas && data.caminho_processual.alternativas.length > 0 && (
              <div className="mt-2 rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-semibold text-muted-foreground mb-1">ALTERNATIVAS</p>
                {data.caminho_processual.alternativas.map((alt, i) => (
                  <div key={i} className="text-sm text-muted-foreground mt-1">
                    <span className="font-medium">{alt.nome}</span> — {alt.motivo}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Planos A e B */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.plano_a && (
          <Card className="border-success/20">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-success" />
                Plano A
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p className="font-semibold">{data.plano_a.titulo}</p>
              <p className="text-muted-foreground">{data.plano_a.descricao}</p>
              <p className="text-xs text-muted-foreground">Fundamento: {data.plano_a.fundamento_legal}</p>
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_SEV[data.plano_a.probabilidade] ?? BADGE_SEV.media}`}>
                Probabilidade: {data.plano_a.probabilidade}
              </span>
            </CardContent>
          </Card>
        )}
        {data.plano_b && (
          <Card className="border-amber-200">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                Plano B
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p className="font-semibold">{data.plano_b.titulo}</p>
              <p className="text-muted-foreground">{data.plano_b.descricao}</p>
              <p className="text-xs text-muted-foreground">Fundamento: {data.plano_b.fundamento_legal}</p>
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_SEV[data.plano_b.probabilidade] ?? BADGE_SEV.media}`}>
                Probabilidade: {data.plano_b.probabilidade}
              </span>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Riscos */}
      {data.riscos && data.riscos.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Riscos ({data.riscos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.riscos.map((r, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_SEV[r.severidade] ?? BADGE_SEV.media}`}>
                      {r.severidade}
                    </span>
                    <span className="text-sm font-medium text-foreground">{r.tipo}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{r.descricao}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Mitigação: {r.como_mitigar}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Checklist de documentos */}
      {data.checklist_documentos && data.checklist_documentos.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCheck className="h-4 w-4 text-primary" />
              Checklist de documentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {data.checklist_documentos.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium text-foreground">{d.documento}</span>
                    {d.observacao && <span className="ml-2 text-xs text-muted-foreground">({d.observacao})</span>}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_DOC[d.status] ?? BADGE_DOC.faltante}`}>
                    {d.status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Perguntas faltantes */}
      {data.perguntas_faltantes && data.perguntas_faltantes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <HelpCircle className="h-4 w-4 text-primary" />
              Perguntas faltantes ({data.perguntas_faltantes.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 list-decimal list-inside">
              {data.perguntas_faltantes.map((p, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-foreground">{p.pergunta}</span>
                  <br />
                  <span className="text-xs text-muted-foreground ml-5">{p.motivo}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Ações sugeridas */}
      {data.acoes_sugeridas && data.acoes_sugeridas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Ações sugeridas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.acoes_sugeridas.map((a, i) => (
                <button
                  key={i}
                  onClick={() => onGerarPeca?.(a.tipo_peca)}
                  className="flex w-full items-center justify-between rounded-lg border-2 border-border bg-card p-3 text-left transition-all hover:border-primary/30 hover:bg-primary/10"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{a.label}</p>
                    <p className="text-xs text-muted-foreground">{a.descricao}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Gerar
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
