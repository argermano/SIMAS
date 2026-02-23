'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Zap, FileText, Brain, ChevronRight } from 'lucide-react'
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
                  className="group flex flex-col rounded-xl border-2 border-gray-100 bg-white p-4 text-left transition-all hover:border-primary-300 hover:bg-primary-50 hover:shadow-sm"
                >
                  <span className="font-semibold text-gray-900 group-hover:text-primary-800 text-sm leading-tight">
                    {tipo.nome}
                  </span>
                  <span className="mt-1 text-xs text-gray-400 leading-tight">
                    {tipo.descricao}
                  </span>
                </Link>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Grupo 2: Modelos Prontos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100">
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
                  className="group flex flex-col rounded-xl border-2 border-gray-100 bg-white p-4 text-left transition-all hover:border-amber-300 hover:bg-amber-50 hover:shadow-sm"
                >
                  <span className="font-semibold text-gray-900 group-hover:text-amber-800 text-sm leading-tight">
                    {modelo.nome}
                  </span>
                  <span className="mt-1 text-xs text-gray-400 leading-tight">
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
