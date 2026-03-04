'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import type { DocumentTopic } from '@/types/document-editor'
import { AiRewriteDialog } from './AiRewriteDialog'
import { Button } from '@/components/ui/button'
import { Sparkles, Plus, RefreshCw, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

interface TopicSidebarProps {
  editor: Editor | null
  contextoDocumento: string
  collapsed: boolean
  onToggleCollapse: () => void
}

export function TopicSidebar({ editor, contextoDocumento, collapsed, onToggleCollapse }: TopicSidebarProps) {
  const [topics,         setTopics]         = useState<DocumentTopic[]>([])
  const [activeTopic,    setActiveTopic]     = useState<string | null>(null)
  const [rewriteTarget,  setRewriteTarget]   = useState<DocumentTopic | null>(null)
  const [adicionando,    setAdicionando]     = useState(false)
  const [descTopico,     setDescTopico]      = useState('')
  const [gerandoTopico,  setGerandoTopico]   = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Extrai tópicos do documento
  const extractTopics = useCallback(() => {
    if (!editor) return
    const found: DocumentTopic[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        found.push({
          id:    `h-${pos}`,
          level: node.attrs.level as number,
          text:  node.textContent,
          pos,
        })
      }
    })
    setTopics(found)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    extractTopics()
    editor.on('update', extractTopics)
    return () => { editor.off('update', extractTopics) }
  }, [editor, extractTopics])

  function scrollToTopic(topic: DocumentTopic) {
    setActiveTopic(topic.id)
    const headings = document.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3')
    for (const h of headings) {
      if (h.textContent?.trim() === topic.text.trim()) {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' })
        break
      }
    }
  }

  // Reescrita: pega o texto do tópico até o próximo tópico
  function getTopicContent(topic: DocumentTopic): string {
    if (!editor) return ''
    const doc = editor.state.doc
    let content = ''
    let inSection = false
    doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && pos === topic.pos) {
        inSection = true
        content += node.textContent + '\n'
        return
      }
      if (node.type.name === 'heading' && inSection) {
        inSection = false
        return false // stop
      }
      if (inSection && node.isText) {
        content += node.text ?? ''
      }
      if (inSection && node.type.name === 'paragraph') {
        content += '\n'
      }
    })
    return content.trim()
  }

  function handleAceitarReescrita(novoConteudo: string) {
    if (!editor || !rewriteTarget) return
    // Insert at the end for simplicity - replace section
    editor.chain().focus().setContent(
      editor.getHTML().replace(
        /<h[123][^>]*>.*?<\/h[123]>/i,
        (m) => {
          if (m.includes(rewriteTarget.text)) return novoConteudo
          return m
        }
      )
    ).run()
    // Simpler: just append at end
    const markdown = `\n\n${novoConteudo}`
    const { to } = editor.state.selection
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, markdown).run()
  }

  async function gerarNovoTopico() {
    if (!descTopico.trim() || !editor) return
    setGerandoTopico(true)
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/ia/editor-documento', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao:               'gerar_topico',
          descricao:          descTopico,
          contexto_documento: contextoDocumento,
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) return

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'text') buffer += ev.text
          } catch { /* noop */ }
        }
      }

      // Insert at end of document
      if (buffer) {
        editor.chain().focus().insertContentAt(
          editor.state.doc.content.size,
          `\n\n${buffer}`
        ).run()
      }

      setDescTopico('')
      setAdicionando(false)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error(e)
    } finally {
      setGerandoTopico(false)
    }
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center border-r bg-muted/50 w-10 shrink-0 py-3">
        <button
          onClick={onToggleCollapse}
          className="rounded p-1.5 text-muted-foreground hover:bg-border hover:text-foreground transition-colors"
          title="Expandir painel"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col border-r bg-muted/50 w-56 shrink-0 overflow-y-auto">
        {/* Header da sidebar */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b bg-card">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estrutura</span>
          <button
            onClick={onToggleCollapse}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
            title="Recolher painel"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Lista de tópicos */}
        <div className="flex-1 py-2 px-2 space-y-0.5">
          {topics.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground italic">
              Nenhum tópico encontrado. Adicione títulos ao documento.
            </p>
          ) : (
            topics.map((topic) => (
              <div
                key={topic.id}
                className={`group flex items-center justify-between rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                  activeTopic === topic.id
                    ? 'bg-primary/5 text-primary'
                    : 'hover:bg-border text-foreground'
                }`}
                style={{ paddingLeft: `${(topic.level - 1) * 0.75 + 0.5}rem` }}
              >
                <button
                  className="flex-1 text-left text-xs truncate"
                  onClick={() => scrollToTopic(topic)}
                  title={topic.text}
                >
                  {topic.text}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setRewriteTarget(topic) }}
                  title="Reescrever com IA"
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-primary/10 hover:text-primary transition-all"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Adicionar tópico */}
        <div className="border-t p-2">
          {adicionando ? (
            <div className="space-y-2">
              <textarea
                ref={inputRef}
                autoFocus
                value={descTopico}
                onChange={(e) => setDescTopico(e.target.value)}
                placeholder="Descreva o novo tópico..."
                rows={3}
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs resize-none outline-none focus:ring-1 focus:ring-primary/40"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) gerarNovoTopico()
                  if (e.key === 'Escape') { setAdicionando(false); setDescTopico('') }
                }}
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="flex-1 gap-1 bg-primary/70 hover:bg-primary/80 text-xs py-1"
                  onClick={gerarNovoTopico}
                  disabled={gerandoTopico || !descTopico.trim()}
                >
                  {gerandoTopico
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Sparkles className="h-3 w-3" />
                  }
                  Gerar
                </Button>
                <button
                  onClick={() => { setAdicionando(false); setDescTopico(''); abortRef.current?.abort() }}
                  className="rounded-md px-2 text-xs text-muted-foreground hover:bg-border transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdicionando(true)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar tópico com IA
            </button>
          )}
        </div>
      </div>

      {/* Dialog de reescrita */}
      <AiRewriteDialog
        open={!!rewriteTarget}
        onClose={() => setRewriteTarget(null)}
        topicText={rewriteTarget?.text ?? ''}
        originalContent={rewriteTarget ? getTopicContent(rewriteTarget) : ''}
        contextoDocumento={contextoDocumento}
        onAceitar={handleAceitarReescrita}
      />
    </>
  )
}
