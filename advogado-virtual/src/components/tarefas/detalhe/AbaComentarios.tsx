'use client'

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { formatarDataHora } from '@/lib/utils'
import { MessageSquare, Send } from 'lucide-react'

export interface Comentario {
  id: string
  conteudo: string
  created_at: string
  autor?: { id: string; nome: string | null } | null
  autor_nome?: string | null
}

function nomeAutor(c: Comentario): string {
  return c.autor?.nome ?? c.autor_nome ?? 'Usuário'
}

function iniciais(nome: string): string {
  return nome.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
}

interface Props {
  taskId: string
  comentarios: Comentario[] | null
  loading: boolean
  /** Chamado após criar um comentário com sucesso — o pai anexa à lista (mantém o badge). */
  onCreated: (novo: Comentario) => void
}

/**
 * Aba "Comentários" do modal de tarefa. Lista os comentários (já carregados pelo
 * pai, que mantém a contagem do badge) e permite adicionar novos via
 * POST /api/tasks/[id]/comentarios. Zero cálculo de prazo.
 */
export function AbaComentarios({ taskId, comentarios, loading, onCreated }: Props) {
  const { error: toastError } = useToast()
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar() {
    const conteudo = texto.trim()
    if (!conteudo || enviando) return
    setEnviando(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/comentarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conteudo }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Erro', d.error ?? 'Não foi possível comentar')
        return
      }
      const novo = (d.comentario ?? d) as Comentario
      onCreated(novo)
      setTexto('')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Novo comentário */}
      <div className="space-y-2">
        <Textarea
          rows={2}
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder="Escreva um comentário…"
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') enviar()
          }}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={enviar} loading={enviando} disabled={!texto.trim()}>
            <Send className="h-4 w-4" /> Comentar
          </Button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Carregando comentários…
        </div>
      ) : !comentarios || comentarios.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center text-sm text-muted-foreground">
          <MessageSquare className="h-5 w-5 opacity-60" />
          Nenhum comentário ainda.
        </div>
      ) : (
        <ul className="space-y-3">
          {comentarios.map(c => {
            const nome = nomeAutor(c)
            return (
              <li key={c.id} className="flex gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/80 text-[10px] font-bold text-white">
                  {iniciais(nome)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-foreground">{nome}</span>
                    <span className="text-xs text-muted-foreground">{formatarDataHora(c.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">{c.conteudo}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
