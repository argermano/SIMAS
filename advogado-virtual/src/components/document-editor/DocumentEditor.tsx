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
import { Button } from '@/components/ui/button'
import { baixarGerado, mensagemErroDownload } from '@/lib/download'
import { PanelRightClose, X } from 'lucide-react'

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
  /**
   * Coluna direita opcional (hoje: a sessão de lapidação). Quem passa também
   * controla se ela existe — o editor só decide ONDE ela cabe: coluna docada em
   * telas largas, gaveta sobre o documento nas estreitas.
   */
  painelLateral?: ReactNode
  /** Rótulo da gaveta (< xl) e dos botões de fechar/recolher. */
  painelTitulo?: string
  /** Fecha o painel — o estado (e a preferência) é de quem o abriu. */
  onFecharPainel?: () => void
  /** Peça em edição: dá contexto do caso aos diálogos de IA (F0.2). */
  pecaId?: string
  /**
   * Com uma sessão de lapidação ATIVA, o comando livre de IA deixa de ser
   * one-shot: vira uma rodada da sessão (com dossiê, histórico e proposta).
   */
  onEnviarParaSessao?: (instrucao: string) => void
}

export function DocumentEditor({
  titulo: tituloInicial,
  conteudo,
  onVoltar,
  onSalvar,
  salvando,
  extraAcoes,
  exportOpts,
  painelLateral,
  painelTitulo = 'Painel',
  onFecharPainel,
  pecaId,
  onEnviarParaSessao,
}: DocumentEditorProps) {
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

  // xl (1280px) é o ponto em que a coluna do painel CABE ao lado do documento.
  // O valor tem de casar com as classes `xl:` usadas lá embaixo, senão sobra
  // painel duplicado (coluna + gaveta) ou nenhum.
  const [painelCabeDocado, setPainelCabeDocado] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const upd = () => setPainelCabeDocado(mq.matches)
    upd()
    mq.addEventListener('change', upd)
    return () => mq.removeEventListener('change', upd)
  }, [])

  const painelDocado = Boolean(painelLateral) && painelCabeDocado

  // Com a coluna docada, as duas barras laterais do editor recolhem sozinhas:
  // 224 + 288 + 420px deixariam o documento com menos de 350px num notebook.
  // Ao fechar o painel, elas voltam exatamente como o usuário as tinha deixado.
  const lateraisAntesDoPainel = useRef<{ esquerda: boolean; direita: boolean } | null>(null)
  useEffect(() => {
    if (painelDocado) {
      if (!lateraisAntesDoPainel.current) {
        lateraisAntesDoPainel.current = { esquerda: sidebarCollapsed, direita: rightPanelCollapsed }
        setSidebarCollapsed(true)
        setRightPanelCollapsed(true)
      }
    } else if (lateraisAntesDoPainel.current) {
      setSidebarCollapsed(lateraisAntesDoPainel.current.esquerda)
      setRightPanelCollapsed(lateraisAntesDoPainel.current.direita)
      lateraisAntesDoPainel.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painelDocado])

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

  // Exportar .docx. O seletor de pasta (Chromium) abre ANTES do POST — o gesto do
  // clique se perderia na espera da geração. Safari/Firefox: download de sempre.
  const baixarDocx = useCallback(async () => {
    setBaixando(true)
    try {
      const md = getMarkdown()
      const baixou = await baixarGerado({
        filename: `${titulo.replace(/\s+/g, '_')}.docx`,
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        obterBlob: async () => {
          let res: Response
          try {
            res = await fetch('/api/exportar-documento', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ conteudo: md, titulo, ...exportOpts }),
            })
          } catch {
            toastError('Erro', 'Falha de rede')
            return null
          }
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            toastError('Erro', (data as { error?: string }).error ?? 'Não foi possível exportar')
            return null
          }
          return res.blob()
        },
      })
      // Cancelar o seletor é silêncio: nada de "exportado" que não aconteceu.
      if (baixou) success('Exportado!', 'Arquivo .docx baixado com sucesso')
    } catch (e) {
      toastError('Não foi possível salvar o arquivo', mensagemErroDownload(e))
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
          pecaId={pecaId}
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

        {/* Área do documento — simulação A4. `min-w-0` deixa a coluna encolher
            quando o painel lateral entra (sem ele, a folha A4 empurraria o
            painel para fora da tela). */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-muted py-8 px-4">
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

        {/* Painel lateral (xl+): coluna de ~420px, que encolhe até 360 antes de
            espremer o documento. A guarda CSS (hidden xl:flex) evita a coluna
            no primeiro paint das telas estreitas, antes de o matchMedia rodar. */}
        {painelDocado && (
          <aside className="relative hidden w-[420px] min-w-[360px] shrink border-l border-border bg-card xl:flex xl:flex-col">
            <Button
              variant="ghost"
              size="icon"
              onClick={onFecharPainel}
              title={`Recolher ${painelTitulo.toLowerCase()}`}
              aria-label={`Recolher ${painelTitulo.toLowerCase()}`}
              className="absolute right-2 top-2 z-10 h-9 w-9 rounded-full bg-card/80 text-muted-foreground backdrop-blur-sm hover:bg-muted hover:text-foreground"
            >
              <PanelRightClose className="h-4 w-4" />
            </Button>
            {painelLateral}
          </aside>
        )}
      </div>

      {/* Painel lateral (< xl): gaveta sobre o documento. z-45 fica acima do
          editor (z-40) e abaixo dos diálogos de comparação/revisão (z-50). */}
      {painelLateral && !painelCabeDocado && (
        <div className="fixed inset-0 z-[45] xl:hidden" role="dialog" aria-modal="true" aria-label={painelTitulo}>
          <button
            type="button"
            className="absolute inset-0 bg-foreground/30"
            onClick={onFecharPainel}
            aria-label={`Fechar ${painelTitulo.toLowerCase()}`}
            tabIndex={-1}
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl">
            <Button
              variant="ghost"
              size="icon"
              onClick={onFecharPainel}
              title={`Fechar ${painelTitulo.toLowerCase()}`}
              aria-label={`Fechar ${painelTitulo.toLowerCase()}`}
              className="absolute right-2 top-2 z-10 h-9 w-9 rounded-full bg-card/80 text-muted-foreground backdrop-blur-sm hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
            {painelLateral}
          </div>
        </div>
      )}

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
        pecaId={pecaId}
        onEnviarParaSessao={onEnviarParaSessao}
        onAceitar={(novoConteudo) => {
          if (editor) {
            editor.commands.setContent(mdToHtml(novoConteudo))
          }
        }}
      />
    </div>
  )
}
