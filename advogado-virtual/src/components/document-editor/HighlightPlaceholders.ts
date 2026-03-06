import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const PLACEHOLDER_REGEX = /\[(PREENCHER|VERIFICAR)(?:[:\s]\s*[^\]]+)?\]/g

/**
 * TipTap extension that highlights [PREENCHER] and [VERIFICAR] placeholders
 * with colored backgrounds directly in the editor.
 */
export const HighlightPlaceholders = Extension.create({
  name: 'highlightPlaceholders',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('highlightPlaceholders'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []

            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return

              PLACEHOLDER_REGEX.lastIndex = 0
              let match: RegExpExecArray | null
              while ((match = PLACEHOLDER_REGEX.exec(node.text)) !== null) {
                const from = pos + match.index
                const to = from + match[0].length
                const tipo = match[1]

                decorations.push(
                  Decoration.inline(from, to, {
                    class: tipo === 'VERIFICAR'
                      ? 'placeholder-verificar'
                      : 'placeholder-preencher',
                  })
                )
              }
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
