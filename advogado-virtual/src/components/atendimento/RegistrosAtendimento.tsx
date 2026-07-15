'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatarDataHora } from '@/lib/utils'
import { MessageSquarePlus, Loader2, Mic } from 'lucide-react'

// Diário do atendimento/caso (append-only, migr. 056). A page (server) já decifra
// o relato inicial e busca os registros — aqui só listamos e acrescentamos.
export interface RegistroItem {
  id: string
  texto: string
  created_at: string
  autor: { id: string; nome: string | null } | null
}

interface RegistrosAtendimentoProps {
  atendimentoId: string
  registrosIniciais: RegistroItem[]
  /** Transcrição/relato original já decifrado na page (nunca decifrar no client). */
  relatoInicial: string | null
  /** Data do relato inicial (created_at do atendimento). */
  relatoData: string | null
}

export function RegistrosAtendimento({
  atendimentoId,
  registrosIniciais,
  relatoInicial,
  relatoData,
}: RegistrosAtendimentoProps) {
  // Ordem cronológica (mais antigo → mais novo): leitura natural de diário; o
  // relato inicial abre a timeline e o composer fica no fim (novo entra embaixo).
  const [registros, setRegistros] = useState<RegistroItem[]>(registrosIniciais)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function adicionar() {
    const t = texto.trim()
    if (!t || salvando) return
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/atendimentos/${atendimentoId}/registros`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: t }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(data.error ?? 'Não foi possível salvar o registro.')
        return
      }
      setRegistros((prev) => [...prev, data.registro as RegistroItem])
      setTexto('')
    } catch {
      setErro('Falha de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquarePlus className="h-5 w-5 text-primary" />
          Registros do atendimento
          {registros.length > 0 && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">({registros.length})</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Timeline */}
        <ol className="relative space-y-4 border-l border-border pl-5">
          {/* Relato inicial — item especial no início da timeline */}
          {relatoInicial && relatoInicial.trim().length > 0 && (
            <li className="relative">
              <span className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default" className="gap-1 px-2 py-0.5 text-[11px]">
                  <Mic className="h-3 w-3" /> Relato inicial
                </Badge>
                {relatoData && (
                  <span className="text-xs text-muted-foreground">{formatarDataHora(relatoData)}</span>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{relatoInicial}</p>
            </li>
          )}

          {registros.map((r) => (
            <li key={r.id} className="relative">
              <span className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary/50" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{r.autor?.nome ?? 'Equipe'}</span>
                <span className="text-xs text-muted-foreground">{formatarDataHora(r.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{r.texto}</p>
            </li>
          ))}

          {registros.length === 0 && !relatoInicial && (
            <li className="relative">
              <span className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-border" />
              <p className="text-sm italic text-muted-foreground">
                Nenhum registro ainda. Anote abaixo o que foi conversado.
              </p>
            </li>
          )}
        </ol>

        {/* Composer — append-only (sem editar/excluir no v1) */}
        <div className="space-y-2 border-t pt-4">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={8000}
            rows={3}
            placeholder="Adicionar registro (o que foi conversado, combinados, próximos passos)…"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
          />
          {erro && <p className="text-xs font-medium text-destructive">{erro}</p>}
          <div className="flex justify-end">
            <button
              onClick={adicionar}
              disabled={salvando || texto.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
              Adicionar registro
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
