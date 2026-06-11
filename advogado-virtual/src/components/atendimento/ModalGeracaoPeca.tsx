'use client'

import { Loader2 } from 'lucide-react'

interface ModalGeracaoPecaProps {
  tipoPecaNome: string
  textoGerado: string
  gerando: boolean
}

export function ModalGeracaoPeca({ tipoPecaNome, textoGerado, gerando }: ModalGeracaoPecaProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card shadow-2xl">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Gerando {tipoPecaNome} com IA</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Isto pode levar até 45 segundos. Não feche a janela.
          </p>
        </div>
        <div className="px-6 py-4">
          <div className="h-52 overflow-y-auto rounded-xl border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
            {textoGerado ? (
              <>
                {textoGerado}
                {gerando && (
                  <span className="inline-block h-3.5 w-0.5 animate-pulse bg-primary/70 ml-0.5 align-middle" />
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Iniciando geração...
              </div>
            )}
          </div>
        </div>
        <div className="border-t px-6 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            {gerando ? 'Gerando...' : 'Finalizando e salvando...'}
          </p>
        </div>
      </div>
    </div>
  )
}
