'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react'

interface ValidacaoData {
  coerencia?: { status: string; itens: Array<{ item: string; status: string; sugestao?: string }> }
  itens_essenciais?: { status: string; itens: Array<{ item: string; status: string; observacao?: string }> }
  legislacao?: { status: string; citacoes: Array<{ referencia: string; status: string; sugestao?: string }> }
  jurisprudencia?: { status: string; citacoes: Array<{ referencia: string; status: string; sugestao?: string }> }
  score_confianca?: number
  correcoes_sugeridas?: Array<{ tipo: string; descricao: string; prioridade: string }>
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  validado:     <CheckCircle className="h-4 w-4 text-green-600" />,
  parcial:      <AlertTriangle className="h-4 w-4 text-amber-600" />,
  nao_validado: <XCircle className="h-4 w-4 text-red-600" />,
  inconsistente: <XCircle className="h-4 w-4 text-red-600" />,
}

const STATUS_BADGE: Record<string, string> = {
  validado:      'bg-green-100 text-green-700',
  parcial:       'bg-amber-100 text-amber-700',
  nao_validado:  'bg-red-100 text-red-700',
  inconsistente: 'bg-red-100 text-red-700',
}

function ScoreCircle({ score }: { score: number }) {
  const cor = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-600' : 'text-red-600'
  const bgCor = score >= 80 ? 'border-green-200' : score >= 60 ? 'border-amber-200' : 'border-red-200'
  return (
    <div className={`flex h-20 w-20 items-center justify-center rounded-full border-4 ${bgCor}`}>
      <span className={`text-2xl font-bold ${cor}`}>{score}</span>
    </div>
  )
}

export function RelatorioValidacao({ data, onCorrecao }: { data: ValidacaoData; onCorrecao?: (tipo: string) => void }) {
  return (
    <div className="space-y-4">
      {/* Score */}
      {data.score_confianca !== undefined && (
        <Card>
          <CardContent className="flex items-center gap-6 py-6">
            <ScoreCircle score={data.score_confianca} />
            <div>
              <p className="text-lg font-bold text-gray-900">Score de Confiança</p>
              <p className="text-sm text-gray-500">
                {data.score_confianca >= 80
                  ? 'Peça com boa qualidade geral'
                  : data.score_confianca >= 60
                    ? 'Peça precisa de ajustes'
                    : 'Peça precisa de revisão significativa'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Seções de validação */}
      {[
        { key: 'coerencia',        titulo: 'Coerência',        data: data.coerencia,        tipo: 'itens' },
        { key: 'itens_essenciais', titulo: 'Itens Essenciais', data: data.itens_essenciais, tipo: 'itens' },
        { key: 'legislacao',       titulo: 'Legislação',       data: data.legislacao,       tipo: 'citacoes' },
        { key: 'jurisprudencia',   titulo: 'Jurisprudência',   data: data.jurisprudencia,   tipo: 'citacoes' },
      ].map(({ key, titulo, data: secao, tipo }) => {
        if (!secao) return null
        const items = tipo === 'itens'
          ? (secao as { itens?: Array<{ item: string; status: string; sugestao?: string; observacao?: string }> }).itens ?? []
          : (secao as { citacoes?: Array<{ referencia: string; status: string; sugestao?: string }> }).citacoes ?? []

        return (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                {STATUS_ICON[secao.status] ?? STATUS_ICON.parcial}
                {titulo}
              </CardTitle>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[secao.status] ?? STATUS_BADGE.parcial}`}>
                {secao.status?.replace('_', ' ')}
              </span>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {items.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-xs">
                    {STATUS_ICON[(item as Record<string, string>).status] ?? STATUS_ICON.parcial}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">
                        {(item as Record<string, string>).item ?? (item as Record<string, string>).referencia}
                      </p>
                      {((item as Record<string, string>).sugestao ?? (item as Record<string, string>).observacao) && (
                        <p className="text-gray-500 mt-0.5">
                          {(item as Record<string, string>).sugestao ?? (item as Record<string, string>).observacao}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* Correções automáticas */}
      {data.correcoes_sugeridas && data.correcoes_sugeridas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Correções automáticas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.correcoes_sugeridas.map((c, i) => (
                <button
                  key={i}
                  onClick={() => onCorrecao?.(c.tipo)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-all hover:border-primary-300 hover:bg-primary-50"
                >
                  <div className="text-sm">
                    <p className="font-medium text-gray-900">{c.descricao}</p>
                    <p className="text-xs text-gray-500">{c.tipo.replace(/_/g, ' ')}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    c.prioridade === 'alta' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {c.prioridade}
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
