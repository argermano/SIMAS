'use client'

import { useState, useCallback, type ReactNode } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import { Markdown } from 'tiptap-markdown'

import { HighlightPlaceholders } from './HighlightPlaceholders'
import { DocumentHeader } from './DocumentHeader'
import { EditorToolbar } from './EditorToolbar'
import { TopicSidebar } from './TopicSidebar'
import { PreencherSidebar } from './PreencherSidebar'
import { AiComandoDialog } from './AiComandoDialog'
import { useToast } from '@/components/ui/toast'

interface DocumentEditorProps {
  titulo: string
  conteudo: string
  onVoltar: () => void
  onSalvar?: (conteudo: string) => Promise<void> | void
  salvando?: boolean
  extraAcoes?: ReactNode
}

export function DocumentEditor({ titulo: tituloInicial, conteudo, onVoltar, onSalvar, salvando, extraAcoes }: DocumentEditorProps) {
  const { success, error: toastError } = useToast()
  const [titulo, setTitulo]           = useState(tituloInicial)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [baixando, setBaixando]       = useState(false)
  const [comandoIaOpen, setComandoIaOpen] = useState(false)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TextStyle,
      FontFamily,
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
      HighlightPlaceholders,
    ],
    content: conteudo,
  })

  // Exporta o conteúdo atual como markdown
  function getMarkdown(): string {
    if (!editor) return conteudo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (editor.storage as any).markdown.getMarkdown()
  }

  const copiar = useCallback(() => {
    navigator.clipboard.writeText(getMarkdown())
    success('Copiado!', 'Conteúdo copiado para a área de transferência')
  }, [editor])

  const baixarDocx = useCallback(async () => {
    setBaixando(true)
    try {
      const md = getMarkdown()
      const res = await fetch('/api/exportar-documento', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ conteudo: md, titulo }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toastError('Erro', (data as { error?: string }).error ?? 'Não foi possível exportar')
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${titulo.replace(/\s+/g, '_')}.docx`
      a.click()
      URL.revokeObjectURL(url)
      success('Exportado!', 'Arquivo .docx baixado com sucesso')
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setBaixando(false)
    }
  }, [editor, titulo])

  // contexto para a IA: título + primeiros 500 chars do markdown
  const contextoDocumento = `Documento: ${titulo}\n\n${getMarkdown().slice(0, 500)}`

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-card">
      {/* Header */}
      <DocumentHeader
        titulo={titulo}
        onTituloChange={setTitulo}
        onVoltar={onVoltar}
        onCopiar={copiar}
        onBaixarDocx={baixarDocx}
        baixando={baixando}
        onSalvar={onSalvar ? () => onSalvar(getMarkdown()) : undefined}
        salvando={salvando}
        extraAcoes={extraAcoes}
        onComandoIa={() => setComandoIaOpen(true)}
      />

      {/* Toolbar */}
      <EditorToolbar editor={editor} />

      {/* Corpo: Sidebar + Editor */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <TopicSidebar
          editor={editor}
          contextoDocumento={contextoDocumento}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
          getMarkdown={getMarkdown}
          onInsertContent={(md) => {
            if (editor) {
              editor.chain().focus().insertContentAt(
                editor.state.doc.content.size,
                `\n\n${md}`
              ).run()
            }
          }}
        />

        {/* Área do documento */}
        <div className="flex-1 overflow-y-auto bg-muted py-8 px-4">
          <div className="mx-auto max-w-3xl">
            <div className="rounded-sm bg-white shadow-sm ring-1 ring-border min-h-[700px] p-10">
              <EditorContent editor={editor} className="h-full" />
            </div>
          </div>
        </div>

        {/* Painel direito: campos pendentes */}
        <PreencherSidebar
          editor={editor}
          collapsed={rightPanelCollapsed}
          onToggleCollapse={() => setRightPanelCollapsed(v => !v)}
        />
      </div>

      {/* Dialog de comando IA livre */}
      <AiComandoDialog
        open={comandoIaOpen}
        onClose={() => setComandoIaOpen(false)}
        documentoMarkdown={getMarkdown()}
        onAceitar={(conteudo) => {
          if (editor) {
            editor.chain().focus().insertContentAt(
              editor.state.doc.content.size,
              `\n\n${conteudo}`
            ).run()
          }
        }}
      />
    </div>
  )
}
