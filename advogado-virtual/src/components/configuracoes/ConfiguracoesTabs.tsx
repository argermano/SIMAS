'use client'

import { useState } from 'react'
import { Settings, Brain, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConfiguracoesTabsProps {
  configuracoes: React.ReactNode
  consumo: React.ReactNode
  padroes: React.ReactNode
}

const TABS = [
  { id: 'config', label: 'Configurações', icon: Settings },
  { id: 'padroes', label: 'Padrões de Documentos', icon: FileText },
  { id: 'consumo', label: 'Consumo de IA', icon: Brain },
] as const

type TabId = (typeof TABS)[number]['id']

export function ConfiguracoesTabs({ configuracoes, consumo, padroes }: ConfiguracoesTabsProps) {
  const [aba, setAba] = useState<TabId>('config')

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map(tab => {
          const Icon = tab.icon
          const ativo = aba === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setAba(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
                ativo
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {aba === 'config' && <div className="space-y-6">{configuracoes}</div>}
      {aba === 'padroes' && <div className="space-y-4">{padroes}</div>}
      {aba === 'consumo' && <div className="space-y-4">{consumo}</div>}
    </div>
  )
}
