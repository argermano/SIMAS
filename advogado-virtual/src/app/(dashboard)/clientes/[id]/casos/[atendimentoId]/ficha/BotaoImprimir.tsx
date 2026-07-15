'use client'

import { Printer } from 'lucide-react'

// Mini-componente client: só dispara a impressão do navegador. Fica escondido
// na própria impressão (classe .ficha-no-print, definida no <style> da ficha).
export function BotaoImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="ficha-no-print inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/80"
    >
      <Printer className="h-4 w-4" />
      Imprimir
    </button>
  )
}
