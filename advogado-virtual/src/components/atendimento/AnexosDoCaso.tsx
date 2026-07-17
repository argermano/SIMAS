'use client'

import { useState } from 'react'
import { Paperclip, ExternalLink, Loader2, Trash2, Unlink, FolderPlus, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatarDataRelativa } from '@/lib/utils'
import { SeletorDocsDoCadastro, type DocGeral } from './SeletorDocsDoCadastro'

// Lista de documentos anexados ao CASO (coluna direita da tela do caso). Com os
// vínculos N:N (063), o MESMO arquivo pode servir a vários casos/processos. Por
// isso o X aqui REMOVE só o vínculo deste caso (o arquivo continua no cliente e
// nas outras pastas) — EXCETO para um doc que NASCEU neste caso, que segue a
// regra de sempre: é excluído de fato (só some se não estiver em outra pasta).

export interface AnexoCaso {
  id: string
  file_name: string
  created_at: string
  nascido_neste_caso: boolean // origem = este caso (senão é atalho de outra pasta)
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

  // Remove só o vínculo deste caso (nunca exclui o arquivo).
  async function removerVinculo(docId: string): Promise<Response> {
    return fetch(`/api/documentos/${docId}/vinculo`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remover: { atendimento_id: atendimentoId } }),
    })
  }

  async function remover(doc: AnexoCaso) {
    // Doc que NASCEU neste caso → regra de sempre: EXCLUIR. Como ele carrega o
    // próprio vínculo N:N (063), tiramos esse vínculo e então tentamos excluir o
    // arquivo — que só some se não estiver em outra pasta. Atalho de outra pasta
    // → só REMOVE o vínculo deste caso (o arquivo continua no cliente).
    const msg = doc.nascido_neste_caso
      ? 'Excluir este documento? Se ele também estiver em outras pastas, será apenas removido deste caso.'
      : 'Remover deste caso? O documento continua no cadastro do cliente (não é excluído).'
    if (!confirm(msg)) return
    setOcupado(doc.id)
    try {
      if (doc.nascido_neste_caso) {
        const rv = await removerVinculo(doc.id)
        if (!rv.ok) {
          const d = await rv.json().catch(() => ({}))
          toastError('Não foi possível', d.error ?? 'Tente novamente.')
          return
        }
        // Agora tenta excluir de fato (409 se ainda estiver em outras pastas).
        const rd = await fetch(`/api/documentos/${doc.id}`, { method: 'DELETE' })
        setDocs((prev) => prev.filter((d) => d.id !== doc.id))
        if (rd.ok) success('Documento excluído')
        else success('Removido do caso', 'Ele está em outras pastas, então não foi excluído.')
      } else {
        const r = await removerVinculo(doc.id)
        if (r.ok) {
          setDocs((prev) => prev.filter((d) => d.id !== doc.id))
          success('Removido do caso', 'Continua no cadastro do cliente.')
        } else {
          const d = await r.json().catch(() => ({}))
          toastError('Não foi possível', d.error ?? 'Tente novamente.')
        }
      }
    } catch {
      toastError('Não foi possível', 'Falha de rede. Tente novamente.')
    } finally {
      setOcupado(null)
    }
  }

  // Vincula (adiciona) o doc escolhido no picker a este caso. Retorna true p/ o
  // picker marcá-lo como "já está neste caso". Ele entra como atalho de outra
  // pasta (nascido_neste_caso=false → X só remove o vínculo).
  async function vincularDoCadastro(g: DocGeral): Promise<boolean> {
    try {
      const r = await fetch(`/api/documentos/${g.id}/vinculo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adicionar: { atendimento_id: atendimentoId } }),
      })
      if (r.ok) {
        setDocs((prev) => prev.some((d) => d.id === g.id)
          ? prev
          : [{ id: g.id, file_name: g.file_name, created_at: g.created_at, nascido_neste_caso: false }, ...prev])
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
                  {!doc.nascido_neste_caso && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title="Documento de outra pasta, vinculado a este caso (atalho)">
                      <Link2 className="h-3 w-3" /> atalho
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
                title={doc.nascido_neste_caso ? 'Excluir documento' : 'Remover do caso (continua no cadastro)'}
              >
                {ocupado === doc.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : doc.nascido_neste_caso ? <Trash2 className="h-4 w-4" /> : <Unlink className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ))
      )}

      <SeletorDocsDoCadastro
        clienteId={clienteId}
        open={pickerAberto}
        onClose={() => setPickerAberto(false)}
        atendimentoAtual={atendimentoId}
        onEscolher={vincularDoCadastro}
      />
    </div>
  )
}
