'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, X, Loader2, Plus, ChevronDown, ChevronUp, Scale } from 'lucide-react'
import { TRIBUNAIS, TRIBUNAIS_DEFAULT, GRUPOS_TRIBUNAL } from '@/lib/jurisprudencia/tribunais'
import type { ResultadoJurisprudencia } from '@/lib/jurisprudencia/datajud'

interface JurisprudenciaDialogProps {
  open: boolean
  onClose: () => void
  onInserir: (texto: string) => void
}

const GRUPO_KEYS = Object.keys(GRUPOS_TRIBUNAL) as Array<keyof typeof GRUPOS_TRIBUNAL>

export function JurisprudenciaDialog({ open, onClose, onInserir }: JurisprudenciaDialogProps) {
  const [termos, setTermos] = useState('')
  const [tribunaisSel, setTribunaisSel] = useState<string[]>(TRIBUNAIS_DEFAULT.civel)
  const [resultados, setResultados] = useState<ResultadoJurisprudencia[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [expandTribunais, setExpandTribunais] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())

  const toggleTribunal = (alias: string) => {
    setTribunaisSel(prev =>
      prev.includes(alias) ? prev.filter(a => a !== alias) : [...prev, alias]
    )
  }

  const buscar = useCallback(async () => {
    if (!termos.trim() || tribunaisSel.length === 0) return
    setBuscando(true)
    setErro(null)
    setResultados([])
    setSelecionados(new Set())

    try {
      const res = await fetch('/api/jurisprudencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termos: termos.trim(), tribunais: tribunaisSel }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErro(data.error ?? 'Erro na busca')
      } else {
        setResultados(data.resultados ?? [])
      }
    } catch {
      setErro('Falha de rede')
    } finally {
      setBuscando(false)
    }
  }, [termos, tribunaisSel])

  const toggleSelecionado = (idx: number) => {
    setSelecionados(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const inserirSelecionados = () => {
    const items = resultados.filter((_, i) => selecionados.has(i))
    if (items.length === 0) return

    const texto = items.map((r) => {
      const assuntos = r.assuntos.join(', ')
      const ultimoMov = r.movimentos.at(-1)
      return [
        `**${r.tribunal} — Processo ${r.numeroProcesso}**`,
        `Classe: ${r.classe}`,
        `Órgão julgador: ${r.orgaoJulgador}`,
        assuntos ? `Assuntos: ${assuntos}` : '',
        `Data de ajuizamento: ${r.dataAjuizamento}`,
        ultimoMov ? `Último movimento: ${ultimoMov.nome} (${ultimoMov.data})` : '',
      ].filter(Boolean).join('\n\n')
    }).join('\n\n---\n\n')

    const bloco = `\n\n## Jurisprudência\n\n${texto}\n\n`
    onInserir(bloco)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <Scale className="h-4.5 w-4.5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Buscar Jurisprudência</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b space-y-3">
          <div className="flex gap-2">
            <input
              value={termos}
              onChange={(e) => setTermos(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') buscar() }}
              placeholder="Ex.: aposentadoria especial atividade insalubre"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              autoFocus
            />
            <Button size="sm" onClick={buscar} disabled={buscando || !termos.trim() || tribunaisSel.length === 0} className="gap-1.5">
              {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </Button>
          </div>

          {/* Tribunais selecionados */}
          <div>
            <button
              onClick={() => setExpandTribunais(v => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {expandTribunais ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Tribunais ({tribunaisSel.length} selecionados)
            </button>

            {/* Chips dos selecionados */}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {tribunaisSel.map(alias => {
                const t = TRIBUNAIS.find(tr => tr.alias === alias)
                return (
                  <button
                    key={alias}
                    onClick={() => toggleTribunal(alias)}
                    className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
                  >
                    {t?.sigla ?? alias.toUpperCase()}
                    <X className="h-2.5 w-2.5" />
                  </button>
                )
              })}
            </div>

            {/* Expandable tribunal selector */}
            {expandTribunais && (
              <div className="mt-2 rounded-lg border bg-muted/30 p-3 max-h-48 overflow-y-auto space-y-3">
                {GRUPO_KEYS.map(grupo => {
                  const tribunaisGrupo = TRIBUNAIS.filter(t => t.grupo === grupo)
                  return (
                    <div key={grupo}>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                        {GRUPOS_TRIBUNAL[grupo]}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {tribunaisGrupo.map(t => {
                          const sel = tribunaisSel.includes(t.alias)
                          return (
                            <button
                              key={t.alias}
                              onClick={() => toggleTribunal(t.alias)}
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                sel
                                  ? 'bg-primary text-white'
                                  : 'bg-card border text-muted-foreground hover:bg-muted'
                              }`}
                              title={t.nome}
                            >
                              {t.sigla}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {erro && <p className="text-sm text-destructive">{erro}</p>}

          {buscando && (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Buscando nos tribunais...</span>
            </div>
          )}

          {!buscando && resultados.length === 0 && !erro && termos && (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nenhum resultado encontrado. Tente outros termos ou selecione outros tribunais.
            </p>
          )}

          {!buscando && resultados.length === 0 && !termos && (
            <p className="text-center text-sm text-muted-foreground py-8">
              Digite termos de busca e selecione os tribunais para consultar a base do DataJud (CNJ).
            </p>
          )}

          {resultados.map((r, i) => {
            const sel = selecionados.has(i)
            return (
              <button
                key={`${r.tribunal}-${r.numeroProcesso}-${i}`}
                onClick={() => toggleSelecionado(i)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  sel ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'bg-card hover:bg-muted/50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                    sel ? 'bg-primary border-primary text-white' : 'border-border'
                  }`}>
                    {sel && <Plus className="h-3 w-3 rotate-45" style={{ transform: 'none' }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{r.tribunal}</Badge>
                      <span className="text-xs font-medium text-foreground">{r.numeroProcesso}</span>
                    </div>
                    <p className="text-xs text-foreground mt-1">{r.classe}</p>
                    {r.assuntos.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {r.assuntos.slice(0, 3).join(' · ')}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                      <span>{r.orgaoJulgador}</span>
                      <span>Ajuizado: {r.dataAjuizamento}</span>
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        {resultados.length > 0 && (
          <div className="flex items-center justify-between border-t px-5 py-3">
            <p className="text-xs text-muted-foreground">
              {selecionados.size > 0
                ? `${selecionados.size} selecionado${selecionados.size > 1 ? 's' : ''}`
                : `${resultados.length} resultado${resultados.length > 1 ? 's' : ''} — selecione para inserir`
              }
            </p>
            <Button
              size="sm"
              onClick={inserirSelecionados}
              disabled={selecionados.size === 0}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Inserir no documento
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
