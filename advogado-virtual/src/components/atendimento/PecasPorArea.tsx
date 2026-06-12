'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { AREAS } from '@/lib/constants/areas'
import { cn } from '@/lib/utils'
import { FileText, ExternalLink } from 'lucide-react'

export interface PecaExistente {
  id: string
  tipo: string
  area: string
  versao: number
  status: string
  created_at: string
}

const areaMeta = (id: string) =>
  (AREAS as Record<string, { nome: string; corBg: string; corTexto: string }>)[id]

// Lista de peças AGRUPADAS por área (um Estudo de Caso → várias peças, de áreas
// diferentes). A área atual (areaAtual) vem primeiro. Reutilizado na tela do caso
// e na tela de Análise de Caso.
export function PecasPorArea({ pecas, areaAtual }: { pecas: PecaExistente[]; areaAtual?: string }) {
  if (pecas.length === 0) return null

  const grupos = (() => {
    const map = new Map<string, PecaExistente[]>()
    for (const p of pecas) {
      if (!map.has(p.area)) map.set(p.area, [])
      map.get(p.area)!.push(p)
    }
    return Array.from(map.keys())
      .sort((a, b) => (a === areaAtual ? -1 : b === areaAtual ? 1 : a.localeCompare(b)))
      .map((areaId) => ({ areaId, pecas: map.get(areaId)! }))
  })()

  return (
    <div className="space-y-2.5">
      {grupos.map(({ areaId, pecas }) => {
        const meta = areaMeta(areaId)
        return (
          <div key={areaId} className="space-y-1.5">
            <span className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
              meta?.corBg ?? 'bg-muted',
              meta?.corTexto ?? 'text-muted-foreground',
            )}>
              {meta?.nome ?? areaId}
            </span>
            {pecas.map((peca) => {
              const tipoCfg = TIPOS_PECA[peca.tipo]
              const badgeVariant = peca.status === 'aprovada' ? 'success' as const
                : peca.status === 'revisada' ? 'default' as const
                : 'secondary' as const
              const statusLabel = peca.status === 'aprovada' ? 'Aprovada'
                : peca.status === 'revisada' ? 'Revisada'
                : peca.status === 'exportada' ? 'Exportada'
                : 'Rascunho'
              return (
                <Link
                  key={peca.id}
                  href={`/${peca.area}/editor/${peca.id}`}
                  className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {tipoCfg?.nome ?? peca.tipo}
                    </span>
                    <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0 shrink-0">
                      {statusLabel}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground shrink-0">v{peca.versao}</span>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                </Link>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
