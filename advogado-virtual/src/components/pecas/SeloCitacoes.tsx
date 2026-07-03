'use client'

import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'

export interface ResumoCitacoes {
  total: number
  verificadas: number
  aConferir: number
  problemas: number
}

/**
 * Selo "citações verificadas" (E1) — materializa o verificador de citações
 * (B5.2) na UI. Aparece no editor e na fila de revisão. NUNCA vai dentro do
 * documento exportado: peça protocolada não carrega marca de ferramenta.
 *
 * Cor pelo pior status: vermelho se há suspeita, âmbar se há "a conferir",
 * verde se tudo verificado. Clicável quando `onClick` é fornecido (abre o
 * painel de revisão na seção de citações).
 */
export function SeloCitacoes({
  citacoes,
  onClick,
}: {
  citacoes?: ResumoCitacoes | null
  onClick?: () => void
}) {
  if (!citacoes) return null

  const { Icon, cor, texto } =
    citacoes.total === 0
      ? { Icon: ShieldCheck, cor: 'bg-muted text-muted-foreground', texto: 'Sem citações' }
      : citacoes.problemas > 0
        ? { Icon: ShieldX, cor: 'bg-destructive/10 text-destructive', texto: `${citacoes.problemas} suspeita${citacoes.problemas > 1 ? 's' : ''}` }
        : citacoes.aConferir > 0
          ? { Icon: ShieldAlert, cor: 'bg-warning/10 text-warning', texto: `${citacoes.verificadas} ok · ${citacoes.aConferir} a conferir` }
          : { Icon: ShieldCheck, cor: 'bg-success/10 text-success', texto: `${citacoes.verificadas} citaç${citacoes.verificadas > 1 ? 'ões' : 'ão'} verificada${citacoes.verificadas > 1 ? 's' : ''}` }

  const className = `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${cor}`

  if (onClick) {
    return (
      <button onClick={onClick} title="Ver verificação de citações" className={`${className} transition-opacity hover:opacity-80`}>
        <Icon className="h-3.5 w-3.5" />
        {texto}
      </button>
    )
  }
  return (
    <span className={className}>
      <Icon className="h-3.5 w-3.5" />
      {texto}
    </span>
  )
}
