'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Forward, Phone, Search, UserRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { Anexo, Conversa, StatusConversa } from '@/lib/conversas/tipos'
import { mesclarPaginas, temMaisPorContagem } from '@/lib/conversas/lista-infinita'
import { formatarCelularBR } from '@/lib/format/celular'
import { LIMITE_ENCAMINHAR_NUMERO_BYTES, telefoneDestinoValido } from '@/lib/conversas/encaminhar'
import { AvatarContato } from './AvatarContato'
import { mensagemErroApi, mensagemErroRelay } from './erros'

// Teto de páginas por status ao buscar destinos (o relay não busca por texto;
// carregamos e filtramos no cliente). As RESOLVIDAS entram porque o Chatwoot
// reabre a conversa ao receber — mas com teto menor: quem não estiver na lista é
// alcançável pela aba "Número/cliente", que não depende de conversa nenhuma.
const PAGINAS_POR_STATUS: Record<StatusConversa, number> = { open: 10, resolved: 4 }

type Modo = 'conversa' | 'numero'

interface ClienteBusca {
  id: string
  nome: string
  telefone: string | null
}

/**
 * Encaminha um anexo RECEBIDO (imagem, arquivo, VÍDEO ou ÁUDIO) para outro destino.
 * Duas formas, em abas:
 *  • Conversa — lista as conversas abertas E resolvidas (GET /api/conversas?status=,
 *    várias páginas) e filtra no cliente por nome/telefone. Envia por
 *    POST /api/conversas/<destinoId>/encaminhar { anexoUrl } (relay → Chatwoot).
 *  • Número/cliente — busca um cliente do SIMAS por nome (GET /api/conversas/clientes)
 *    ou aceita um celular BR digitado, e envia por POST /api/conversas/encaminhar
 *    { telefone, anexoUrl } (canal do bot) — funciona para QUALQUER número, mesmo
 *    sem conversa aberta. Nos dois casos o servidor baixa os bytes de origem.
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
  /** Conversa de origem — excluída da lista de destinos (e registrada na auditoria). */
  origemConversaId?: number
  onFechar: () => void
}) {
  const { success, error: toastError } = useToast()
  const [modo, setModo] = useState<Modo>('conversa')

  // --- aba Conversa ---------------------------------------------------------
  const [conversas, setConversas] = useState<Conversa[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [enviandoId, setEnviandoId] = useState<number | null>(null)

  // --- aba Número/cliente ---------------------------------------------------
  const [qCliente, setQCliente] = useState('')
  const [clientes, setClientes] = useState<ClienteBusca[]>([])
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const [buscouCliente, setBuscouCliente] = useState(false)
  const [telefone, setTelefone] = useState('')
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [enviandoNumero, setEnviandoNumero] = useState(false)
  const buscaSeq = useRef(0)

  // Zera tudo ao abrir e carrega as conversas (abertas + resolvidas).
  useEffect(() => {
    if (!aberto) return
    setModo('conversa')
    setConversas(null)
    setErro(null)
    setQ('')
    setEnviandoId(null)
    setQCliente('')
    setClientes([])
    setBuscouCliente(false)
    setTelefone('')
    setClienteId(null)
    setEnviandoNumero(false)
    setCarregando(true)
    let ativo = true

    /** Páginas de um status, até esvaziar ou bater o teto. Nunca lança: um status
     *  que falha não pode derrubar o outro (mesma tolerância da varredura da lista). */
    async function carregarStatus(
      status: StatusConversa,
    ): Promise<{ conversas: Conversa[]; erro: string | null }> {
      const paginas: Conversa[][] = []
      for (let pagina = 1; pagina <= PAGINAS_POR_STATUS[status]; pagina++) {
        try {
          const r = await fetch(`/api/conversas?status=${status}&page=${pagina}`)
          const d = await r.json().catch(() => ({}))
          if (!r.ok) {
            return { conversas: mesclarPaginas(paginas), erro: mensagemErroRelay(r.status, d) }
          }
          const lista = (d as { conversas?: Conversa[] }).conversas
          const arr = Array.isArray(lista) ? lista : []
          paginas.push(arr)
          if (!temMaisPorContagem(arr.length)) break
        } catch {
          return { conversas: mesclarPaginas(paginas), erro: 'Falha de rede ao carregar as conversas.' }
        }
      }
      return { conversas: mesclarPaginas(paginas), erro: null }
    }

    void (async () => {
      // Em paralelo: cada status pagina por conta própria. Abertas primeiro na
      // lista final (destino mais provável); mesclarPaginas dedupa por id.
      const [abertas, resolvidas] = await Promise.all([
        carregarStatus('open'),
        carregarStatus('resolved'),
      ])
      if (!ativo) return
      const lista = mesclarPaginas([abertas.conversas, resolvidas.conversas])
      setConversas(lista)
      // Só vira erro na tela se NADA veio; com lista parcial a equipe segue
      // trabalhando (e a aba "Número/cliente" alcança qualquer destino).
      setErro(lista.length === 0 ? abertas.erro ?? resolvidas.erro : null)
      setCarregando(false)
    })()
    return () => {
      ativo = false
    }
  }, [aberto])

  // Busca de clientes (debounce 300ms, a partir de 2 letras) — mesma rota leve do
  // "Vincular cliente"; o que interessa aqui é o TELEFONE do cadastro.
  useEffect(() => {
    if (!aberto || modo !== 'numero') return
    const termo = qCliente.trim()
    if (termo.length < 2) {
      setClientes([])
      setBuscandoCliente(false)
      setBuscouCliente(false)
      return
    }
    setBuscandoCliente(true)
    const seq = ++buscaSeq.current
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/conversas/clientes?q=${encodeURIComponent(termo)}`)
        const d = await r.json().catch(() => ({}))
        if (seq !== buscaSeq.current) return
        const lista = (d as { clientes?: ClienteBusca[] }).clientes
        setClientes(r.ok && Array.isArray(lista) ? lista : [])
        setBuscouCliente(true)
      } catch {
        if (seq !== buscaSeq.current) return
        setClientes([])
        setBuscouCliente(true)
      } finally {
        if (seq === buscaSeq.current) setBuscandoCliente(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [aberto, modo, qCliente])

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

  const telefoneOk = telefoneDestinoValido(telefone)
  const ocupado = enviandoId !== null || enviandoNumero

  const encerrarComSucesso = useCallback(
    (destino: string) => {
      success('Anexo encaminhado', `Enviado para ${destino}.`)
      onFechar()
    },
    [success, onFechar],
  )

  /** Destino CONVERSA: mantém a thread no Chatwoot (token pessoal do agente). */
  async function encaminharParaConversa(destino: Conversa) {
    if (!anexo || ocupado) return
    setEnviandoId(destino.id)
    try {
      const r = await fetch(`/api/conversas/${destino.id}/encaminhar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anexoUrl: anexo.url }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não encaminhado', mensagemErroApi(r.status, d))
        return
      }
      encerrarComSucesso(destino.contato.nome || destino.contato.telefone || `Conversa #${destino.id}`)
    } catch {
      toastError('Não encaminhado', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviandoId(null)
    }
  }

  /** Destino NÚMERO: vai pelo canal do bot — não exige conversa aberta. */
  async function encaminharParaNumero() {
    if (!anexo || ocupado || !telefoneOk) return
    setEnviandoNumero(true)
    try {
      const r = await fetch('/api/conversas/encaminhar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anexoUrl: anexo.url,
          telefone,
          ...(clienteId ? { clienteId } : {}),
          ...(origemConversaId !== undefined ? { origemConversaId } : {}),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não encaminhado', mensagemErroApi(r.status, d))
        return
      }
      encerrarComSucesso(telefone)
    } catch {
      toastError('Não encaminhado', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviandoNumero(false)
    }
  }

  function escolherCliente(c: ClienteBusca) {
    if (!c.telefone || !telefoneDestinoValido(c.telefone)) {
      toastError('Cliente sem WhatsApp', `${c.nome} não tem telefone válido no cadastro.`)
      return
    }
    setTelefone(formatarCelularBR(c.telefone))
    setClienteId(c.id)
  }

  return (
    <Dialog
      open={aberto}
      onClose={onFechar}
      title="Encaminhar anexo"
      description="Escolha uma conversa ou envie direto para um número de WhatsApp."
    >
      <div className="space-y-3">
        {/* Abas do destino */}
        <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Forma de escolher o destino">
          {([
            { id: 'conversa' as const, rotulo: 'Conversa' },
            { id: 'numero' as const, rotulo: 'Número/cliente' },
          ]).map((aba) => (
            <button
              key={aba.id}
              type="button"
              role="tab"
              aria-selected={modo === aba.id}
              onClick={() => setModo(aba.id)}
              disabled={ocupado}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
                modo === aba.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {aba.rotulo}
            </button>
          ))}
        </div>

        {modo === 'conversa' ? (
          <>
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
              <ul className="max-h-72 overflow-y-auto rounded-lg border border-border" aria-label="Conversas">
                {filtradas.map((c) => {
                  const nome = c.contato.nome || c.contato.telefone || `Conversa #${c.id}`
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => void encaminharParaConversa(c)}
                        disabled={ocupado}
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
                            {c.status === 'resolved' ? ' · resolvida' : ''}
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
                {q.trim() ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa na lista.'}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={qCliente}
                onChange={(e) => setQCliente(e.target.value)}
                placeholder="Buscar cliente por nome…"
                aria-label="Buscar cliente por nome"
                autoFocus
                className="h-9 pl-9 text-sm"
              />
            </div>

            {buscandoCliente ? (
              <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Spinner className="h-3.5 w-3.5" /> Buscando…
              </p>
            ) : clientes.length > 0 ? (
              <ul className="max-h-44 overflow-y-auto rounded-lg border border-border" aria-label="Clientes encontrados">
                {clientes.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => escolherCliente(c)}
                      disabled={ocupado}
                      className={cn(
                        'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0',
                        'hover:bg-muted disabled:opacity-60',
                        clienteId === c.id && 'bg-muted',
                      )}
                    >
                      <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{c.nome}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.telefone || 'sem telefone no cadastro'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : buscouCliente && qCliente.trim().length >= 2 ? (
              <p className="px-1 text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
            ) : (
              <p className="px-1 text-xs text-muted-foreground">
                Digite ao menos 2 letras para buscar um cliente — ou informe o número abaixo.
              </p>
            )}

            <div className="space-y-1.5 border-t border-border pt-3">
              <label htmlFor="encaminhar-telefone" className="text-xs font-medium text-foreground">
                Número de WhatsApp
              </label>
              <div className="relative">
                <Phone
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="encaminhar-telefone"
                  value={telefone}
                  onChange={(e) => {
                    setTelefone(formatarCelularBR(e.target.value))
                    setClienteId(null) // digitou à mão: não é mais o cliente escolhido
                  }}
                  placeholder="(47) 99118-6787"
                  inputMode="tel"
                  aria-label="Número de WhatsApp do destino"
                  className="h-9 pl-9 text-sm"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Vai pelo número do escritório, mesmo que não exista conversa aberta com este contato.
                Anexo acima de {Math.round(LIMITE_ENCAMINHAR_NUMERO_BYTES / (1024 * 1024))} MB só
                pela aba &ldquo;Conversa&rdquo;.
              </p>
            </div>

            <Button
              type="button"
              size="sm"
              loading={enviandoNumero}
              onClick={() => void encaminharParaNumero()}
              disabled={!telefoneOk || ocupado}
              className="w-full"
            >
              {!enviandoNumero && <Forward className="h-4 w-4" aria-hidden />}
              {enviandoNumero ? 'Enviando…' : 'Encaminhar para este número'}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  )
}
