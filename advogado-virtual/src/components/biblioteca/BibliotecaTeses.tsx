'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { SeloCitacoes, type ResumoCitacoes } from '@/components/pecas/SeloCitacoes'
import { LABELS_AREA } from '@/types'
import { BookMarked, ExternalLink, Gavel, FileText, Upload, Loader2, Check, X, Pencil } from 'lucide-react'

export interface TeseRow {
  id: string
  area: string
  status: 'sugerida' | 'aprovada' | 'rejeitada'
  tese: string
  dispositivos: string[]
  sumulas: string[]
  ementas: Array<{ tribunal?: string; processo?: string; relator?: string; julgamento?: string; ementa?: string; fonteUrl?: string }>
  quando_usar: string | null
  notas: string | null
  verificacao: ResumoCitacoes | null
  origem_arquivo: string | null
  trecho_origem: string | null
  motivo_rejeicao: string | null
}

const AREAS_OPCOES = Object.entries(LABELS_AREA) as [string, string][]
const nomeArea = (a: string) => LABELS_AREA[a as keyof typeof LABELS_AREA] ?? a

export function BibliotecaTeses({ teses, podeCurar }: { teses: TeseRow[]; podeCurar: boolean }) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState<string | null>(null)

  const aprovadas = teses.filter((t) => t.status === 'aprovada')
  const sugestoes = teses.filter((t) => t.status === 'sugerida')
  const [aba, setAba] = useState<'aprovadas' | 'sugestoes'>(sugestoes.length > 0 && podeCurar ? 'sugestoes' : 'aprovadas')
  const lista = aba === 'aprovadas' ? aprovadas : sugestoes

  async function handleArquivos(files: FileList | null) {
    if (!files || files.length === 0) return
    const arr = Array.from(files)
    let totalSug = 0, totalDup = 0
    for (let i = 0; i < arr.length; i++) {
      setEnviando(`Analisando ${i + 1}/${arr.length}: ${arr[i].name}`)
      try {
        const fd = new FormData()
        fd.append('file', arr[i])
        const res = await fetch('/api/teses/extrair', { method: 'POST', body: fd })
        const data = await res.json()
        if (res.ok) { totalSug += data.sugeridas ?? 0; totalDup += data.duplicadas ?? 0 }
        else toastError(`Falha em ${arr[i].name}`, data.error ?? 'Tente novamente')
      } catch {
        toastError(`Falha em ${arr[i].name}`, 'Erro de rede')
      }
    }
    setEnviando(null)
    if (inputRef.current) inputRef.current.value = ''
    success('Peças analisadas', `${totalSug} tese(s) sugerida(s)${totalDup ? `, ${totalDup} já existiam` : ''}. Revise na aba Sugestões.`)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-info/30 bg-info/5 p-4">
        <div className="min-w-0 flex-1 text-sm text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <BookMarked className="h-4 w-4 text-info" /> Como funciona
          </p>
          <p className="mt-1">
            Envie peças do escritório → a IA identifica teses e as <strong>sugere</strong> → você revisa e <strong>aprova</strong>.
            As aprovadas fundamentam as peças da área <strong>sem</strong> o alerta <code>[VERIFICAR]</code>. Nada entra sem sua conferência.
          </p>
        </div>
        {podeCurar && (
          <div className="shrink-0">
            <input ref={inputRef} type="file" accept=".pdf,.docx,.doc,.txt" multiple hidden
              onChange={(e) => handleArquivos(e.target.files)} />
            <Button size="sm" onClick={() => inputRef.current?.click()} disabled={!!enviando} className="gap-1.5">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {enviando ? 'Analisando...' : 'Enviar peças do escritório'}
            </Button>
          </div>
        )}
      </div>

      {enviando && <p className="text-xs text-muted-foreground">{enviando}</p>}

      <div className="flex items-center gap-1 border-b border-border">
        <Aba ativa={aba === 'aprovadas'} onClick={() => setAba('aprovadas')} label="Aprovadas" n={aprovadas.length} />
        {podeCurar && <Aba ativa={aba === 'sugestoes'} onClick={() => setAba('sugestoes')} label="Sugestões" n={sugestoes.length} destaque />}
      </div>

      {lista.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Gavel className="h-8 w-8 opacity-60" />
          <p className="text-sm">
            {aba === 'aprovadas' ? 'Nenhuma tese aprovada ainda.' : 'Nenhuma sugestão pendente. Envie peças do escritório acima.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map((t) =>
            t.status === 'sugerida'
              ? <CardSugestao key={t.id} tese={t} onFeito={() => router.refresh()} />
              : <CardAprovada key={t.id} tese={t} />,
          )}
        </div>
      )}
    </div>
  )
}

function CardSugestao({ tese, onFeito }: { tese: TeseRow; onFeito: () => void }) {
  const { success, error: toastError } = useToast()
  const [editando, setEditando] = useState(false)
  const [enunciado, setEnunciado] = useState(tese.tese)
  const [area, setArea] = useState(tese.area)
  const [dispositivos, setDispositivos] = useState(tese.dispositivos.join('; '))
  const [sumulas, setSumulas] = useState(tese.sumulas.join('; '))
  const [quandoUsar, setQuandoUsar] = useState(tese.quando_usar ?? '')
  const [confirmada, setConfirmada] = useState(false)
  const [modoRejeitar, setModoRejeitar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [processando, setProcessando] = useState(false)

  // Exige conferência humana quando há ementa sem fonte OU citação não verificada.
  const temEmentaSemFonte = tese.ementas.some((e) => e.ementa && !e.fonteUrl)
  const temCitacaoDuvidosa = !!tese.verificacao && (tese.verificacao.problemas > 0 || tese.verificacao.aConferir > 0)
  const precisaConfirmar = temEmentaSemFonte || temCitacaoDuvidosa

  const split = (s: string) => s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)

  async function aprovar() {
    setProcessando(true)
    try {
      const res = await fetch(`/api/teses/${tese.id}/aprovar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tese: enunciado, area, dispositivos: split(dispositivos), sumulas: split(sumulas),
          quando_usar: quandoUsar, confirmada,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toastError('Erro', data.error ?? 'Falha ao aprovar'); return }
      success('Tese aprovada', 'A partir de agora ela fundamenta as peças da área.')
      onFeito()
    } catch { toastError('Erro', 'Falha de rede') } finally { setProcessando(false) }
  }

  async function rejeitar() {
    setProcessando(true)
    try {
      const res = await fetch(`/api/teses/${tese.id}/rejeitar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      })
      if (!res.ok) { const d = await res.json(); toastError('Erro', d.error ?? 'Falha ao rejeitar'); return }
      success('Sugestão descartada', '')
      onFeito()
    } catch { toastError('Erro', 'Falha de rede') } finally { setProcessando(false) }
  }

  return (
    <Card>
      <CardContent className="space-y-2.5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {editando ? (
            <textarea value={enunciado} onChange={(e) => setEnunciado(e.target.value)} rows={2}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          ) : (
            <p className="min-w-0 flex-1 font-medium text-foreground">{enunciado}</p>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {editando ? (
              <select value={area} onChange={(e) => setArea(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                {AREAS_OPCOES.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
              </select>
            ) : (
              <Badge variant="secondary" className="text-xs">{nomeArea(area)}</Badge>
            )}
            {tese.verificacao && tese.verificacao.total > 0 && <SeloCitacoes citacoes={tese.verificacao} />}
          </div>
        </div>

        {editando ? (
          <div className="space-y-2 text-sm">
            <LabeledInput label="Fundamentos (separe por ;)" value={dispositivos} onChange={setDispositivos} />
            <LabeledInput label="Súmulas (separe por ;)" value={sumulas} onChange={setSumulas} />
            <LabeledInput label="Quando usar" value={quandoUsar} onChange={setQuandoUsar} />
          </div>
        ) : (
          <>
            {dispositivos && <p className="text-sm text-muted-foreground"><span className="font-medium">Fundamentos:</span> {dispositivos}</p>}
            {sumulas && <p className="text-sm text-muted-foreground"><span className="font-medium">Súmulas:</span> {sumulas}</p>}
            {quandoUsar && <p className="text-xs italic text-muted-foreground">Quando usar: {quandoUsar}</p>}
          </>
        )}

        {tese.ementas.length > 0 && (
          <div className="space-y-2 border-t pt-2">
            {tese.ementas.map((e, i) => (
              <blockquote key={i} className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
                {e.ementa && <p className="italic">&ldquo;{e.ementa}&rdquo;</p>}
                <p className="mt-0.5 text-xs">
                  {[e.tribunal, e.processo, e.relator, e.julgamento && `j. ${e.julgamento}`].filter(Boolean).join(', ')}
                  {e.fonteUrl
                    ? <a href={e.fonteUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">fonte <ExternalLink className="h-3 w-3" /></a>
                    : <span className="ml-1 text-warning">(sem link de fonte — confira)</span>}
                </p>
              </blockquote>
            ))}
          </div>
        )}

        {tese.trecho_origem && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">trecho de origem</summary>
            <p className="mt-1 rounded bg-muted/40 p-2 italic">{tese.trecho_origem}</p>
          </details>
        )}
        {tese.origem_arquivo && (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground/70"><FileText className="h-3 w-3" /> {tese.origem_arquivo}</p>
        )}

        {modoRejeitar ? (
          <div className="space-y-2 border-t pt-2">
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" autoFocus />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="border border-destructive/20 text-destructive" onClick={rejeitar} loading={processando}>Confirmar descarte</Button>
              <Button size="sm" variant="ghost" onClick={() => setModoRejeitar(false)} disabled={processando}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 border-t pt-2.5">
            {precisaConfirmar && (
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={confirmada} onChange={(e) => setConfirmada(e.target.checked)} className="mt-0.5" />
                <span>Conferi esta fundamentação na fonte e confirmo que está <strong>vigente</strong> (há ementa sem link ou citação não confirmada automaticamente).</span>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={aprovar} loading={processando} disabled={precisaConfirmar && !confirmada}
                className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
                <Check className="h-3.5 w-3.5" /> Aprovar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditando((v) => !v)} disabled={processando} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> {editando ? 'Concluir edição' : 'Editar'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setModoRejeitar(true)} disabled={processando} className="gap-1.5 text-destructive">
                <X className="h-3.5 w-3.5" /> Descartar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CardAprovada({ tese }: { tese: TeseRow }) {
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 flex-1 font-medium text-foreground">{tese.tese}</p>
          <Badge variant="secondary" className="shrink-0 text-xs">{nomeArea(tese.area)}</Badge>
        </div>
        {tese.dispositivos.length > 0 && <p className="text-sm text-muted-foreground"><span className="font-medium">Fundamentos:</span> {tese.dispositivos.join('; ')}</p>}
        {tese.sumulas.length > 0 && <p className="text-sm text-muted-foreground"><span className="font-medium">Súmulas:</span> {tese.sumulas.join('; ')}</p>}
        {tese.quando_usar && <p className="text-xs italic text-muted-foreground">Quando usar: {tese.quando_usar}</p>}
        {tese.ementas.length > 0 && (
          <div className="space-y-2 border-t pt-2">
            {tese.ementas.map((e, i) => (
              <blockquote key={i} className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
                {e.ementa && <p className="italic">&ldquo;{e.ementa}&rdquo;</p>}
                <p className="mt-0.5 text-xs">
                  {[e.tribunal, e.processo, e.relator, e.julgamento && `j. ${e.julgamento}`].filter(Boolean).join(', ')}
                  {e.fonteUrl && <a href={e.fonteUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">fonte <ExternalLink className="h-3 w-3" /></a>}
                </p>
              </blockquote>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground" />
    </label>
  )
}

function Aba({ ativa, onClick, label, n, destaque }: { ativa: boolean; onClick: () => void; label: string; n: number; destaque?: boolean }) {
  return (
    <button onClick={onClick}
      className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        ativa ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
      {label}
      {n > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${destaque && !ativa ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'}`}>{n}</span>}
    </button>
  )
}
