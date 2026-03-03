'use client'

import { useState, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  Bold, Italic, List, ListOrdered,
  Download, Copy, ChevronLeft, Eye, Pencil, Loader2,
} from 'lucide-react'

interface EditorDocumentoProntoProps {
  titulo: string
  conteudo: string
  onVoltar: () => void
}

// Aplica um prefixo de heading na linha atual do textarea
function aplicarHeading(textarea: HTMLTextAreaElement, prefixo: string, valor: string, onChange: (v: string) => void) {
  const start = textarea.selectionStart
  const texto  = textarea.value
  const inicioLinha = texto.lastIndexOf('\n', start - 1) + 1
  const fimLinha    = texto.indexOf('\n', start)
  const linhaAtual  = texto.substring(inicioLinha, fimLinha === -1 ? texto.length : fimLinha)
  const semPrefixo  = linhaAtual.replace(/^#{1,6}\s+/, '')
  const novaLinha   = prefixo ? `${prefixo} ${semPrefixo}` : semPrefixo
  const novoTexto   = texto.substring(0, inicioLinha) + novaLinha + (fimLinha === -1 ? '' : texto.substring(fimLinha))
  onChange(novoTexto)
  requestAnimationFrame(() => {
    textarea.focus()
    const pos = inicioLinha + novaLinha.length
    textarea.setSelectionRange(pos, pos)
  })
}

// Envolve a seleção com marcadores markdown (bold, italic, etc.)
function aplicarInline(textarea: HTMLTextAreaElement, antes: string, depois: string, onChange: (v: string) => void) {
  const start  = textarea.selectionStart
  const end    = textarea.selectionEnd
  const texto  = textarea.value
  const selecao = texto.substring(start, end) || 'texto'
  const novo    = texto.substring(0, start) + antes + selecao + depois + texto.substring(end)
  onChange(novo)
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(start + antes.length, start + antes.length + selecao.length)
  })
}

export function EditorDocumentoPronto({ titulo, conteudo: conteudoInicial, onVoltar }: EditorDocumentoProntoProps) {
  const { success, error: toastError } = useToast()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [conteudo,   setConteudo]   = useState(conteudoInicial)
  const [modoEditar, setModoEditar] = useState(false)
  const [baixando,   setBaixando]   = useState(false)

  const forcarModoEditar = useCallback((fn: (ta: HTMLTextAreaElement) => void) => {
    if (!modoEditar) {
      setModoEditar(true)
      requestAnimationFrame(() => {
        if (textareaRef.current) fn(textareaRef.current)
      })
    } else if (textareaRef.current) {
      fn(textareaRef.current)
    }
  }, [modoEditar])

  function handleHeading(prefixo: string) {
    forcarModoEditar(ta => aplicarHeading(ta, prefixo, conteudo, setConteudo))
  }

  function handleInline(antes: string, depois: string) {
    forcarModoEditar(ta => aplicarInline(ta, antes, depois, setConteudo))
  }

  function handleLista(prefixo: string) {
    forcarModoEditar(ta => {
      const start = ta.selectionStart
      const texto = ta.value
      const novo  = texto.substring(0, start) + `\n${prefixo} ` + texto.substring(start)
      setConteudo(novo)
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(start + prefixo.length + 2, start + prefixo.length + 2)
      })
    })
  }

  async function baixarDocx() {
    setBaixando(true)
    try {
      const res = await fetch('/api/exportar-documento', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ conteudo, titulo }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toastError('Erro', data.error ?? 'Não foi possível exportar')
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
  }

  function copiar() {
    navigator.clipboard.writeText(conteudo)
    success('Copiado!', 'Conteúdo copiado para a área de transferência')
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white">

      {/* ── Barra superior ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onVoltar}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </button>
          <span className="font-semibold text-gray-900">{titulo}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copiar}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Copy className="h-3.5 w-3.5" />
            Copiar
          </button>
          <Button
            size="sm"
            onClick={baixarDocx}
            disabled={baixando}
            className="gap-1.5"
          >
            {baixando
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Download className="h-4 w-4" />
            }
            Baixar .docx
          </Button>
        </div>
      </div>

      {/* ── Barra de ferramentas ─────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 border-b bg-gray-50 px-3 py-1.5 shrink-0">
        {/* Seletor de parágrafo */}
        <select
          className="mr-2 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
          defaultValue=""
          onChange={(e) => { handleHeading(e.target.value); e.target.value = '' }}
        >
          <option value="">Parágrafo</option>
          <option value="#">Título 1</option>
          <option value="##">Título 2</option>
          <option value="###">Título 3</option>
        </select>

        <div className="mx-1 h-5 w-px bg-gray-300" />

        <button
          title="Negrito"
          onClick={() => handleInline('**', '**')}
          className="rounded p-1.5 text-gray-600 hover:bg-gray-200 transition-colors"
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          title="Itálico"
          onClick={() => handleInline('*', '*')}
          className="rounded p-1.5 text-gray-600 hover:bg-gray-200 transition-colors"
        >
          <Italic className="h-4 w-4" />
        </button>

        <div className="mx-1 h-5 w-px bg-gray-300" />

        <button
          title="Lista"
          onClick={() => handleLista('-')}
          className="rounded p-1.5 text-gray-600 hover:bg-gray-200 transition-colors"
        >
          <List className="h-4 w-4" />
        </button>
        <button
          title="Lista numerada"
          onClick={() => handleLista('1.')}
          className="rounded p-1.5 text-gray-600 hover:bg-gray-200 transition-colors"
        >
          <ListOrdered className="h-4 w-4" />
        </button>

        <div className="flex-1" />

        {/* Toggle Prévia / Editar */}
        <div className="flex rounded-lg border bg-white p-0.5">
          <button
            onClick={() => setModoEditar(false)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              !modoEditar ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Eye className="h-3 w-3" />
            Prévia
          </button>
          <button
            onClick={() => setModoEditar(true)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              modoEditar ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Pencil className="h-3 w-3" />
            Editar
          </button>
        </div>
      </div>

      {/* ── Área do documento ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-gray-100 py-8 px-4">
        <div className="mx-auto max-w-3xl">
          {modoEditar ? (
            <div className="rounded-sm bg-white shadow-sm ring-1 ring-gray-200">
              <textarea
                ref={textareaRef}
                value={conteudo}
                onChange={(e) => setConteudo(e.target.value)}
                className="w-full min-h-[700px] resize-y p-10 font-mono text-sm leading-relaxed text-gray-800 outline-none rounded-sm"
                placeholder="Conteúdo do documento..."
                spellCheck={false}
              />
            </div>
          ) : (
            <div className="rounded-sm bg-white p-10 shadow-sm ring-1 ring-gray-200 min-h-[700px]">
              <ReactMarkdown
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-xl font-bold text-gray-900 mt-6 mb-4 text-center uppercase tracking-wide pb-2 border-b border-gray-300">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-base font-bold text-gray-900 mt-6 mb-2 uppercase tracking-wide">{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-2">{children}</h3>
                  ),
                  p: ({ children }) => (
                    <p className="text-sm leading-7 text-gray-800 mb-3 text-justify">{children}</p>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-bold text-gray-900">{children}</strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic text-gray-700">{children}</em>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal pl-6 space-y-1.5 my-3 text-sm text-gray-800">{children}</ol>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc pl-6 space-y-1.5 my-3 text-sm text-gray-800">{children}</ul>
                  ),
                  li: ({ children }) => (
                    <li className="leading-relaxed">{children}</li>
                  ),
                  hr: () => (
                    <hr className="my-6 border-gray-300" />
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-gray-300 pl-4 py-2 my-3 italic text-sm text-gray-600">{children}</blockquote>
                  ),
                }}
              >
                {conteudo}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
