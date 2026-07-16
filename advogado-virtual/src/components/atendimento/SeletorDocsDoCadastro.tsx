'use client'

import { useEffect, useState } from 'react'
import { Loader2, FileText, FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { formatarBytes } from '@/lib/documentos/tamanho'
import { formatarDataRelativa } from '@/lib/utils'

// Picker "Adicionar do cadastro": lista os docs GERAIS do cliente (?gerais=1 —
// sem vínculo de caso/processo) e delega a ação de escolher ao pai. Compartilhado
// entre a tela do caso (AnexosDoCaso) e o Estudo de Caso, que fazem coisas
// diferentes ao escolher (vincular direto x extrair texto + vincular/adiar).

export interface DocGeral {
  id: string
  file_name: string
  tipo: string
  tamanho_bytes: number | null
  created_at: string
}

interface Props {
  clienteId: string
  open: boolean
  onClose: () => void
  // Consome o doc escolhido; retorne true p/ removê-lo da lista (sucesso).
  onEscolher: (doc: DocGeral) => Promise<boolean> | boolean
}

export function SeletorDocsDoCadastro({ clienteId, open, onClose, onEscolher }: Props) {
  const [gerais, setGerais]           = useState<DocGeral[]>([])
  const [carregando, setCarregando]   = useState(false)
  const [processando, setProcessando] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelado = false
    setCarregando(true)
    fetch(`/api/clientes/${clienteId}/documentos?gerais=1`)
      .then((r) => (r.ok ? r.json() : { documentos: [] }))
      .then((d) => { if (!cancelado) setGerais((d.documentos ?? []) as DocGeral[]) })
      .catch(() => { if (!cancelado) setGerais([]) })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [open, clienteId])

  async function escolher(g: DocGeral) {
    setProcessando(g.id)
    try {
      const ok = await onEscolher(g)
      if (ok) setGerais((prev) => prev.filter((x) => x.id !== g.id))
    } finally {
      setProcessando(null)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Adicionar do cadastro"
      description="Vincule a este caso um documento que já está no cadastro do cliente."
      size="md"
    >
      {carregando ? (
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
                disabled={processando === g.id}
                onClick={() => escolher(g)}
              >
                {processando === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
                Adicionar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
