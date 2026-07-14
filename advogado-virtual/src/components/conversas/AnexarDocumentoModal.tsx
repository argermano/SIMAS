'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Paperclip, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { mensagemErroRelay } from './erros'

interface DocumentoItem {
  id: string
  nome: string | null
  tipo: string | null
  mime: string | null
  tamanho: number | null
}

/** bytes -> "1,2 MB" / "340 KB" (pt-BR curto). null quando não informado. */
function tamanhoLegivel(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/**
 * Anexa um documento JÁ no SIMAS (do caso/cliente) e o envia ao cliente na
 * conversa. Lista GET /api/conversas/documentos?clienteId=&q= (só tipos
 * enviáveis) e, ao escolher: POST /api/conversas/<conversaId>/anexar-documento
 * { documentoId }. O relay resolve o token pessoal do agente e posta no Chatwoot
 * (428/tipo vêm dele, em toast). Sem clienteId, lista os documentos do tenant.
 */
export function AnexarDocumentoModal({
  aberto,
  conversaId,
  clienteId,
  onFechar,
  onEnviado,
}: {
  aberto: boolean
  conversaId: number
  /** Pré-filtra os documentos por cliente casado à conversa, se houver. */
  clienteId?: string | null
  onFechar: () => void
  /** Sucesso do envio: recarrega a thread/lista (paridade com o upload do PC). */
  onEnviado?: () => void
}) {
  const { success, error: toastError } = useToast()
  const [documentos, setDocumentos] = useState<DocumentoItem[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [enviandoId, setEnviandoId] = useState<string | null>(null)
  // Descarta respostas atrasadas do debounce da busca.
  const buscaSeq = useRef(0)

  // Reinicia a busca ao abrir.
  useEffect(() => {
    if (aberto) setQ('')
  }, [aberto])

  // Carrega ao abrir e a cada termo (debounce só quando há texto).
  useEffect(() => {
    if (!aberto) return
    const seq = ++buscaSeq.current
    setCarregando(true)
    setErro(null)
    const termo = q.trim()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams()
        if (clienteId) params.set('clienteId', clienteId)
        if (termo) params.set('q', termo)
        const r = await fetch(`/api/conversas/documentos?${params.toString()}`)
        const d = await r.json().catch(() => ({}))
        if (seq !== buscaSeq.current) return
        if (!r.ok) {
          setErro(mensagemErroRelay(r.status, d))
          setDocumentos([])
        } else {
          const lista = (d as { documentos?: DocumentoItem[] }).documentos
          setDocumentos(Array.isArray(lista) ? lista : [])
        }
      } catch {
        if (seq === buscaSeq.current) {
          setErro('Falha de rede ao carregar os documentos.')
          setDocumentos([])
        }
      } finally {
        if (seq === buscaSeq.current) setCarregando(false)
      }
    }, termo ? 300 : 0)
    return () => clearTimeout(timer)
  }, [aberto, q, clienteId])

  async function anexar(doc: DocumentoItem) {
    if (enviandoId !== null) return
    setEnviandoId(doc.id)
    try {
      const r = await fetch(`/api/conversas/${conversaId}/anexar-documento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentoId: doc.id }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não enviado', mensagemErroRelay(r.status, d))
        return
      }
      success('Documento enviado', `${doc.nome || 'Documento'} foi enviado ao cliente.`)
      onEnviado?.()
      onFechar()
    } catch {
      toastError('Não enviado', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviandoId(null)
    }
  }

  return (
    <Dialog
      open={aberto}
      onClose={onFechar}
      title="Enviar documento do SIMAS"
      description="Escolha um documento do caso para enviar ao cliente nesta conversa."
    >
      <div className="space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar documento pelo nome…"
            aria-label="Buscar documento"
            autoFocus
            className="h-9 pl-9 text-sm"
          />
        </div>

        {carregando ? (
          <p className="flex items-center gap-2 px-1 py-4 text-xs text-muted-foreground">
            <Spinner className="h-3.5 w-3.5" /> Carregando documentos…
          </p>
        ) : erro ? (
          <p className="px-1 py-2 text-xs text-destructive">{erro}</p>
        ) : documentos && documentos.length > 0 ? (
          <ul className="max-h-72 overflow-y-auto rounded-lg border border-border" aria-label="Documentos do caso">
            {documentos.map((doc) => {
              const tam = tamanhoLegivel(doc.tamanho)
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => void anexar(doc)}
                    disabled={enviandoId !== null}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0',
                      'hover:bg-muted disabled:opacity-60',
                    )}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{doc.nome || 'Documento'}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[doc.tipo, tam].filter(Boolean).join(' · ') || 'Documento'}
                      </span>
                    </span>
                    {enviandoId === doc.id ? (
                      <Spinner className="h-4 w-4 shrink-0" />
                    ) : (
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-1 py-3 text-xs text-muted-foreground">
            {q.trim()
              ? 'Nenhum documento encontrado.'
              : clienteId
                ? 'Este cliente não tem documentos anexados.'
                : 'Nenhum documento disponível.'}
          </p>
        )}
      </div>
    </Dialog>
  )
}
