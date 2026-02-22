'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useStreaming } from '@/components/shared/StreamingText'
import {
  Clock, FileCheck, HelpCircle, Lightbulb, AlertTriangle, Zap, X,
} from 'lucide-react'

const ICONES: Record<string, React.ComponentType<{ className?: string }>> = {
  Clock, FileCheck, HelpCircle, Lightbulb, AlertTriangle,
}

const COMANDOS = [
  { id: 'organizar_timeline',   label: 'Linha do tempo',    icone: 'Clock' },
  { id: 'listar_documentos',    label: 'Docs necessários',  icone: 'FileCheck' },
  { id: 'perguntas_faltantes',  label: 'Perguntas',         icone: 'HelpCircle' },
  { id: 'sugestao_acao',        label: 'Sugestão de ação',  icone: 'Lightbulb' },
  { id: 'riscos_caso',          label: 'Riscos do caso',    icone: 'AlertTriangle' },
]

interface ComandosRapidosProps {
  atendimentoId: string | null
  disabled?: boolean
}

export function ComandosRapidos({ atendimentoId, disabled }: ComandosRapidosProps) {
  const { text, loading, error, startStream, stop } = useStreaming()
  const [comandoAtivo, setComandoAtivo] = useState<string | null>(null)

  async function executar(comandoId: string) {
    if (!atendimentoId || loading) return
    setComandoAtivo(comandoId)
    await startStream('/api/ia/comando', { atendimentoId, comandoId })
  }

  function fechar() {
    stop()
    setComandoAtivo(null)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Zap className="h-5 w-5 text-gray-400" />
          Comandos rápidos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Grid de botões */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {COMANDOS.map((cmd) => {
            const Icone = ICONES[cmd.icone] ?? Zap
            const ativo = comandoAtivo === cmd.id
            return (
              <button
                key={cmd.id}
                onClick={() => executar(cmd.id)}
                disabled={disabled || !atendimentoId || (loading && !ativo)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-all text-xs font-medium ${
                  ativo
                    ? 'border-primary-300 bg-primary-50 text-primary-800'
                    : 'border-gray-100 bg-white text-gray-700 hover:border-primary-200 hover:bg-primary-50 disabled:opacity-40'
                }`}
              >
                <Icone className="h-4 w-4" />
                {cmd.label}
              </button>
            )
          })}
        </div>

        {/* Resultado */}
        {comandoAtivo && (
          <div className="relative rounded-lg border bg-gray-50 p-4">
            <button
              onClick={fechar}
              className="absolute right-2 top-2 rounded-md p-1 text-gray-400 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </button>

            {error ? (
              <p className="text-sm text-red-600">{error}</p>
            ) : text ? (
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800">
                {text}
                {loading && <span className="inline-block h-4 w-1 animate-pulse bg-primary-600 ml-0.5" />}
              </div>
            ) : loading ? (
              <div className="flex items-center gap-2 py-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-200 border-t-primary-800" />
                <span className="text-sm text-gray-500">Processando...</span>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
