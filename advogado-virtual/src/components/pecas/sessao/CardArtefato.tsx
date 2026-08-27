'use client'

// O CARD DO ARTEFATO (F0.5): o arquivo que a IA gerou no sandbox e que JÁ está
// no dossiê do caso — planilha de cálculos, memória de cálculo, gráfico.
//
// Repare no que este card NÃO tem: botão de "salvar no dossiê". O arquivo entra
// automaticamente, sem confirmação (exigência do dono); o que o advogado
// escolhe é ABRIR e, se não serviu, REMOVER. É o mesmo contrato do resto da
// sessão invertido de propósito: a proposta de texto exige aceite, o arquivo de
// apoio não — texto vira peça, arquivo é anexo.

import { useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { ExternalLink, FileImage, FileSpreadsheet, FileText, Loader2, Trash2 } from 'lucide-react'

/** O que o turno do agente guarda em `payload.artefatos` (ver artefatos.ts). */
export interface ArtefatoUI {
  documentoId: string
  nome: string
  ext: string
  tamanho: number
  /** Substituiu a versão anterior do mesmo nome lógico nesta sessão. */
  atualizado?: boolean
  /** O documento não existe mais no dossiê (marcado pelo GET da sessão). */
  removido?: boolean
}

/** Lê a lista de artefatos de um payload de turno sem confiar no formato. */
export function artefatosDoPayload(payload: Record<string, unknown> | null): ArtefatoUI[] {
  const lista = payload?.artefatos
  if (!Array.isArray(lista)) return []
  return lista
    .map((item) => (item ?? {}) as Record<string, unknown>)
    .filter((a) => typeof a.documentoId === 'string' && a.documentoId)
    .map((a) => ({
      documentoId: a.documentoId as string,
      nome: typeof a.nome === 'string' ? a.nome : 'Arquivo de apoio',
      ext: typeof a.ext === 'string' ? a.ext : '',
      tamanho: typeof a.tamanho === 'number' ? a.tamanho : 0,
      atualizado: Boolean(a.atualizado),
      removido: Boolean(a.removido),
    }))
}

export function tamanhoLegivel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

function Icone({ ext }: { ext: string }) {
  const classe = 'h-4 w-4 shrink-0 text-primary'
  if (ext === 'xlsx' || ext === 'csv') return <FileSpreadsheet className={classe} />
  if (ext === 'png') return <FileImage className={classe} />
  return <FileText className={classe} />
}

export function CardArtefato({
  artefato,
  onRemover,
  somenteLeitura,
}: {
  artefato: ArtefatoUI
  /** Remove do dossiê (desvincula das pastas e apaga). Devolve o erro, se houver. */
  onRemover: (documentoId: string) => Promise<{ ok: boolean; erro?: string }>
  somenteLeitura?: boolean
}) {
  const { error: toastError, success } = useToast()
  const [abrindo, setAbrindo] = useState(false)
  const [removendo, setRemovendo] = useState(false)

  async function abrir() {
    setAbrindo(true)
    try {
      const res = await fetch(`/api/documentos/${artefato.documentoId}/url`)
      if (!res.ok) {
        toastError('Não foi possível abrir', 'O arquivo pode ter sido removido do dossiê.')
        return
      }
      const data = (await res.json()) as { url?: string }
      if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch {
      toastError('Não foi possível abrir', 'Falha de rede ao buscar o arquivo.')
    } finally {
      setAbrindo(false)
    }
  }

  async function remover() {
    if (!window.confirm(`Remover "${artefato.nome}" do dossiê? O arquivo é apagado do caso e do Drive.`)) return
    setRemovendo(true)
    try {
      const r = await onRemover(artefato.documentoId)
      if (r.ok) success('Arquivo removido', 'Ele saiu do dossiê do caso.')
      else toastError('Não foi possível remover', r.erro ?? 'Tente novamente pelo dossiê.')
    } finally {
      setRemovendo(false)
    }
  }

  const detalhe = [artefato.ext.toUpperCase(), tamanhoLegivel(artefato.tamanho)]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2 py-1.5">
      <Icone ext={artefato.ext} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{artefato.nome}</p>
        <p className="text-[10px] text-muted-foreground">
          {detalhe}
          {artefato.atualizado ? ' · substituiu a versão anterior' : ''} · no dossiê do caso
        </p>
      </div>

      <button
        onClick={() => void abrir()}
        disabled={abrindo}
        title="Abrir o arquivo"
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
      >
        {abrindo ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
        abrir
      </button>

      {!somenteLeitura && (
        <button
          onClick={() => void remover()}
          disabled={removendo}
          title="Remover do dossiê"
          aria-label="Remover do dossiê"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {removendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
      )}
    </div>
  )
}
