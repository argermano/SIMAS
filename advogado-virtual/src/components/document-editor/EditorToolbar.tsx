'use client'

import type { Editor } from '@tiptap/react'
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Link, Image, Table2,
  Undo2, Redo2,
} from 'lucide-react'

interface EditorToolbarProps {
  editor: Editor | null
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  if (!editor) return null

  const btn = (active?: boolean, disabled?: boolean) =>
    `rounded p-1.5 transition-colors disabled:opacity-40 ${
      active
        ? 'bg-primary/10 text-primary'
        : disabled
          ? 'text-border'
          : 'text-muted-foreground hover:bg-border'
    }`

  const div = <div className="mx-1 h-5 w-px bg-border shrink-0" />

  function insertLink() {
    if (!editor) return
    const prev = editor.getAttributes('link').href ?? ''
    const url  = window.prompt('URL do link:', prev)
    if (url === null) return
    if (url) editor.chain().focus().setLink({ href: url }).run()
    else     editor.chain().focus().unsetLink().run()
  }

  function insertImage() {
    if (!editor) return
    const url = window.prompt('URL da imagem:')
    if (url) editor.chain().focus().setImage({ src: url }).run()
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/50 px-3 py-1.5 shrink-0">

      {/* Estilo de parágrafo */}
      <select
        className="mr-2 rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
        value={
          editor.isActive('heading', { level: 1 }) ? '1' :
          editor.isActive('heading', { level: 2 }) ? '2' :
          editor.isActive('heading', { level: 3 }) ? '3' : '0'
        }
        onChange={(e) => {
          const v = parseInt(e.target.value)
          if (v === 0) editor.chain().focus().setParagraph().run()
          else editor.chain().focus().setHeading({ level: v as 1 | 2 | 3 }).run()
        }}
      >
        <option value="0">Parágrafo</option>
        <option value="1">Título 1</option>
        <option value="2">Título 2</option>
        <option value="3">Título 3</option>
      </select>

      {/* Fonte */}
      <select
        className="mr-2 rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer w-36"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) editor.chain().focus().setFontFamily(e.target.value).run()
          else                 editor.chain().focus().unsetFontFamily().run()
        }}
      >
        <option value="">Arial</option>
        <option value="Times New Roman, Times, serif">Times New Roman</option>
        <option value="Courier New, Courier, monospace">Courier New</option>
        <option value="Georgia, serif">Georgia</option>
      </select>

      {div}

      {/* Negrito */}
      <button
        title="Negrito (Ctrl+B)"
        className={btn(editor.isActive('bold'))}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </button>

      {/* Itálico */}
      <button
        title="Itálico (Ctrl+I)"
        className={btn(editor.isActive('italic'))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </button>

      {/* Sublinhado */}
      <button
        title="Sublinhado (Ctrl+U)"
        className={btn(editor.isActive('underline'))}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline className="h-4 w-4" />
      </button>

      {/* Tachado */}
      <button
        title="Tachado"
        className={btn(editor.isActive('strike'))}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-4 w-4" />
      </button>

      {div}

      {/* Alinhamentos */}
      <button
        title="Alinhar à esquerda"
        className={btn(editor.isActive({ textAlign: 'left' }))}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >
        <AlignLeft className="h-4 w-4" />
      </button>
      <button
        title="Centralizar"
        className={btn(editor.isActive({ textAlign: 'center' }))}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        <AlignCenter className="h-4 w-4" />
      </button>
      <button
        title="Alinhar à direita"
        className={btn(editor.isActive({ textAlign: 'right' }))}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      >
        <AlignRight className="h-4 w-4" />
      </button>
      <button
        title="Justificar"
        className={btn(editor.isActive({ textAlign: 'justify' }))}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
      >
        <AlignJustify className="h-4 w-4" />
      </button>

      {div}

      {/* Listas */}
      <button
        title="Lista"
        className={btn(editor.isActive('bulletList'))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </button>
      <button
        title="Lista numerada"
        className={btn(editor.isActive('orderedList'))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </button>

      {div}

      {/* Link */}
      <button
        title="Inserir link"
        className={btn(editor.isActive('link'))}
        onClick={insertLink}
      >
        <Link className="h-4 w-4" />
      </button>

      {/* Imagem */}
      <button
        title="Inserir imagem"
        className={btn()}
        onClick={insertImage}
      >
        <Image className="h-4 w-4" />
      </button>

      {/* Tabela */}
      <button
        title="Inserir tabela"
        className={btn()}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <Table2 className="h-4 w-4" />
      </button>

      {div}

      {/* Desfazer / Refazer */}
      <button
        title="Desfazer (Ctrl+Z)"
        className={btn(false, !editor.can().undo())}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        title="Refazer (Ctrl+Y)"
        className={btn(false, !editor.can().redo())}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo2 className="h-4 w-4" />
      </button>
    </div>
  )
}
