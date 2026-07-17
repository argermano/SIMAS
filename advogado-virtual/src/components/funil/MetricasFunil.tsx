'use client'

import { useState, useEffect } from 'react'
import { LABELS_AREA } from '@/types'
import { LABELS_ETAPA, LABELS_MOTIVO_PERDA, type EtapaFunil, type MotivoPerda } from '@/lib/funil/regras'
import { Loader2, TrendingUp, Trophy, XCircle, Clock } from 'lucide-react'

interface Metrics {
  periodo: number
  porEtapa: { etapa: EtapaFunil; count: number; valor: number }[]
  conversao: { total: number; fechados: number; perdidos: number; emAndamento: number; taxaFechamento: number; taxaGanhoDecididos: number }
  motivosPerda: { motivo: string; count: number }[]
  porArea: { chave: string; count: number; fechados: number; valor: number }[]
  porUnidade: { chave: string; count: number; fechados: number; valor: number }[]
  tempoMedioPorEtapa: { etapa: EtapaFunil; dias: number | null }[]
}

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const PERIODOS = [7, 30, 90]
const nomeArea = (a: string) => (a === '—' ? 'Sem área' : (LABELS_AREA[a as keyof typeof LABELS_AREA] ?? a))

export function MetricasFunil() {
  const [periodo, setPeriodo] = useState(30)
  const [dados, setDados] = useState<Metrics | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    fetch(`/api/funil/metrics?periodo=${periodo}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setDados(d) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [periodo])

  const maxEtapa = dados ? Math.max(1, ...dados.porEtapa.map((e) => e.count)) : 1

  return (
    <div className="space-y-6">
      {/* Seletor de período */}
      <div className="flex gap-2">
        {PERIODOS.map((p) => (
          <button key={p} onClick={() => setPeriodo(p)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${periodo === p ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}>
            {p} dias
          </button>
        ))}
      </div>

      {carregando ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !dados ? (
        <p className="py-20 text-center text-muted-foreground">Não foi possível carregar as métricas.</p>
      ) : (
        <>
          {/* Cards de resumo */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card icone={<TrendingUp className="h-4 w-4" />} rotulo="Leads no período" valor={String(dados.conversao.total)} />
            <Card icone={<Trophy className="h-4 w-4 text-success" />} rotulo="Contratos fechados" valor={String(dados.conversao.fechados)} sub={`${dados.conversao.taxaFechamento}% do total`} />
            <Card icone={<XCircle className="h-4 w-4 text-destructive" />} rotulo="Perdidos" valor={String(dados.conversao.perdidos)} />
            <Card icone={<TrendingUp className="h-4 w-4 text-primary" />} rotulo="Aproveitamento" valor={`${dados.conversao.taxaGanhoDecididos}%`} sub="ganhos ÷ decididos" />
          </div>

          {/* Funil por etapa */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Funil por etapa</h2>
            <div className="space-y-2">
              {dados.porEtapa.map((e) => (
                <div key={e.etapa} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-xs text-muted-foreground">{LABELS_ETAPA[e.etapa]}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-muted/40">
                    <div className={`flex h-full items-center rounded px-2 text-[11px] font-medium text-primary-foreground ${e.etapa === 'perdido' ? 'bg-destructive/70' : 'bg-primary'}`}
                      style={{ width: `${Math.max(6, (e.count / maxEtapa) * 100)}%` }}>
                      {e.count > 0 && e.count}
                    </div>
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs font-medium text-foreground">{e.valor > 0 ? brl(e.valor) : ''}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Tempo médio por etapa */}
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-foreground"><Clock className="h-4 w-4 text-muted-foreground" /> Tempo médio por etapa</h2>
              <ul className="space-y-2 text-sm">
                {dados.tempoMedioPorEtapa.map((t) => (
                  <li key={t.etapa} className="flex justify-between">
                    <span className="text-muted-foreground">{LABELS_ETAPA[t.etapa]}</span>
                    <span className="font-medium text-foreground">{t.dias == null ? '—' : `${t.dias} ${t.dias === 1 ? 'dia' : 'dias'}`}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Motivos de perda */}
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">Motivos de perda</h2>
              {dados.motivosPerda.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma perda no período.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {dados.motivosPerda.map((m) => (
                    <li key={m.motivo} className="flex justify-between">
                      <span className="text-muted-foreground">{LABELS_MOTIVO_PERDA[m.motivo as MotivoPerda] ?? m.motivo}</span>
                      <span className="font-medium text-foreground">{m.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Por unidade */}
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">Por unidade</h2>
              <Tabela linhas={dados.porUnidade.map((u) => ({ rotulo: u.chave, ...u }))} />
            </section>

            {/* Por área */}
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">Por área</h2>
              <Tabela linhas={dados.porArea.map((a) => ({ rotulo: nomeArea(a.chave), ...a }))} />
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function Card({ icone, rotulo, valor, sub }: { icone: React.ReactNode; rotulo: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icone} {rotulo}</div>
      <p className="mt-1 text-2xl font-bold text-foreground">{valor}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Tabela({ linhas }: { linhas: { rotulo: string; count: number; fechados: number; valor: number }[] }) {
  if (linhas.length === 0) return <p className="text-sm text-muted-foreground">Sem dados.</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <th className="pb-1 font-medium">&nbsp;</th>
          <th className="pb-1 text-right font-medium">Leads</th>
          <th className="pb-1 text-right font-medium">Fechados</th>
          <th className="pb-1 text-right font-medium">Valor</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.rotulo} className="border-t border-border/60">
            <td className="py-1.5 text-foreground">{l.rotulo}</td>
            <td className="py-1.5 text-right text-muted-foreground">{l.count}</td>
            <td className="py-1.5 text-right text-muted-foreground">{l.fechados}</td>
            <td className="py-1.5 text-right font-medium text-foreground">{l.valor > 0 ? brl(l.valor) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
