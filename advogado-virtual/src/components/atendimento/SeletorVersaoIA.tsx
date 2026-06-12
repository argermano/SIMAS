'use client'

import { Zap, Brain } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VERSOES_IA, type VersaoIA } from '@/lib/anthropic/versoes'

interface SeletorVersaoIAProps {
  value: VersaoIA
  onChange: (v: VersaoIA) => void
  disabled?: boolean
  className?: string
}

// Seletor da "versão" da IA (Padrão x Raciocínio estendido). Rótulos amigáveis,
// sem expor o modelo. Usado na geração de peças e na Análise de Caso.
export function SeletorVersaoIA({ value, onChange, disabled, className }: SeletorVersaoIAProps) {
  const ativa = VERSOES_IA.find((v) => v.id === value) ?? VERSOES_IA[0]
  return (
    <div className={cn('space-y-1', className)}>
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {VERSOES_IA.map((v) => {
          const selecionado = value === v.id
          const Icon = v.id === 'avancado' ? Brain : Zap
          return (
            <button
              key={v.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(v.id)}
              title={v.descricao}
              aria-pressed={selecionado}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                selecionado
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {v.label}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{ativa.descricao}</p>
    </div>
  )
}
