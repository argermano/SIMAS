'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Type, Loader2, RotateCcw } from 'lucide-react'

interface EstiloForm {
  fonte: string
  tamanho_pt: number
  tamanho_ementa_pt: number
  entrelinha: number
  recuo_primeira_linha_cm: number
  recuo_blockquote_cm: number
  margem_topo_cm: number
  margem_baixo_cm: number
  margem_esquerda_cm: number
  margem_direita_cm: number
  cabecalho: string
  rodape: string
  numerar_paginas: boolean
}

const FONTES = ['Times New Roman', 'Arial', 'Calibri', 'Garamond', 'Georgia', 'Cambria', 'Book Antiqua']

const PADRAO: EstiloForm = {
  fonte: 'Times New Roman', tamanho_pt: 12, tamanho_ementa_pt: 10, entrelinha: 1.5,
  recuo_primeira_linha_cm: 1.25, recuo_blockquote_cm: 4,
  margem_topo_cm: 3, margem_baixo_cm: 2, margem_esquerda_cm: 3, margem_direita_cm: 2,
  cabecalho: '', rodape: '', numerar_paginas: false,
}

function paraForm(estilo: Record<string, unknown> | null): EstiloForm {
  if (!estilo) return PADRAO
  const n = (k: string, d: number) => (estilo[k] != null ? Number(estilo[k]) : d)
  return {
    fonte: (estilo.fonte as string) ?? PADRAO.fonte,
    tamanho_pt: n('tamanho_pt', PADRAO.tamanho_pt),
    tamanho_ementa_pt: n('tamanho_ementa_pt', PADRAO.tamanho_ementa_pt),
    entrelinha: n('entrelinha', PADRAO.entrelinha),
    recuo_primeira_linha_cm: n('recuo_primeira_linha_cm', PADRAO.recuo_primeira_linha_cm),
    recuo_blockquote_cm: n('recuo_blockquote_cm', PADRAO.recuo_blockquote_cm),
    margem_topo_cm: n('margem_topo_cm', PADRAO.margem_topo_cm),
    margem_baixo_cm: n('margem_baixo_cm', PADRAO.margem_baixo_cm),
    margem_esquerda_cm: n('margem_esquerda_cm', PADRAO.margem_esquerda_cm),
    margem_direita_cm: n('margem_direita_cm', PADRAO.margem_direita_cm),
    cabecalho: (estilo.cabecalho as string) ?? '',
    rodape: (estilo.rodape as string) ?? '',
    numerar_paginas: Boolean(estilo.numerar_paginas),
  }
}

function CampoNumero({ label, valor, onChange, step = 0.5, min = 0, max = 20, unidade }: {
  label: string; valor: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unidade?: string
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-1">
        <input
          type="number" value={valor} step={step} min={min} max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
        {unidade && <span className="text-xs text-muted-foreground">{unidade}</span>}
      </div>
    </label>
  )
}

export function FormatacaoEscritorio() {
  const { success, error: toastError } = useToast()
  const [form, setForm] = useState<EstiloForm>(PADRAO)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)

  const set = <K extends keyof EstiloForm>(k: K, v: EstiloForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/configuracoes/padroes-formatacao')
        if (res.ok) {
          const data = await res.json()
          setForm(paraForm(data.padrao))
        }
      } finally {
        setCarregando(false)
      }
    })()
  }, [])

  const salvar = useCallback(async () => {
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes/padroes-formatacao', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          cabecalho: form.cabecalho.trim() || null,
          rodape: form.rodape.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Falha ao salvar')
      }
      success('Formatação salva', 'Aplicada na exportação de peças e contratos.')
    } catch (e) {
      toastError('Erro', e instanceof Error ? e.message : 'Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }, [form, success, toastError])

  if (carregando) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando formatação…
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Type className="h-5 w-5 text-muted-foreground" />
          Formatação do Escritório
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Define como peças e contratos são formatados na exportação (DOCX/PDF). Vale para todo o escritório.
        </p>

        {/* Fonte e tamanhos */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fonte</span>
            <select
              value={form.fonte}
              onChange={(e) => set('fonte', e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {FONTES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <CampoNumero label="Corpo" valor={form.tamanho_pt} onChange={(v) => set('tamanho_pt', v)} step={1} min={8} max={18} unidade="pt" />
          <CampoNumero label="Ementa" valor={form.tamanho_ementa_pt} onChange={(v) => set('tamanho_ementa_pt', v)} step={1} min={7} max={16} unidade="pt" />
          <CampoNumero label="Entrelinha" valor={form.entrelinha} onChange={(v) => set('entrelinha', v)} step={0.1} min={1} max={2.5} />
        </div>

        {/* Recuos */}
        <div className="grid grid-cols-2 gap-4">
          <CampoNumero label="Recuo 1ª linha" valor={form.recuo_primeira_linha_cm} onChange={(v) => set('recuo_primeira_linha_cm', v)} step={0.25} max={5} unidade="cm" />
          <CampoNumero label="Recuo citação" valor={form.recuo_blockquote_cm} onChange={(v) => set('recuo_blockquote_cm', v)} step={0.5} max={8} unidade="cm" />
        </div>

        {/* Margens */}
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Margens (cm)</span>
          <div className="mt-1 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <CampoNumero label="Topo" valor={form.margem_topo_cm} onChange={(v) => set('margem_topo_cm', v)} max={8} unidade="cm" />
            <CampoNumero label="Base" valor={form.margem_baixo_cm} onChange={(v) => set('margem_baixo_cm', v)} max={8} unidade="cm" />
            <CampoNumero label="Esquerda" valor={form.margem_esquerda_cm} onChange={(v) => set('margem_esquerda_cm', v)} max={8} unidade="cm" />
            <CampoNumero label="Direita" valor={form.margem_direita_cm} onChange={(v) => set('margem_direita_cm', v)} max={8} unidade="cm" />
          </div>
        </div>

        {/* Cabeçalho / rodapé */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cabeçalho (opcional)</span>
            <input
              type="text" value={form.cabecalho} maxLength={300}
              onChange={(e) => set('cabecalho', e.target.value)}
              placeholder="Ex.: Nome do escritório"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rodapé (opcional)</span>
            <input
              type="text" value={form.rodape} maxLength={300}
              onChange={(e) => set('rodape', e.target.value)}
              placeholder="Ex.: Endereço / contato"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.numerar_paginas} onChange={(e) => set('numerar_paginas', e.target.checked)} />
          Numerar páginas no rodapé
        </label>

        {/* Live preview — atualiza conforme os campos */}
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pré-visualização</span>
          <div
            className="mt-1 rounded-lg border bg-white p-5 text-foreground"
            style={{ fontFamily: `'${form.fonte}', 'Times New Roman', serif`, lineHeight: form.entrelinha }}
          >
            <p className="text-center font-bold uppercase" style={{ fontSize: `${form.tamanho_pt}pt` }}>
              Petição Inicial
            </p>
            <p className="mt-3 font-bold uppercase" style={{ fontSize: `${form.tamanho_pt}pt` }}>
              I – DOS FATOS
            </p>
            <p className="text-justify" style={{ fontSize: `${form.tamanho_pt}pt`, textIndent: `${form.recuo_primeira_linha_cm}cm` }}>
              Trata-se de exemplo de parágrafo para visualizar a formatação aplicada às peças do
              escritório, com recuo de primeira linha, justificação e entrelinha conforme definido acima.
            </p>
            <p className="italic" style={{ fontSize: `${form.tamanho_ementa_pt}pt`, marginLeft: `${Math.min(form.recuo_blockquote_cm, 3)}cm` }}>
              &quot;Ementa de exemplo de citação de jurisprudência, em itálico e recuada.&quot;
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar formatação
          </Button>
          <Button variant="secondary" onClick={() => setForm(PADRAO)} disabled={salvando}>
            <RotateCcw className="mr-2 h-4 w-4" /> Restaurar padrão ABNT
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
