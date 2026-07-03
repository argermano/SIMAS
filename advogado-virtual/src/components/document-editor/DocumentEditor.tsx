'use client'

import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react'
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
import { marked } from 'marked'
import TurndownService from 'turndown'
import { limparMarkdownParaDocx } from '@/lib/format/limpar-markdown'

import { HighlightPlaceholders } from './HighlightPlaceholders'
import { DocumentHeader } from './DocumentHeader'
import { EditorToolbar } from './EditorToolbar'
import { TopicSidebar } from './TopicSidebar'
import { PreencherSidebar } from './PreencherSidebar'
import { AiComandoDialog } from './AiComandoDialog'
import { JurisprudenciaDialog } from './JurisprudenciaDialog'
import { useToast } from '@/components/ui/toast'

// Markdown → HTML (entrada) — limpa os mesmos artefatos que a exportação remove,
// para a prévia refletir o documento final (Word).
function mdToHtml(md: string): string {
  return marked.parse(limparMarkdownParaDocx(md), { async: false }) as string
}

// HTML → Markdown (saída)
const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
})

function htmlToMd(html: string): string {
  return turndown.turndown(html)
}

interface DocumentEditorProps {
  titulo: string
  conteudo: string
  onVoltar: () => void
  onSalvar?: (conteudo: string, opts?: { silencioso?: boolean }) => Promise<void> | void
  salvando?: boolean
  extraAcoes?: ReactNode
  /** Opções de exportação .docx (ex.: { contrato: true } ou { compacto: true }). */
  exportOpts?: { compacto?: boolean; contrato?: boolean }
}

export function DocumentEditor({ titulo: tituloInicial, conteudo, onVoltar, onSalvar, salvando, extraAcoes, exportOpts }: DocumentEditorProps) {
  const { success, error: toastError } = useToast()
  const [titulo, setTitulo]           = useState(tituloInicial)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [baixando, setBaixando]       = useState(false)
  const [comandoIaOpen, setComandoIaOpen] = useState(false)
  const [jurisprudenciaOpen, setJurisprudenciaOpen] = useState(false)
  // Alterações não salvas (dirty). Alimenta o autosave e a guarda de saída.
  const [temAlteracoes, setTemAlteracoes] = useState(false)

  // Converte o markdown inicial para HTML uma vez
  const conteudoHtml = useMemo(() => mdToHtml(conteudo), [conteudo])

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
      HighlightPlaceholders,
    ],
    content: conteudoHtml,
    onUpdate: () => setTemAlteracoes(true),
  })

  // Exporta o conteúdo atual como markdown
  function getMarkdown(): string {
    if (!editor) return conteudo
    return htmlToMd(editor.getHTML())
  }

  // onSalvar via ref: evita re-disparar os efeitos quando o pai re-renderiza
  // (handleSalvar do pai não é memoizado).
  const onSalvarRef = useRef(onSalvar)
  onSalvarRef.current = onSalvar
  const salvandoAutoRef = useRef(false)

  // Autosave: salva silenciosamente ~3s após a última edição. O conteúdo gerado
  // por IA + editado pelo advogado é o ativo mais caro; um clique errado não
  // pode mais descartá-lo.
  useEffect(() => {
    if (!temAlteracoes || !onSalvarRef.current || !editor) return
    const t = setTimeout(async () => {
      if (salvandoAutoRef.current) return
      salvandoAutoRef.current = true
      try {
        await onSalvarRef.current?.(getMarkdown(), { silencioso: true })
        setTemAlteracoes(false)
      } catch { /* mantém dirty; tenta de novo na próxima edição */ }
      finally { salvandoAutoRef.current = false }
    }, 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temAlteracoes, editor])

  // Guarda de fechamento/refresh do navegador quando há alterações não salvas.
  useEffect(() => {
    if (!temAlteracoes) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [temAlteracoes])

  // Voltar salvando o que estiver pendente (sem confirm intrusivo).
  const handleVoltar = useCallback(async () => {
    if (temAlteracoes && onSalvarRef.current && editor) {
      try {
        await onSalvarRef.current(htmlToMd(editor.getHTML()), { silencioso: true })
        setTemAlteracoes(false)
      } catch { /* segue para a navegação mesmo se o save falhar */ }
    }
    onVoltar()
  }, [temAlteracoes, editor, onVoltar])

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
        body:    JSON.stringify({ conteudo: md, titulo, ...exportOpts }),
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
  }, [editor, titulo, exportOpts])

  // contexto para a IA: título + primeiros 500 chars do markdown
  const contextoDocumento = `Documento: ${titulo}\n\n${getMarkdown().slice(0, 500)}`

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-card">
      {/* Header */}
      <DocumentHeader
        titulo={titulo}
        onTituloChange={setTitulo}
        onVoltar={handleVoltar}
        onCopiar={copiar}
        onBaixarDocx={baixarDocx}
        baixando={baixando}
        onSalvar={onSalvar ? async () => { await onSalvar(getMarkdown()); setTemAlteracoes(false) } : undefined}
        salvando={salvando}
        temAlteracoes={temAlteracoes}
        extraAcoes={extraAcoes}
        onComandoIa={() => setComandoIaOpen(true)}
        onBuscarJurisprudencia={() => setJurisprudenciaOpen(true)}
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
                mdToHtml(md)
              ).run()
            }
          }}
        />

        {/* Área do documento — simulação A4 */}
        <div className="flex-1 overflow-y-auto bg-muted py-8 px-4">
          <div className="editor-a4-page">
            <EditorContent editor={editor} className="h-full" />
          </div>
        </div>

        {/* Painel direito: campos pendentes */}
        <PreencherSidebar
          editor={editor}
          collapsed={rightPanelCollapsed}
          onToggleCollapse={() => setRightPanelCollapsed(v => !v)}
        />
      </div>

      {/* Dialog de busca de jurisprudência */}
      <JurisprudenciaDialog
        open={jurisprudenciaOpen}
        onClose={() => setJurisprudenciaOpen(false)}
        onInserir={(texto) => {
          if (editor) {
            editor.chain().focus().insertContentAt(
              editor.state.doc.content.size,
              mdToHtml(texto)
            ).run()
          }
        }}
      />

      {/* Dialog de comando IA livre */}
      <AiComandoDialog
        open={comandoIaOpen}
        onClose={() => setComandoIaOpen(false)}
        documentoMarkdown={getMarkdown()}
        onAceitar={(novoConteudo) => {
          if (editor) {
            editor.commands.setContent(mdToHtml(novoConteudo))
          }
        }}
      />
    </div>
  )
}
