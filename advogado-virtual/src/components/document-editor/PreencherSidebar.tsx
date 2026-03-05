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

const PREENCHER_REGEX = /\[PREENCHER(?::\s*([^\]]+))?\]/g
const VERIFICAR_REGEX = /\[VERIFICAR(?::\s*([^\]]+))?\]/g

/**
 * Extracts a meaningful label from the text surrounding a placeholder.
 * Looks at the text before the match for keywords like "nº", "de", etc.
 */
function extrairLabel(markdown: string, matchIndex: number, matchLength: number): string {
  // Get ~80 chars before the match
  const antes = markdown.substring(Math.max(0, matchIndex - 80), matchIndex)

  // Try to find a label pattern like "RG nº [PREENCHER]" or "portadora do CPF [PREENCHER]"
  // Look for the last meaningful word(s) before the placeholder
  const patterns = [
    /(?:(?:do|da|de|dos|das|ao|à|no|na)\s+)?(\w[\w\s/]*?)(?:\s+(?:nº|n[°º.]?|número))?\s*$/i,
  ]

  for (const p of patterns) {
    const m = antes.match(p)
    if (m?.[1]) {
      const label = m[1].trim()
      if (label.length > 2 && label.length < 50) return label
    }
  }

  // Fallback: look for the nearest heading
  const headingMatch = markdown.substring(0, matchIndex).match(/#{1,3}\s+(.+)/g)
  if (headingMatch) {
    const lastHeading = headingMatch[headingMatch.length - 1].replace(/^#+\s+/, '').trim()
    if (lastHeading.length < 60) return lastHeading
  }

  return `Campo ${matchIndex}`
}

function detectarCampos(markdown: string): CampoPreencher[] {
  const campos: CampoPreencher[] = []
  let match: RegExpExecArray | null
  let idx = 0

  // Reset regex state
  PREENCHER_REGEX.lastIndex = 0
  while ((match = PREENCHER_REGEX.exec(markdown)) !== null) {
    const descricao = match[1]?.trim()
    const label = descricao || extrairLabel(markdown, match.index, match[0].length)
    campos.push({
      id: `preencher-${idx}`,
      fullMatch: match[0],
      label,
      contexto: descricao ? 'preencher' : 'preencher',
      index: idx,
    })
    idx++
  }

  VERIFICAR_REGEX.lastIndex = 0
  while ((match = VERIFICAR_REGEX.exec(markdown)) !== null) {
    const descricao = match[1]?.trim()
    campos.push({
      id: `verificar-${idx}`,
      fullMatch: match[0],
      label: descricao || 'Verificar',
      contexto: 'verificar',
      index: idx,
    })
    idx++
  }

  return campos
}

export function PreencherSidebar({ editor, collapsed, onToggleCollapse }: PreencherSidebarProps) {
  const [campos, setCampos] = useState<CampoPreencher[]>([])
  const [valores, setValores] = useState<Record<string, string>>({})
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const atualizarCampos = useCallback(() => {
    if (!editor) return
    // Use getText() — plain text without markdown escaping of brackets
    const texto = editor.getText()
    const novosCampos = detectarCampos(texto)
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

    const html = editor.getHTML()

    // Escape special regex chars in the match
    const escaped = campo.fullMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped)

    const novoHtml = html.replace(regex, valor)
    if (novoHtml === html) return // nothing changed

    editor.chain().setContent(novoHtml).run()

    // Clear value and refresh
    setValores(prev => {
      const next = { ...prev }
      delete next[campo.id]
      return next
    })
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
