'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, Download, Copy, Sparkles, Loader2, Search, Pencil } from 'lucide-react'

interface DocumentHeaderProps {
  titulo: string
  onTituloChange: (titulo: string) => void
  onVoltar: () => void
  onBaixarDocx: () => void
  onCopiar: () => void
  baixando: boolean
}

export function DocumentHeader({
  titulo,
  onTituloChange,
  onVoltar,
  onBaixarDocx,
  onCopiar,
  baixando,
}: DocumentHeaderProps) {
  const [editando, setEditando]     = useState(false)
  const [rascunho, setRascunho]     = useState(titulo)

  function confirmar() {
    const novo = rascunho.trim()
    if (novo) onTituloChange(novo)
    setEditando(false)
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b bg-white px-4 py-2.5 shrink-0">
      {/* Esquerda: Voltar + título */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onVoltar}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors shrink-0"
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
            className="border-b border-primary-400 bg-transparent text-sm font-semibold text-gray-900 outline-none px-1 min-w-48"
          />
        ) : (
          <button
            onClick={() => { setRascunho(titulo); setEditando(true) }}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 hover:text-primary-700 transition-colors truncate max-w-xs"
          >
            <span className="truncate">{titulo}</span>
            <Pencil className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          </button>
        )}
      </div>

      {/* Direita: ações */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Badge IA */}
        <div className="flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
          <Sparkles className="h-3.5 w-3.5" />
          IA
        </div>

        {/* Buscar Jurisprudência — placeholder */}
        <button
          className="hidden sm:flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          title="Em breve"
          disabled
        >
          <Search className="h-3.5 w-3.5" />
          Buscar Jurisprudência
        </button>

        {/* Copiar */}
        <button
          onClick={onCopiar}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Copy className="h-3.5 w-3.5" />
          Copiar
        </button>

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
