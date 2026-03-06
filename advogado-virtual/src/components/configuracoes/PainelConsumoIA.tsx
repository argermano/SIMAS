'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Brain, Zap, FileText, Search, PenTool,
  Loader2, Hash, DollarSign, BarChart3, ScrollText,
} from 'lucide-react'

interface Resumo {
  totalChamadas: number
  totalInput: number
  totalOutput: number
  totalTokens: number
  totalCusto: number
  pecasGeradas: number
}

interface Categoria {
  label: string
  grupo: string
  chave: string
  chamadas: number
  tokensInput: number
  tokensOutput: number
  custoEstimado: number
  limite: number
}

interface DiaUsage {
  dia: string
  tokens: number
  chamadas: number
}

interface UsageData {
  resumo: Resumo
  plano: string
  grupos: Record<string, Categoria[]>
  historicoDiario: DiaUsage[]
}

const ICONES_GRUPO: Record<string, React.ReactNode> = {
  Documentos: <FileText className="h-3.5 w-3.5" />,
  'Análise':  <Search className="h-3.5 w-3.5" />,
  Editor:     <PenTool className="h-3.5 w-3.5" />,
  Outros:     <Zap className="h-3.5 w-3.5" />,
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatBrl(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

function MiniBarChart({ dados }: { dados: DiaUsage[] }) {
  const max = Math.max(...dados.map(d => d.tokens), 1)
  return (
    <div className="flex gap-[2px]">
      {dados.map((d) => {
        const h = Math.max((d.tokens / max) * 100, d.tokens > 0 ? 4 : 0)
        const dia = parseInt(d.dia.slice(8), 10)
        return (
          <div key={d.dia} className="flex flex-col items-center flex-1 min-w-0">
            <div className="w-full h-20 flex items-end">
              <div
                className="w-full rounded-t bg-primary/70 hover:bg-primary transition-colors"
                style={{ height: `${h}%` }}
                title={`${d.dia}: ${formatTokens(d.tokens)} tokens, ${d.chamadas} chamadas`}
              />
            </div>
            <span className="text-[8px] text-muted-foreground mt-0.5 leading-none">{dia}</span>
          </div>
        )
      })}
    </div>
  )
}

function ProgressBar({ usado, limite }: { usado: number; limite: number }) {
  const pct = Math.min((usado / limite) * 100, 100)
  const disponivel = Math.max(limite - usado, 0)
  const corBarra = pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-warning' : 'bg-primary'

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-muted-foreground">
          {usado} utilizados &nbsp;|&nbsp; {disponivel} disponíveis
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${corBarra}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function PainelConsumoIA() {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/configuracoes/uso-ia')
      .then(r => r.json())
      .then(d => {
        if (d.error) setErro(d.error)
        else setData(d)
      })
      .catch(() => setErro('Falha ao carregar dados'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (erro || !data) {
    return (
      <div className="text-center py-6">
        <Brain className="h-6 w-6 mx-auto text-muted-foreground/40 mb-1" />
        <p className="text-sm text-muted-foreground">{erro ?? 'Sem dados disponíveis'}</p>
      </div>
    )
  }

  const { resumo, grupos, historicoDiario } = data
  const grupoOrdem = ['Documentos', 'Análise', 'Editor', 'Outros']

  return (
    <div className="space-y-4">
      {/* Cards resumo */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <ScrollText className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">Peças geradas</span>
          </div>
          <p className="text-2xl font-bold text-primary">{resumo.pecasGeradas}</p>
        </div>
        <MetricCard
          icon={<Hash className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Chamadas IA"
          valor={String(resumo.totalChamadas)}
        />
        <MetricCard
          icon={<Zap className="h-3.5 w-3.5 text-amber-500" />}
          label="Tokens"
          valor={formatTokens(resumo.totalTokens)}
        />
        <MetricCard
          icon={<DollarSign className="h-3.5 w-3.5 text-success" />}
          label="Custo est."
          valor={`R$ ${formatBrl(resumo.totalCusto)}`}
        />
      </div>

      {/* Gráfico últimos 30 dias */}
      {historicoDiario.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Últimos 30 dias
            </span>
          </div>
          <MiniBarChart dados={historicoDiario} />
        </div>
      )}

      {/* Categorias por grupo */}
      {grupoOrdem.map(grupo => {
        const cats = grupos[grupo]
        if (!cats || cats.length === 0) return null

        return (
          <div key={grupo}>
            <div className="flex items-center gap-1.5 mb-2">
              {ICONES_GRUPO[grupo] ?? <Zap className="h-3.5 w-3.5" />}
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {grupo}
              </span>
            </div>
            <div className="space-y-2">
              {cats.sort((a, b) => b.chamadas - a.chamadas).map(cat => (
                <div
                  key={cat.label}
                  className="rounded-lg border bg-card px-3 py-2.5 space-y-1.5"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{cat.label}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {formatTokens(cat.tokensInput + cat.tokensOutput)} tok &middot; R$ {formatBrl(cat.custoEstimado)}
                    </Badge>
                  </div>
                  <ProgressBar usado={cat.chamadas} limite={cat.limite} />
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {resumo.totalChamadas === 0 && (
        <div className="text-center py-4">
          <Brain className="h-6 w-6 mx-auto text-muted-foreground/40 mb-1" />
          <p className="text-xs text-muted-foreground">Nenhum uso de IA registrado ainda</p>
        </div>
      )}
    </div>
  )
}

function MetricCard({ icon, label, valor }: { icon: React.ReactNode; label: string; valor: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1 mb-0.5">
        {icon}
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground">{valor}</p>
    </div>
  )
}
