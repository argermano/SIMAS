'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Zap, FileText, Brain, ChevronRight, RefreshCw } from 'lucide-react'
import { TIPOS_PECA, MODELOS_PRONTOS } from '@/lib/constants/tipos-peca'
import type { Area } from '@/lib/constants/areas'

interface PainelAreaProps {
  area: Area
}

export function PainelArea({ area }: PainelAreaProps) {
  return (
    <div className="space-y-6">

      {/* Análise de Caso com IA */}
      <Link href="/analise-caso" className="group block">
        <div className="flex items-center gap-5 rounded-2xl border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-white p-6 transition-all hover:border-primary/40 hover:shadow-md">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
            <Brain className="h-7 w-7 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground group-hover:text-primary">
              Análise de Caso com IA
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Descreva o relato do cliente — a IA identifica a área jurídica, avalia a urgência e orienta os próximos passos
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-primary/60 group-hover:text-primary transition-colors" />
        </div>
      </Link>

      {/* Grupo 2: Peças com IA */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100">
              <Zap className="h-4 w-4 text-rose-600" />
            </span>
            Peças com IA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {area.pecas.map((tipoPecaId) => {
              const tipo = TIPOS_PECA[tipoPecaId]
              if (!tipo) return null
              return (
                <Link
                  key={tipo.id}
                  href={`/${area.id}/pecas/${tipo.id}`}
                  className="group flex flex-col rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary/30 hover:bg-primary/10 hover:shadow-sm"
                >
                  <span className="font-semibold text-foreground group-hover:text-primary text-sm leading-tight">
                    {tipo.nome}
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground leading-tight">
                    {tipo.descricao}
                  </span>
                </Link>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Refinamento de Peça */}
      <Link href={`/${area.id}/refinamento`} className="group block">
        <div className="flex items-center gap-5 rounded-2xl border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-6 transition-all hover:border-emerald-400 hover:shadow-md">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-100">
            <RefreshCw className="h-7 w-7 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground group-hover:text-emerald-700">
              Refinamento de Peça
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Envie sua peça e os documentos do cliente — a IA analisa tudo e gera uma versão refinada e melhorada
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-emerald-400 group-hover:text-emerald-600 transition-colors" />
        </div>
      </Link>

      {/* Grupo 2: Modelos Prontos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
              <FileText className="h-4 w-4 text-amber-600" />
            </span>
            Modelos Prontos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {area.modelos.map((modeloId) => {
              const modelo = MODELOS_PRONTOS[modeloId]
              if (!modelo) return null
              return (
                <Link
                  key={modelo.id}
                  href={`/${area.id}/modelos/${modelo.id}`}
                  className="group flex flex-col rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-amber-300 hover:bg-amber-50 hover:shadow-sm"
                >
                  <span className="font-semibold text-foreground group-hover:text-amber-800 text-sm leading-tight">
                    {modelo.nome}
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground leading-tight">
                    {modelo.descricao}
                  </span>
                </Link>
              )
            })}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
