'use client'

import { useMemo, useState } from 'react'
import { compararSecoes, montarMarkdown, escolhaPadrao, type EscolhaSecao, type StatusSecao } from '@/lib/diff/secoes'
import { Button } from '@/components/ui/button'
import { X, Check, RotateCcw, Plus, Minus } from 'lucide-react'

const STATUS_LABEL: Record<StatusSecao, { label: string; cor: string }> = {
  igual:      { label: 'sem mudança', cor: 'bg-muted text-muted-foreground' },
  alterada:   { label: 'alterada',    cor: 'bg-warning/10 text-warning' },
  adicionada: { label: 'nova',        cor: 'bg-success/10 text-success' },
  removida:   { label: 'removida',    cor: 'bg-destructive/10 text-destructive' },
}

/**
 * Comparador de seções (E9): mostra as diferenças entre a versão anterior e a
 * atual, seção a seção, e deixa o advogado ACEITAR (manter o novo) ou REVERTER
 * (voltar ao anterior) cada uma. Aplica o resultado montado no editor.
 */
export function ComparadorSecoes({
  base,
  atual,
  versaoBase,
  onAplicar,
  onFechar,
}: {
  base: string
  atual: string
  versaoBase?: number
  onAplicar: (markdown: string) => void
  onFechar: () => void
}) {
  const blocos = useMemo(() => compararSecoes(base, atual), [base, atual])
  const [escolhas, setEscolhas] = useState<EscolhaSecao[]>(() => blocos.map((b) => escolhaPadrao(b.status)))

  const mudadas = blocos.map((b, i) => ({ b, i })).filter(({ b }) => b.status !== 'igual')
  const setEscolha = (i: number, e: EscolhaSecao) => setEscolhas((prev) => prev.map((x, idx) => (idx === i ? e : x)))

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onFechar} />
      <aside className="relative flex w-full max-w-2xl flex-col overflow-hidden bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="font-semibold text-foreground">Comparar com a versão anterior</h2>
            <p className="text-xs text-muted-foreground">
              {mudadas.length === 0
                ? 'Nenhuma diferença por seção.'
                : `${mudadas.length} seç${mudadas.length === 1 ? 'ão' : 'ões'} com mudança${versaoBase ? ` (vs v${versaoBase})` : ''}. Aceite ou reverta cada uma.`}
            </p>
          </div>
          <button onClick={onFechar} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {mudadas.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              As duas versões têm as mesmas seções, sem alterações de conteúdo.
            </p>
          ) : (
            mudadas.map(({ b, i }) => {
              const st = STATUS_LABEL[b.status]
              const escolha = escolhas[i]
              return (
                <div key={i} className="rounded-lg border border-border">
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                    <span className="truncate text-sm font-medium text-foreground">{b.titulo || '(preâmbulo)'}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cor}`}>{st.label}</span>
                  </div>

                  <div className="space-y-2 p-3">
                    {b.status === 'alterada' && (
                      <>
                        <Trecho rotulo="Anterior" cor="destructive" texto={b.base} riscado={escolha === 'atual'} />
                        <Trecho rotulo="Atual (novo)" cor="success" texto={b.atual} riscado={escolha === 'base'} />
                        <Escolhas>
                          <BotaoEscolha ativo={escolha === 'atual'} onClick={() => setEscolha(i, 'atual')} icon={<Check className="h-3.5 w-3.5" />}>Manter novo</BotaoEscolha>
                          <BotaoEscolha ativo={escolha === 'base'} onClick={() => setEscolha(i, 'base')} icon={<RotateCcw className="h-3.5 w-3.5" />}>Voltar ao anterior</BotaoEscolha>
                        </Escolhas>
                      </>
                    )}

                    {b.status === 'adicionada' && (
                      <>
                        <Trecho rotulo="Nova seção" cor="success" texto={b.atual} riscado={escolha === 'remover'} />
                        <Escolhas>
                          <BotaoEscolha ativo={escolha === 'atual'} onClick={() => setEscolha(i, 'atual')} icon={<Plus className="h-3.5 w-3.5" />}>Manter</BotaoEscolha>
                          <BotaoEscolha ativo={escolha === 'remover'} onClick={() => setEscolha(i, 'remover')} icon={<Minus className="h-3.5 w-3.5" />}>Remover</BotaoEscolha>
                        </Escolhas>
                      </>
                    )}

                    {b.status === 'removida' && (
                      <>
                        <Trecho rotulo="Seção que saiu" cor="destructive" texto={b.base} riscado={escolha === 'remover'} />
                        <Escolhas>
                          <BotaoEscolha ativo={escolha === 'base'} onClick={() => setEscolha(i, 'base')} icon={<RotateCcw className="h-3.5 w-3.5" />}>Restaurar</BotaoEscolha>
                          <BotaoEscolha ativo={escolha === 'remover'} onClick={() => setEscolha(i, 'remover')} icon={<Minus className="h-3.5 w-3.5" />}>Manter removida</BotaoEscolha>
                        </Escolhas>
                      </>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onFechar}>Cancelar</Button>
          <Button size="sm" onClick={() => onAplicar(montarMarkdown(blocos, escolhas))} disabled={mudadas.length === 0}>
            Aplicar escolhas
          </Button>
        </div>
      </aside>
    </div>
  )
}

function Trecho({ rotulo, cor, texto, riscado }: { rotulo: string; cor: 'success' | 'destructive'; texto?: string; riscado: boolean }) {
  return (
    <div>
      <p className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wide ${cor === 'success' ? 'text-success' : 'text-destructive'}`}>{rotulo}</p>
      <pre className={`max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs text-foreground ${riscado ? 'opacity-40 line-through' : ''}`}>
        {texto ?? ''}
      </pre>
    </div>
  )
}

function Escolhas({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2 pt-1">{children}</div>
}

function BotaoEscolha({ ativo, onClick, icon, children }: { ativo: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
        ativo ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}
