'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Zap, FileText, Brain } from 'lucide-react'
import { TIPOS_PECA, MODELOS_PRONTOS } from '@/lib/constants/tipos-peca'
import type { Area } from '@/lib/constants/areas'

interface PainelAreaProps {
  area: Area
}

export function PainelArea({ area }: PainelAreaProps) {
  return (
    <div className="space-y-6">

      {/* Grupo 1: Peças com IA */}
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

      {/* Grupo 3: Consultoria / Análise IA */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100">
              <Brain className="h-4 w-4 text-violet-600" />
            </span>
            Consultoria / Análise IA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href={`/${area.id}/consultoria`}
              className="group flex flex-col rounded-xl border-2 border-gray-100 bg-white p-5 text-left transition-all hover:border-violet-300 hover:bg-violet-50 hover:shadow-sm"
            >
              <span className="font-semibold text-gray-900 group-hover:text-violet-800">
                Análise de Caso
              </span>
              <span className="mt-1 text-sm text-gray-400">
                Consultoria jurídica completa com IA — caminhos, riscos e estratégia
              </span>
            </Link>
            <Link
              href={`/${area.id}/consultoria?tipo=parecer`}
              className="group flex flex-col rounded-xl border-2 border-gray-100 bg-white p-5 text-left transition-all hover:border-violet-300 hover:bg-violet-50 hover:shadow-sm"
            >
              <span className="font-semibold text-gray-900 group-hover:text-violet-800">
                Parecer Jurídico
              </span>
              <span className="mt-1 text-sm text-gray-400">
                Opinião fundamentada sobre tese ou situação jurídica específica
              </span>
            </Link>
            <Link
              href={`/${area.id}/consultoria?tipo=estrategia`}
              className="group flex flex-col rounded-xl border-2 border-gray-100 bg-white p-5 text-left transition-all hover:border-violet-300 hover:bg-violet-50 hover:shadow-sm"
            >
              <span className="font-semibold text-gray-900 group-hover:text-violet-800">
                Estratégia Processual
              </span>
              <span className="mt-1 text-sm text-gray-400">
                Plano de ação e sequência de medidas para o caso
              </span>
            </Link>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
