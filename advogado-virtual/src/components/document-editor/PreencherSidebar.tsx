'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { ChevronLeft, ChevronRight, Check, ArrowUpRight, ClipboardEdit } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface CampoPreencher {
  id: string
  fullMatch: string
  label: string
  contexto: string
  index: number // occurrence index in markdown
}

interface PreencherSidebarProps {
  editor: Editor | null
  collapsed: boolean
  onToggleCollapse: () => void
}

const PREENCHER_REGEX = /\[PREENCHER(?:[:\s]\s*([^\]]+))?\]/g
const VERIFICAR_REGEX = /\[VERIFICAR(?:[:\s]\s*([^\]]+))?\]/g
// Matches generic bracket placeholders like [Xª], [número], [nome do juiz], etc.
// Excludes PREENCHER/VERIFICAR (handled above) and pure numbers like [1], [2]
const GENERICO_REGEX = /\[(?!PREENCHER|VERIFICAR)([^\]\n]{1,50})\]/g

/**
 * Extracts a meaningful label from the block text before a placeholder.
 * Uses the full paragraph text (across formatting nodes) for context.
 */
function extrairLabel(textoAntes: string): string {
  // Clean up and take last 80 chars
  const trecho = textoAntes.replace(/\s+/g, ' ').trimEnd().slice(-80)

  // Pattern 1: "Nome do Cliente:", "CPF nº", "RG n.", "Endereço:"
  const m1 = trecho.match(/([A-ZÁÉÍÓÚÇÃÕÂÊÎÔÛ][\w\s/.\-]{2,40}?)(?:\s*(?:nº|n[°º.]?|número))?\s*:?\s*$/i)
  if (m1?.[1]) {
    const label = m1[1].trim()
    if (label.length >= 2 && label.length < 50) return label
  }

  // Pattern 2: "portador(a) do CPF", "inscrito no CNPJ", "residente na Rua"
  const m2 = trecho.match(/(?:portador[a]?\s+d[eo]|inscrit[oa]\s+n[oa]|residente\s+n[ao]|com\s+sede\s+n[ao]|lotad[oa]\s+n[ao])\s+(.{2,30})\s*$/i)
  if (m2?.[1]) return m2[1].trim()

  // Pattern 3: last meaningful phrase before placeholder (words after last punctuation)
  const m3 = trecho.match(/[,;.]\s+(.{3,40})\s*$/)
  if (m3?.[1]) {
    const palavras = m3[1].trim().split(/\s+/).filter(p => p.length > 2)
    if (palavras.length > 0 && palavras.length <= 5) return palavras.join(' ')
  }

  // Fallback: last 2-4 meaningful words
  const palavras = trecho.split(/\s+/).filter(p => p.length > 2).slice(-4)
  if (palavras.length > 0) return palavras.join(' ')

  return 'Campo'
}

/**
 * Collects all text content from a block node (paragraph, heading, etc.)
 * by concatenating all text children, regardless of formatting marks.
 */
function textoDoBloco(node: { isText: boolean; text?: string | null; childCount: number; child: (i: number) => { isText: boolean; text?: string | null; childCount: number; child: (i: number) => unknown } }): string {
  if (node.isText) return node.text ?? ''
  let result = ''
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child.isText) result += child.text ?? ''
  }
  return result
}

function detectarCampos(editor: Editor): CampoPreencher[] {
  const campos: CampoPreencher[] = []
  let idx = 0

  // Walk block-level nodes (paragraphs, headings, list items, etc.)
  editor.state.doc.descendants((node) => {
    // Only process block nodes that have inline content
    if (!node.isBlock || node.isAtom) return
    if (node.childCount === 0) return

    // Get full text of the block (across all formatted spans)
    const blocoTexto = textoDoBloco(node)
    if (!blocoTexto.includes('[')) return

    PREENCHER_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    const matchedRanges: Array<[number, number]> = []

    while ((match = PREENCHER_REGEX.exec(blocoTexto)) !== null) {
      const descricao = match[1]?.trim().replace(/^[-–—]\s*/, '')
      const textoAntes = blocoTexto.substring(0, match.index)
      matchedRanges.push([match.index, match.index + match[0].length])
      campos.push({
        id: `preencher-${idx}`,
        fullMatch: match[0],
        label: descricao || extrairLabel(textoAntes),
        contexto: 'preencher',
        index: idx,
      })
      idx++
    }

    VERIFICAR_REGEX.lastIndex = 0
    while ((match = VERIFICAR_REGEX.exec(blocoTexto)) !== null) {
      const descricao = match[1]?.trim().replace(/^[-–—]\s*/, '')
      const textoAntes = blocoTexto.substring(0, match.index)
      matchedRanges.push([match.index, match.index + match[0].length])
      campos.push({
        id: `verificar-${idx}`,
        fullMatch: match[0],
        label: descricao || extrairLabel(textoAntes) || 'Verificar',
        contexto: 'verificar',
        index: idx,
      })
      idx++
    }

    // Detect generic bracket placeholders like [Xª], [número], [nome do juiz]
    GENERICO_REGEX.lastIndex = 0
    while ((match = GENERICO_REGEX.exec(blocoTexto)) !== null) {
      // Skip if already matched by PREENCHER/VERIFICAR
      const start = match.index
      const end = start + match[0].length
      if (matchedRanges.some(([s, e]) => start >= s && end <= e)) continue

      const inner = match[1].trim()
      // Skip pure numbers like [1], [2] (footnote-like references)
      if (/^\d+$/.test(inner)) continue

      const textoAntes = blocoTexto.substring(0, match.index)
      campos.push({
        id: `verificar-${idx}`,
        fullMatch: match[0],
        label: inner || extrairLabel(textoAntes) || 'Ajustar',
        contexto: 'verificar',
        index: idx,
      })
      idx++
    }

    // Don't recurse into children — we already processed the full block text
    return false
  })

  return campos
}

export function PreencherSidebar({ editor, collapsed, onToggleCollapse }: PreencherSidebarProps) {
  const [campos, setCampos] = useState<CampoPreencher[]>([])
  const [valores, setValores] = useState<Record<string, string>>({})
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const atualizarCampos = useCallback(() => {
    if (!editor) return
    const novosCampos = detectarCampos(editor)
    setCampos(novosCampos)

    // Clean up values for removed fields
    setValores(prev => {
      const next: Record<string, string> = {}
      for (const c of novosCampos) {
        if (prev[c.id] !== undefined) next[c.id] = prev[c.id]
      }
      return next
    })
  }, [editor])

  useEffect(() => {
    if (!editor) return
    atualizarCampos()
    editor.on('update', atualizarCampos)
    return () => { editor.off('update', atualizarCampos) }
  }, [editor, atualizarCampos])

  function aplicarCampo(campo: CampoPreencher) {
    if (!editor) return
    const valor = valores[campo.id]?.trim()
    if (!valor) return

    // Walk ProseMirror doc to find exact position of the placeholder
    const { doc } = editor.state
    let found = false

    doc.descendants((node, pos) => {
      if (found) return false
      if (!node.isText || !node.text) return

      const idx = node.text.indexOf(campo.fullMatch)
      if (idx === -1) return

      const from = pos + idx
      const to = from + campo.fullMatch.length

      // Select the placeholder text and replace with the value
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .insertContent(valor)
        .run()

      found = true
      return false
    })

    if (found) {
      setValores(prev => {
        const next = { ...prev }
        delete next[campo.id]
        return next
      })
    }
  }

  function irAoCampo(campo: CampoPreencher) {
    if (!editor) return

    // Search in the DOM for the placeholder text
    const editorEl = document.querySelector('.ProseMirror')
    if (!editorEl) return

    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? ''
      const idx = text.indexOf(campo.fullMatch)
      if (idx !== -1) {
        // Found it - scroll into view
        const parent = node.parentElement
        if (parent) {
          parent.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // Highlight briefly
          parent.style.transition = 'background-color 0.3s'
          parent.style.backgroundColor = 'rgba(234, 179, 8, 0.3)'
          setTimeout(() => {
            parent.style.backgroundColor = ''
          }, 2000)
        }
        break
      }
    }
  }

  const countPreencher = campos.filter(c => c.id.startsWith('preencher')).length
  const countVerificar = campos.filter(c => c.id.startsWith('verificar')).length
  const totalCount = campos.length

  if (collapsed) {
    return (
      <div className="flex flex-col items-center border-l bg-muted/50 w-10 shrink-0 py-3 gap-2">
        <button
          onClick={onToggleCollapse}
          className="rounded p-1.5 text-muted-foreground hover:bg-border hover:text-foreground transition-colors"
          title="Expandir painel de campos"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {totalCount > 0 && (
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-warning/20 text-warning text-xs font-bold">
            {totalCount}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col border-l bg-muted/50 w-72 shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b bg-card">
        <div className="flex items-center gap-2">
          <ClipboardEdit className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campos</span>
          {totalCount > 0 && (
            <Badge variant="warning" className="px-1.5 py-0 text-[10px] leading-4">
              {totalCount}
            </Badge>
          )}
        </div>
        <button
          onClick={onToggleCollapse}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
          title="Recolher painel"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 py-2 px-2 space-y-2">
        {campos.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <Check className="h-8 w-8 mx-auto text-success mb-2 opacity-60" />
            <p className="text-xs text-muted-foreground">
              Nenhum campo pendente
            </p>
          </div>
        ) : (
          <>
            {countPreencher > 0 && (
              <p className="px-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Preencher ({countPreencher})
              </p>
            )}

            {campos.filter(c => c.id.startsWith('preencher')).map((campo) => (
              <div
                key={campo.id}
                className="rounded-lg border bg-card p-2.5 space-y-1.5"
              >
                <label className="text-xs font-medium text-foreground block truncate" title={campo.label}>
                  {campo.label}
                </label>
                <input
                  ref={(el) => { inputRefs.current[campo.id] = el }}
                  type="text"
                  value={valores[campo.id] ?? ''}
                  onChange={(e) => setValores(prev => ({ ...prev, [campo.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') aplicarCampo(campo)
                  }}
                  placeholder="Digite o valor..."
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                <div className="flex gap-1">
                  <button
                    onClick={() => aplicarCampo(campo)}
                    disabled={!valores[campo.id]?.trim()}
                    className="flex-1 flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Check className="h-3 w-3" />
                    Aplicar
                  </button>
                  <button
                    onClick={() => irAoCampo(campo)}
                    className="flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-border transition-colors"
                    title="Ir ao campo no documento"
                  >
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}

            {countVerificar > 0 && (
              <>
                <p className="px-1 pt-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Verificar ({countVerificar})
                </p>
                {campos.filter(c => c.id.startsWith('verificar')).map((campo) => (
                  <div
                    key={campo.id}
                    className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 space-y-1.5"
                  >
                    <label className="text-xs font-medium text-foreground block truncate" title={campo.label}>
                      {campo.label}
                    </label>
                    <div className="flex gap-1">
                      <button
                        onClick={() => irAoCampo(campo)}
                        className="flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] text-warning hover:bg-warning/10 transition-colors"
                        title="Ir ao campo no documento"
                      >
                        <ArrowUpRight className="h-3 w-3" />
                        Localizar
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
