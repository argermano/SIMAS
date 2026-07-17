'use client'

import { useEffect, useState } from 'react'
import { Loader2, FileText, FolderPlus, Briefcase, Scale, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { formatarBytes } from '@/lib/documentos/tamanho'
import { formatarDataRelativa } from '@/lib/utils'
import { formatarCnj } from '@/lib/tarefas/vinculo'
import type { VinculoDoc } from '@/lib/documentos/vinculos'

// Picker "Adicionar do cadastro": com os vínculos N:N (063), o dono quer
// REAPROVEITAR neste caso um documento que já está no cadastro — mesmo que ele
// já esteja em OUTRO caso/processo. Por isso listamos TODOS os docs do cliente
// (não só os "gerais"), mostrando badges das pastas onde cada um já está. Os que
// já estão NESTE caso ficam desabilitados. Delega a ação de escolher ao pai
// (tela do caso vincula direto; Estudo extrai texto + vincula/adia).

export interface DocGeral {
  id: string
  file_name: string
  tipo: string
  tamanho_bytes: number | null
  created_at: string
  vinculos: VinculoDoc[]
}

interface Props {
  clienteId: string
  open: boolean
  onClose: () => void
  // Caso atual: docs já vinculados a ele aparecem desabilitados ("já está").
  atendimentoAtual?: string | null
  // Consome o doc escolhido; retorne true p/ marcá-lo como já adicionado.
  onEscolher: (doc: DocGeral) => Promise<boolean> | boolean
}

// Rótulo curto de uma pasta (narrowing por `!== null`: atendimento_id é UUID no
// vínculo de caso e null no de processo — discriminante confiável da união).
function rotuloVinculo(v: VinculoDoc): { caso: boolean; label: string } {
  if (v.atendimento_id !== null) return { caso: true, label: v.titulo?.trim() || 'caso' }
  return { caso: false, label: v.apelido?.trim() || formatarCnj(v.numero_cnj) || 'processo' }
}

// Badges das pastas onde o doc já está (contexto p/ reaproveitar de outra pasta).
function BadgesVinculos({ vinculos }: { vinculos: VinculoDoc[] }) {
  if (vinculos.length === 0) return null
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1">
      {vinculos.map((v, i) => {
        const { caso, label } = rotuloVinculo(v)
        return (
          <span key={i} className="inline-flex max-w-[160px] items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {caso ? <Briefcase className="h-3 w-3 shrink-0" /> : <Scale className="h-3 w-3 shrink-0" />}
            <span className="truncate">{label}</span>
          </span>
        )
      })}
    </span>
  )
}

export function SeletorDocsDoCadastro({ clienteId, open, onClose, atendimentoAtual, onEscolher }: Props) {
  const [docs, setDocs]               = useState<DocGeral[]>([])
  const [carregando, setCarregando]   = useState(false)
  const [processando, setProcessando] = useState<string | null>(null)
  // Docs adicionados AGORA (viram "já está neste caso" sem sumir da lista).
  const [linkados, setLinkados]       = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    let cancelado = false
    setCarregando(true)
    setLinkados(new Set())
    // Todos os docs do cliente (não só os gerais): permite reaproveitar de outra pasta.
    fetch(`/api/clientes/${clienteId}/documentos`)
      .then((r) => (r.ok ? r.json() : { documentos: [] }))
      .then((d) => { if (!cancelado) setDocs((d.documentos ?? []) as DocGeral[]) })
      .catch(() => { if (!cancelado) setDocs([]) })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [open, clienteId])

  // Já está neste caso? (vínculo existente OU acabou de ser adicionado).
  const jaNoCaso = (g: DocGeral) =>
    linkados.has(g.id) ||
    (!!atendimentoAtual && g.vinculos.some((v) => v.atendimento_id === atendimentoAtual))

  async function escolher(g: DocGeral) {
    setProcessando(g.id)
    try {
      const ok = await onEscolher(g)
      if (ok) setLinkados((prev) => new Set(prev).add(g.id))
    } finally {
      setProcessando(null)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Adicionar do cadastro"
      description="Reaproveite neste caso um documento do cadastro do cliente — mesmo que ele já esteja em outro caso ou processo."
      size="md"
    >
      {carregando ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando documentos do cadastro…
        </p>
      ) : docs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Este cliente ainda não tem documentos no cadastro.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((g) => {
            const noCaso = jaNoCaso(g)
            return (
              <li key={g.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground" title={g.file_name}>{g.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatarBytes(Number(g.tamanho_bytes ?? 0))} · {formatarDataRelativa(g.created_at)}
                  </p>
                  <BadgesVinculos vinculos={g.vinculos} />
                </div>
                {noCaso ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                    <Check className="h-3.5 w-3.5" /> já está neste caso
                  </span>
                ) : (
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
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}
