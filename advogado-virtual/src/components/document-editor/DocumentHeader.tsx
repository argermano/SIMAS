'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, Download, Copy, Sparkles, Loader2, Search, Pencil, Save, Check } from 'lucide-react'

interface DocumentHeaderProps {
  titulo: string
  onTituloChange: (titulo: string) => void
  onVoltar: () => void
  onBaixarDocx: () => void
  onCopiar: () => void
  baixando: boolean
  onSalvar?: () => void
  salvando?: boolean
  extraAcoes?: ReactNode
  onComandoIa?: () => void
}

export function DocumentHeader({
  titulo,
  onTituloChange,
  onVoltar,
  onBaixarDocx,
  onCopiar,
  baixando,
  onSalvar,
  salvando,
  extraAcoes,
  onComandoIa,
}: DocumentHeaderProps) {
  const [salvo, setSalvo] = useState(false)

  async function handleSalvar() {
    if (!onSalvar) return
    onSalvar()
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2000)
  }
  const [editando, setEditando]     = useState(false)
  const [rascunho, setRascunho]     = useState(titulo)

  function confirmar() {
    const novo = rascunho.trim()
    if (novo) onTituloChange(novo)
    setEditando(false)
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b bg-card px-4 py-2.5 shrink-0">
      {/* Esquerda: Voltar + título */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onVoltar}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
        >
          <ChevronLeft className="h-4 w-4" />
          Voltar
        </button>

        {editando ? (
          <input
            autoFocus
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onBlur={confirmar}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmar()
              if (e.key === 'Escape') setEditando(false)
            }}
            className="border-b border-primary/40 bg-transparent text-sm font-semibold text-foreground outline-none px-1 min-w-48"
          />
        ) : (
          <button
            onClick={() => { setRascunho(titulo); setEditando(true) }}
            className="flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-primary transition-colors truncate max-w-xs"
          >
            <span className="truncate">{titulo}</span>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
        )}
      </div>

      {/* Direita: ações */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Botão IA — abre comando livre */}
        <button
          onClick={onComandoIa}
          className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
          title="Comando IA — peça para a IA modificar ou complementar o documento"
        >
          <Sparkles className="h-3.5 w-3.5" />
          IA
        </button>

        {/* Buscar Jurisprudência — placeholder */}
        <button
          className="hidden sm:flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
          title="Em breve"
          disabled
        >
          <Search className="h-3.5 w-3.5" />
          Buscar Jurisprudência
        </button>

        {/* Copiar */}
        <button
          onClick={onCopiar}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <Copy className="h-3.5 w-3.5" />
          Copiar
        </button>

        {/* Ações extras (opcional) */}
        {extraAcoes}

        {/* Salvar (opcional) */}
        {onSalvar && (
          <Button size="sm" variant="secondary" onClick={handleSalvar} disabled={salvando || salvo} className="gap-1.5">
            {salvando
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : salvo
                ? <Check className="h-4 w-4" />
                : <Save className="h-4 w-4" />
            }
            {salvo ? 'Salvo' : 'Salvar'}
          </Button>
        )}

        {/* Baixar .docx */}
        <Button size="sm" onClick={onBaixarDocx} disabled={baixando} className="gap-1.5">
          {baixando
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Download className="h-4 w-4" />
          }
          Baixar .docx
        </Button>
      </div>
    </div>
  )
}
