'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, CheckCircle, FileWarning } from 'lucide-react'

interface PainelLateralProps {
  conteudo: string
  area: string
  tipo: string
}

export function PainelLateral({ conteudo, area, tipo }: PainelLateralProps) {
  // Contadores de alertas
  const preencherCount = (conteudo.match(/\[PREENCHER\]/gi) ?? []).length
  const verificarCount = (conteudo.match(/\[VERIFICAR\]/gi) ?? []).length
  const totalAlertas = preencherCount + verificarCount

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Resumo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Área</span>
            <span className="font-medium text-foreground capitalize">{area}</span>
          </div>
          <div className="flex justify-between">
            <span>Tipo</span>
            <span className="font-medium text-foreground">{tipo.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex justify-between">
            <span>Caracteres</span>
            <span className="font-medium text-foreground">{conteudo.length.toLocaleString('pt-BR')}</span>
          </div>
          <div className="flex justify-between">
            <span>Palavras</span>
            <span className="font-medium text-foreground">
              {conteudo.trim() ? conteudo.trim().split(/\s+/).length.toLocaleString('pt-BR') : '0'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Alertas */}
      <Card className={totalAlertas > 0 ? 'border-amber-200' : 'border-success/20'}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            {totalAlertas > 0 ? (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            ) : (
              <CheckCircle className="h-4 w-4 text-success" />
            )}
            Alertas ({totalAlertas})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-xs">
          {preencherCount > 0 && (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-warning">
              <FileWarning className="h-3.5 w-3.5 shrink-0" />
              {preencherCount} campo(s) [PREENCHER]
            </div>
          )}
          {verificarCount > 0 && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/5 px-2 py-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {verificarCount} referência(s) [VERIFICAR]
            </div>
          )}
          {totalAlertas === 0 && (
            <p className="text-success">Nenhum alerta encontrado.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
