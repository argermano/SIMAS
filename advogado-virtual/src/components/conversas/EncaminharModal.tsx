'use client'

import { useEffect, useMemo, useState } from 'react'
import { Forward, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { Anexo, Conversa } from '@/lib/conversas/tipos'
import { mesclarPaginas, temMaisPorContagem } from '@/lib/conversas/lista-infinita'
import { AvatarContato } from './AvatarContato'
import { mensagemErroRelay } from './erros'

// Teto de páginas ao buscar destinos (o relay não busca por texto; carregamos até
// ~250 conversas abertas e filtramos no cliente). Evita destino inalcançável na 2ª página.
const MAX_PAGINAS_DESTINO = 10

/**
 * Encaminha um anexo RECEBIDO (imagem/arquivo) para outra conversa.
 * Carrega as conversas abertas (GET /api/conversas?status=open, várias páginas) e
 * filtra no cliente por nome/telefone — a lista do relay não busca por texto. Ao
 * escolher o destino: POST /api/conversas/<destinoId>/encaminhar { anexoUrl }. O
 * relay baixa os bytes de origem e reenvia (428/tipo/tamanho vêm dele, em toast).
 * Nunca oferece a própria conversa de origem como destino.
 */
export function EncaminharModal({
  aberto,
  anexo,
  origemConversaId,
  onFechar,
}: {
  aberto: boolean
  anexo: Anexo | null
  /** Conversa de origem — excluída da lista de destinos. */
  origemConversaId?: number
  onFechar: () => void
}) {
  const { success, error: toastError } = useToast()
  const [conversas, setConversas] = useState<Conversa[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [enviandoId, setEnviandoId] = useState<number | null>(null)

  // Carrega as conversas abertas ao abrir (e zera o estado ao fechar).
  useEffect(() => {
    if (!aberto) return
    setConversas(null)
    setErro(null)
    setQ('')
    setEnviandoId(null)
    setCarregando(true)
    let ativo = true
    void (async () => {
      try {
        // Busca páginas até esvaziar ou o teto (senão destinos além da 1ª página
        // ficariam inalcançáveis mesmo abertos).
        const paginas: Conversa[][] = []
        for (let pagina = 1; pagina <= MAX_PAGINAS_DESTINO; pagina++) {
          const r = await fetch(`/api/conversas?status=open&page=${pagina}`)
          const d = await r.json().catch(() => ({}))
          if (!ativo) return
          if (!r.ok) {
            setErro(mensagemErroRelay(r.status, d))
            setConversas([])
            return
          }
          const lista = (d as { conversas?: Conversa[] }).conversas
          const arr = Array.isArray(lista) ? lista : []
          paginas.push(arr)
          if (!temMaisPorContagem(arr.length)) break
        }
        setConversas(mesclarPaginas(paginas))
      } catch {
        if (ativo) {
          setErro('Falha de rede ao carregar as conversas.')
          setConversas([])
        }
      } finally {
        if (ativo) setCarregando(false)
      }
    })()
    return () => {
      ativo = false
    }
  }, [aberto])

  const filtradas = useMemo(() => {
    const termo = q.trim().toLowerCase()
    const base = (conversas ?? []).filter((c) => c.id !== origemConversaId)
    if (!termo) return base
    return base.filter((c) => {
      const nome = (c.contato.nome ?? '').toLowerCase()
      const tel = (c.contato.telefone ?? '').toLowerCase()
      return nome.includes(termo) || tel.includes(termo)
    })
  }, [conversas, q, origemConversaId])

  async function encaminhar(destino: Conversa) {
    if (!anexo || enviandoId !== null) return
    setEnviandoId(destino.id)
    try {
      const r = await fetch(`/api/conversas/${destino.id}/encaminhar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anexoUrl: anexo.url }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não encaminhado', mensagemErroRelay(r.status, d))
        return
      }
      const nome = destino.contato.nome || destino.contato.telefone || `Conversa #${destino.id}`
      success('Documento encaminhado', `Enviado para ${nome}.`)
      onFechar()
    } catch {
      toastError('Não encaminhado', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviandoId(null)
    }
  }

  return (
    <Dialog
      open={aberto}
      onClose={onFechar}
      title="Encaminhar documento"
      description="Escolha a conversa que vai receber este anexo."
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
            placeholder="Buscar por nome ou telefone…"
            aria-label="Buscar conversa"
            autoFocus
            className="h-9 pl-9 text-sm"
          />
        </div>

        {carregando ? (
          <p className="flex items-center gap-2 px-1 py-4 text-xs text-muted-foreground">
            <Spinner className="h-3.5 w-3.5" /> Carregando conversas…
          </p>
        ) : erro ? (
          <p className="px-1 py-2 text-xs text-destructive">{erro}</p>
        ) : filtradas.length > 0 ? (
          <ul className="max-h-72 overflow-y-auto rounded-lg border border-border" aria-label="Conversas abertas">
            {filtradas.map((c) => {
              const nome = c.contato.nome || c.contato.telefone || `Conversa #${c.id}`
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void encaminhar(c)}
                    disabled={enviandoId !== null}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0',
                      'hover:bg-muted disabled:opacity-60',
                    )}
                  >
                    <AvatarContato nome={nome} avatarUrl={c.contato.avatarUrl} className="h-8 w-8 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{nome}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        WhatsApp · {c.inbox}
                        {c.contato.nome && c.contato.telefone ? ` · ${c.contato.telefone}` : ''}
                      </span>
                    </span>
                    {enviandoId === c.id ? (
                      <Spinner className="h-4 w-4 shrink-0" />
                    ) : (
                      <Forward className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-1 py-3 text-xs text-muted-foreground">
            {q.trim() ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa aberta.'}
          </p>
        )}
      </div>
    </Dialog>
  )
}
