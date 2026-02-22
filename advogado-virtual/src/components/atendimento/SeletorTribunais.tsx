'use client'

import { useState, useCallback, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  TRIBUNAIS, TRIBUNAIS_DEFAULT, GRUPOS_TRIBUNAL,
  type Tribunal,
} from '@/lib/jurisprudencia/tribunais'
import type { ResultadoJurisprudencia } from '@/lib/jurisprudencia/datajud'
import { Scale, Search, ChevronDown, ChevronUp, Loader2, X, ExternalLink } from 'lucide-react'

interface SeletorTribunaisProps {
  area: string
  disabled?: boolean
  onResultados?: (resultados: ResultadoJurisprudencia[]) => void
  onTribunaisChange?: (tribunais: string[]) => void
  termosIniciais?: string
}

export function SeletorTribunais({
  area,
  disabled,
  onResultados,
  onTribunaisChange,
  termosIniciais,
}: SeletorTribunaisProps) {
  const { error: toastError } = useToast()

  const defaultTribunais = TRIBUNAIS_DEFAULT[area] ?? TRIBUNAIS_DEFAULT.previdenciario
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set(defaultTribunais))

  // Notifica o pai dos tribunais default no mount
  useEffect(() => {
    onTribunaisChange?.(defaultTribunais)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [termos, setTermos] = useState(termosIniciais ?? '')
  const [expandido, setExpandido] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [resultados, setResultados] = useState<ResultadoJurisprudencia[]>([])

  const toggleTribunal = useCallback((alias: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(alias)) {
        next.delete(alias)
      } else {
        next.add(alias)
      }
      onTribunaisChange?.(Array.from(next))
      return next
    })
  }, [onTribunaisChange])

  async function buscar() {
    if (!termos.trim() || selecionados.size === 0) {
      toastError('Campos obrigatórios', 'Informe os termos e selecione ao menos um tribunal')
      return
    }

    setBuscando(true)
    setResultados([])
    try {
      const res = await fetch('/api/jurisprudencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          termos: termos.trim(),
          tribunais: Array.from(selecionados),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setResultados(data.resultados ?? [])
        onResultados?.(data.resultados ?? [])
      } else {
        toastError('Erro', data.error ?? 'Falha ao buscar jurisprudência')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setBuscando(false)
    }
  }

  function limpar() {
    setResultados([])
    onResultados?.([])
  }

  // Agrupar tribunais
  const grupos = Object.entries(GRUPOS_TRIBUNAL).map(([key, label]) => ({
    key,
    label,
    tribunais: TRIBUNAIS.filter((t) => t.grupo === key),
  }))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Scale className="h-5 w-5 text-gray-400" />
          Jurisprudência
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Termos de busca */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Termos de busca
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={termos}
              onChange={(e) => setTermos(e.target.value)}
              placeholder="Ex.: aposentadoria especial, verbas rescisórias..."
              disabled={disabled || buscando}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-50"
              onKeyDown={(e) => e.key === 'Enter' && buscar()}
            />
            <Button
              size="sm"
              onClick={buscar}
              disabled={disabled || buscando || !termos.trim() || selecionados.size === 0}
              className="gap-1.5 shrink-0"
            >
              {buscando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Buscar
            </Button>
          </div>
        </div>

        {/* Tribunais selecionados (chips) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-medium text-gray-700">
              Tribunais ({selecionados.size})
            </span>
            <button
              onClick={() => setExpandido(!expandido)}
              className="flex items-center gap-1 text-xs text-primary-700 hover:text-primary-900"
            >
              {expandido ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {expandido ? 'Fechar' : 'Alterar tribunais'}
            </button>
          </div>

          {/* Chips dos selecionados */}
          <div className="flex flex-wrap gap-1.5">
            {Array.from(selecionados).map((alias) => {
              const t = TRIBUNAIS.find((tr) => tr.alias === alias)
              return (
                <span
                  key={alias}
                  className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-800"
                >
                  {t?.sigla ?? alias.toUpperCase()}
                  <button
                    onClick={() => toggleTribunal(alias)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-primary-200"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })}
          </div>
        </div>

        {/* Lista expandida de tribunais */}
        {expandido && (
          <div className="space-y-3 rounded-lg border bg-gray-50 p-3 max-h-64 overflow-y-auto">
            {grupos.map(({ key, label, tribunais: lista }) => (
              <div key={key}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {label}
                </p>
                <div className="flex flex-wrap gap-1">
                  {lista.map((t: Tribunal) => {
                    const ativo = selecionados.has(t.alias)
                    return (
                      <button
                        key={t.alias}
                        onClick={() => toggleTribunal(t.alias)}
                        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          ativo
                            ? 'bg-primary-600 text-white'
                            : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300'
                        }`}
                      >
                        {t.sigla}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Resultados */}
        {resultados.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {resultados.length} resultado(s) encontrado(s)
              </span>
              <button
                onClick={limpar}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Limpar
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {resultados.map((r, i) => (
                <div key={i} className="rounded-lg border bg-white p-3 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="rounded bg-primary-100 px-1.5 py-0.5 font-semibold text-primary-800">
                      {r.tribunal}
                    </span>
                    <span className="font-mono text-gray-500">{r.numeroProcesso}</span>
                  </div>
                  <p className="font-medium text-gray-900">{r.classe}</p>
                  {r.assuntos.length > 0 && (
                    <p className="text-gray-500 mt-0.5">{r.assuntos.join(' · ')}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-gray-400">
                    <span>{r.orgaoJulgador}</span>
                    {r.dataAjuizamento && <span>{r.dataAjuizamento}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Estado vazio após busca sem resultados */}
        {!buscando && resultados.length === 0 && termos.trim() && (
          <p className="text-center text-xs text-gray-400 py-2">
            Clique em &quot;Buscar&quot; para consultar os tribunais selecionados
          </p>
        )}
      </CardContent>
    </Card>
  )
}
