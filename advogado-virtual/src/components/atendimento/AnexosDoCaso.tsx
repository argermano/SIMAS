'use client'

import { useState } from 'react'
import { Paperclip, ExternalLink, Loader2, Trash2, Unlink, FolderPlus, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatarBytes } from '@/lib/documentos/tamanho'
import { formatarDataRelativa } from '@/lib/utils'

// Lista de documentos anexados ao CASO (coluna direita da tela do caso). Além
// dos docs que nasceram no caso, permite "Adicionar do cadastro" (vincular um
// doc GERAL do cliente) — que aparece com o rótulo "do cadastro" e cujo X
// DESVINCULA (volta ao dossiê), enquanto o X de um doc do caso EXCLUI.

export interface AnexoCaso {
  id: string
  file_name: string
  created_at: string
  de_cadastro: boolean // nasceu no dossiê do cliente e foi vinculado a este caso
}

interface DocGeral {
  id: string
  file_name: string
  tipo: string
  tamanho_bytes: number | null
  created_at: string
}

interface Props {
  clienteId: string
  atendimentoId: string
  documentosIniciais: AnexoCaso[]
}

export function AnexosDoCaso({ clienteId, atendimentoId, documentosIniciais }: Props) {
  const { success, error: toastError } = useToast()
  const [docs, setDocs]       = useState<AnexoCaso[]>(documentosIniciais)
  const [ocupado, setOcupado] = useState<string | null>(null) // id do doc em ação
  const [abrindo, setAbrindo] = useState<string | null>(null)

  // Picker "Adicionar do cadastro"
  const [pickerAberto, setPickerAberto]         = useState(false)
  const [gerais, setGerais]                     = useState<DocGeral[]>([])
  const [carregandoGerais, setCarregandoGerais] = useState(false)
  const [vinculando, setVinculando]             = useState<string | null>(null)

  async function abrir(doc: AnexoCaso) {
    setAbrindo(doc.id)
    try {
      const r = await fetch(`/api/documentos/${doc.id}/url`)
      const d = await r.json()
      if (d.url) window.open(d.url, '_blank')
    } catch {
      // silencioso
    } finally {
      setAbrindo(null)
    }
  }

  async function remover(doc: AnexoCaso) {
    // X do doc "do cadastro" DESVINCULA (volta ao dossiê); do doc do caso, EXCLUI.
    const msg = doc.de_cadastro
      ? 'Remover deste caso? O documento volta ao cadastro do cliente (não é excluído).'
      : 'Excluir este documento? Esta ação não pode ser desfeita.'
    if (!confirm(msg)) return
    setOcupado(doc.id)
    try {
      const r = doc.de_cadastro
        ? await fetch(`/api/documentos/${doc.id}/vinculo`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ desvincular: true }),
          })
        : await fetch(`/api/documentos/${doc.id}`, { method: 'DELETE' })
      if (r.ok) {
        setDocs((prev) => prev.filter((d) => d.id !== doc.id))
        success(doc.de_cadastro ? 'Documento desvinculado' : 'Documento excluído')
      } else {
        const d = await r.json().catch(() => ({}))
        toastError('Não foi possível', d.error ?? 'Tente novamente.')
      }
    } catch {
      toastError('Não foi possível', 'Falha de rede. Tente novamente.')
    } finally {
      setOcupado(null)
    }
  }

  async function abrirPicker() {
    setPickerAberto(true)
    setCarregandoGerais(true)
    try {
      const r = await fetch(`/api/clientes/${clienteId}/documentos?gerais=1`)
      const d = await r.json()
      if (r.ok) setGerais((d.documentos ?? []) as DocGeral[])
    } catch {
      // lista fica vazia
    } finally {
      setCarregandoGerais(false)
    }
  }

  async function vincular(g: DocGeral) {
    setVinculando(g.id)
    try {
      const r = await fetch(`/api/documentos/${g.id}/vinculo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atendimento_id: atendimentoId }),
      })
      if (r.ok) {
        setGerais((prev) => prev.filter((x) => x.id !== g.id))
        setDocs((prev) => [
          { id: g.id, file_name: g.file_name, created_at: g.created_at, de_cadastro: true },
          ...prev,
        ])
        success('Adicionado ao caso', 'O documento do cadastro foi vinculado.')
      } else {
        const d = await r.json().catch(() => ({}))
        toastError('Não foi possível vincular', d.error ?? 'Tente novamente.')
      }
    } catch {
      toastError('Não foi possível vincular', 'Falha de rede. Tente novamente.')
    } finally {
      setVinculando(null)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Documentos anexados</p>
        <Button size="sm" variant="secondary" className="h-7 gap-1.5 px-2 text-xs" onClick={abrirPicker}>
          <FolderPlus className="h-3.5 w-3.5" /> Adicionar do cadastro
        </Button>
      </div>

      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Nenhum documento anexado.</p>
      ) : (
        docs.map((doc) => (
          <div
            key={doc.id}
            className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm transition-colors hover:border-primary/30 hover:bg-muted/50"
          >
            <button onClick={() => abrir(doc)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
              <Paperclip className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground transition-colors group-hover:text-primary">{doc.file_name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{formatarDataRelativa(doc.created_at)}</span>
                  {doc.de_cadastro && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title="Documento do cadastro do cliente, vinculado a este caso">
                      <FolderPlus className="h-3 w-3" /> do cadastro
                    </span>
                  )}
                </span>
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              {abrindo === doc.id
                ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                : <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
              <button
                onClick={() => remover(doc)}
                disabled={ocupado === doc.id}
                className="rounded p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
                title={doc.de_cadastro ? 'Remover do caso (volta ao cadastro)' : 'Excluir documento'}
              >
                {ocupado === doc.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : doc.de_cadastro ? <Unlink className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ))
      )}

      <Dialog
        open={pickerAberto}
        onClose={() => setPickerAberto(false)}
        title="Adicionar do cadastro"
        description="Vincule a este caso um documento que já está no cadastro do cliente."
        size="md"
      >
        {carregandoGerais ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando documentos do cadastro…
          </p>
        ) : gerais.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum documento geral disponível. Docs já vinculados a casos ou processos não aparecem aqui.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {gerais.map((g) => (
              <li key={g.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground" title={g.file_name}>{g.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatarBytes(Number(g.tamanho_bytes ?? 0))} · {formatarDataRelativa(g.created_at)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 shrink-0 gap-1.5 px-2 text-xs"
                  disabled={vinculando === g.id}
                  onClick={() => vincular(g)}
                >
                  {vinculando === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
                  Adicionar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  )
}
