'use client'

import { useState } from 'react'
import { Paperclip, ExternalLink, Loader2, Trash2, Unlink, FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatarDataRelativa } from '@/lib/utils'
import { SeletorDocsDoCadastro, type DocGeral } from './SeletorDocsDoCadastro'

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
  const [pickerAberto, setPickerAberto] = useState(false)

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

  // Vincula o doc escolhido no picker a este caso. Retorna true p/ o picker
  // removê-lo da própria lista (na lista do caso ele passa a ser "do cadastro",
  // cujo X DESVINCULA em vez de excluir).
  async function vincularDoCadastro(g: DocGeral): Promise<boolean> {
    try {
      const r = await fetch(`/api/documentos/${g.id}/vinculo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atendimento_id: atendimentoId }),
      })
      if (r.ok) {
        setDocs((prev) => [
          { id: g.id, file_name: g.file_name, created_at: g.created_at, de_cadastro: true },
          ...prev,
        ])
        success('Adicionado ao caso', 'O documento do cadastro foi vinculado.')
        return true
      }
      const d = await r.json().catch(() => ({}))
      toastError('Não foi possível vincular', d.error ?? 'Tente novamente.')
      return false
    } catch {
      toastError('Não foi possível vincular', 'Falha de rede. Tente novamente.')
      return false
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Documentos anexados</p>
        <Button size="sm" variant="secondary" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setPickerAberto(true)}>
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

      <SeletorDocsDoCadastro
        clienteId={clienteId}
        open={pickerAberto}
        onClose={() => setPickerAberto(false)}
        onEscolher={vincularDoCadastro}
      />
    </div>
  )
}
