'use client'

import { useEffect, useRef, useState } from 'react'
import { FolderPlus, Search, UserRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { mensagemErroRelay } from './erros'

interface ClienteSel {
  id: string
  nome: string
}

interface CasoItem {
  id: string
  titulo: string | null
  area: string | null
}

/**
 * Salva um anexo da conversa (imagem/pdf/doc — áudio fica de fora) no dossiê do
 * CLIENTE, opcionalmente vinculado a um caso. Ao abrir, resolve o cliente casado
 * pelo telefone (GET /api/conversas/contexto — mesma lógica do PainelContexto);
 * sem match, oferece a busca de cliente (GET /api/conversas/clientes). Os casos
 * do cliente vêm da fonte mais simples já existente (GET /api/atendimentos?
 * cliente_id=). Confirmar → POST /api/conversas/<id>/salvar-anexo.
 */
export function SalvarNoClienteModal({
  aberto,
  conversaId,
  anexoUrl,
  telefone,
  nomeSugerido,
  onFechar,
  onSalvo,
}: {
  aberto: boolean
  conversaId: number
  anexoUrl: string
  /** Telefone do contato — casa o cliente da conversa (pré-seleção). */
  telefone?: string | null
  /** Nome default do arquivo (o do anexo); editável no modal. */
  nomeSugerido?: string
  onFechar: () => void
  /** Sucesso: o componente pai marca o anexo como salvo (desabilita o botão). */
  onSalvo?: () => void
}) {
  const { success, error: toastError } = useToast()

  const [resolvendo, setResolvendo] = useState(false)
  const [cliente, setCliente] = useState<ClienteSel | null>(null)
  const [nome, setNome] = useState(nomeSugerido ?? '')
  const [salvando, setSalvando] = useState(false)

  // Casos do cliente selecionado (dropdown opcional).
  const [casos, setCasos] = useState<CasoItem[] | null>(null)
  const [atendimentoId, setAtendimentoId] = useState('')

  // Busca de cliente (conversa sem cadastro, ou ao "trocar" o pré-selecionado).
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ClienteSel[]>([])
  const [buscando, setBuscando] = useState(false)
  const buscaSeq = useRef(0)

  // Reset + resolução do cliente casado ao abrir.
  useEffect(() => {
    if (!aberto) return
    setCliente(null)
    setCasos(null)
    setAtendimentoId('')
    setNome(nomeSugerido ?? '')
    setQ('')
    setResultados([])
    setSalvando(false)

    const tel = telefone?.trim()
    if (!tel) {
      setResolvendo(false)
      return
    }
    setResolvendo(true)
    let ativo = true
    void (async () => {
      try {
        const r = await fetch(`/api/conversas/contexto?telefone=${encodeURIComponent(tel)}`)
        const d = await r.json().catch(() => ({}))
        if (!ativo) return
        const c = (d as { cliente?: ClienteSel | null }).cliente ?? null
        if (r.ok && c) setCliente(c)
      } catch {
        /* sem match → cai na busca de cliente */
      } finally {
        if (ativo) setResolvendo(false)
      }
    })()
    return () => {
      ativo = false
    }
  }, [aberto, telefone, nomeSugerido])

  // Casos do cliente selecionado (fonte simples já existente).
  useEffect(() => {
    if (!cliente) {
      setCasos(null)
      return
    }
    setAtendimentoId('')
    setCasos(null)
    let ativo = true
    void (async () => {
      try {
        const r = await fetch(`/api/atendimentos?cliente_id=${encodeURIComponent(cliente.id)}`)
        const d = await r.json().catch(() => ({}))
        if (!ativo) return
        const lista = (d as { atendimentos?: CasoItem[] }).atendimentos
        setCasos(Array.isArray(lista) ? lista : [])
      } catch {
        if (ativo) setCasos([])
      }
    })()
    return () => {
      ativo = false
    }
  }, [cliente])

  // Busca de cliente (debounce 300ms, a partir de 2 letras) — só sem seleção.
  useEffect(() => {
    if (cliente) return
    const termo = q.trim()
    if (termo.length < 2) {
      setResultados([])
      setBuscando(false)
      return
    }
    setBuscando(true)
    const seq = ++buscaSeq.current
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/conversas/clientes?q=${encodeURIComponent(termo)}`)
        const d = await r.json().catch(() => ({}))
        if (seq !== buscaSeq.current) return
        const lista = (d as { clientes?: ClienteSel[] }).clientes
        setResultados(Array.isArray(lista) ? lista : [])
      } catch {
        if (seq === buscaSeq.current) setResultados([])
      } finally {
        if (seq === buscaSeq.current) setBuscando(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [q, cliente])

  async function salvar() {
    if (!cliente || salvando) return
    setSalvando(true)
    try {
      const r = await fetch(`/api/conversas/${conversaId}/salvar-anexo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anexoUrl,
          fileName: nome.trim() || undefined,
          clienteId: cliente.id,
          atendimentoId: atendimentoId || undefined,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não salvo', mensagemErroRelay(r.status, d))
        return
      }
      success('Documento salvo', 'Disponível no dossiê do cliente.')
      onSalvo?.()
      onFechar()
    } catch {
      toastError('Não salvo', 'Falha de rede. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  const casoOptions = [
    { value: '', label: 'Sem caso (só no dossiê do cliente)' },
    ...(casos ?? []).map((c) => ({
      value: c.id,
      label: c.titulo || `Caso de ${c.area || 'atendimento'}`,
    })),
  ]

  return (
    <Dialog
      open={aberto}
      onClose={onFechar}
      title="Salvar no cliente"
      description="Guarda este anexo no dossiê do cliente (e, se quiser, em um caso)."
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            variant="default"
            size="md"
            onClick={salvar}
            loading={salvando}
            disabled={!cliente}
            title={cliente ? 'Salvar no dossiê do cliente' : 'Escolha um cliente primeiro'}
          >
            {!salvando && <FolderPlus className="h-4 w-4" />} Salvar
          </Button>
        </>
      }
    >
      {resolvendo ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Buscando o cliente da conversa…
        </div>
      ) : (
        <div className="space-y-4">
          {/* CLIENTE — pré-selecionado (casado pelo telefone) ou busca */}
          {cliente ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Cliente
                </span>
                <span className="block truncate text-sm font-medium text-foreground">{cliente.nome}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setCliente(null)
                  setQ('')
                }}
                className="shrink-0 text-xs font-medium text-primary hover:underline"
              >
                Trocar
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Escolha o cliente
              </p>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar cliente por nome…"
                  aria-label="Buscar cliente por nome"
                  autoFocus
                  className="h-9 pl-9 text-sm"
                />
              </div>
              {buscando ? (
                <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5" /> Buscando…
                </p>
              ) : resultados.length > 0 ? (
                <ul className="max-h-52 overflow-y-auto rounded-lg border border-border" aria-label="Clientes encontrados">
                  {resultados.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setCliente({ id: c.id, nome: c.nome })
                          setResultados([])
                          setQ('')
                        }}
                        className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted"
                      >
                        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{c.nome}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : q.trim().length >= 2 ? (
                <p className="px-1 text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
              ) : (
                <p className="px-1 text-xs text-muted-foreground">Digite ao menos 2 letras para buscar.</p>
              )}
            </div>
          )}

          {/* NOME DO ARQUIVO (editável) */}
          <div className="space-y-1">
            <label
              htmlFor="salvar-nome-arquivo"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Nome do arquivo
            </label>
            <Input
              id="salvar-nome-arquivo"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome do documento"
              className="h-9 text-sm"
            />
          </div>

          {/* CASO (opcional) — só com cliente selecionado */}
          {cliente && (
            <div className="space-y-1">
              <label
                htmlFor="salvar-caso"
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Vincular a um caso (opcional)
              </label>
              {casos === null ? (
                <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5" /> Carregando casos…
                </p>
              ) : casos.length > 0 ? (
                <Select
                  id="salvar-caso"
                  value={atendimentoId}
                  onChange={(e) => setAtendimentoId(e.target.value)}
                  options={casoOptions}
                  className="h-9"
                />
              ) : (
                <p className="px-1 text-xs text-muted-foreground">
                  Este cliente não tem casos — vai só para o dossiê.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
