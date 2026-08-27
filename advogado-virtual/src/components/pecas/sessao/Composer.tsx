'use client'

// Onde a rodada nasce: instrução + clipe de anexo.
//
// Enter envia e Shift+Enter quebra a linha — a convenção de todo chat; uma
// instrução de lapidação costuma ser uma frase, e exigir o clique no botão a
// cada rodada seria atrito puro.

import { useRef, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Paperclip, Send } from 'lucide-react'

export function Composer({
  valor,
  onChange,
  onEnviar,
  onAnexar,
  ocupado,
  anexando,
  podeAnexar,
}: {
  valor: string
  onChange: (v: string) => void
  onEnviar: () => void
  onAnexar: (arquivo: File) => void
  /** Rodada em curso: nada de enviar outra nem anexar por cima. */
  ocupado: boolean
  anexando: boolean
  /** Sem caso ligado à peça não há dossiê onde guardar o anexo. */
  podeAnexar: boolean
}) {
  const inputArquivo = useRef<HTMLInputElement>(null)

  function teclado(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!ocupado && valor.trim()) onEnviar()
    }
  }

  return (
    <div className="border-t border-border bg-card p-3">
      <div className="flex items-end gap-2">
        {podeAnexar && (
          <>
            <input
              ref={inputArquivo}
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt,.csv,.xlsx"
              className="hidden"
              onChange={(e) => {
                const arquivo = e.target.files?.[0]
                if (arquivo) onAnexar(arquivo)
                e.target.value = ''
              }}
              disabled={ocupado || anexando}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground"
              onClick={() => inputArquivo.current?.click()}
              disabled={ocupado || anexando}
              title="Anexar documento ao caso e a esta sessão"
              aria-label="Anexar documento"
            >
              {anexando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </Button>
          </>
        )}

        <textarea
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={teclado}
          rows={2}
          placeholder="O que ajustar na peça? Ex.: reescreva os fatos usando as datas do CNIS e acrescente o pedido de tutela."
          className="max-h-40 min-h-[2.75rem] flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
        />

        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onEnviar}
          disabled={ocupado || !valor.trim()}
          title="Enviar (Enter)"
          aria-label="Enviar instrução"
        >
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      <p className="mt-1 px-1 text-[10px] text-muted-foreground">
        Enter envia · Shift+Enter quebra linha · a IA propõe, você aplica seção por seção
      </p>
    </div>
  )
}
