'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeftRight,
  CalendarPlus,
  Copy,
  ExternalLink,
  FolderOpen,
  Link2,
  MessageSquare,
  MessageSquarePlus,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { montarTextoAvisoParcela } from '@/lib/financeiro/aviso'
import { formatarValor } from '@/lib/financeiro/parcelas'
import type { Agente, ContextoConversa, Conversa } from '@/lib/conversas/tipos'
import { AvatarContato } from './AvatarContato'
import { codeDoErro, mensagemErroRelay } from './erros'
import { VincularCliente } from './VincularCliente'

/** "2026-07-01" | ISO -> "01/07/2026" (fallback: string original). */
function dataPtBr(data: string | null): string | null {
  if (!data) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : data
}

/** Hoje (yyyy-mm-dd) em America/Sao_Paulo — mesma régua do backend de avisos. */
function hojeSaoPauloISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

// ---------------------------------------------------------------------------
// Parcelas em aberto (módulo Financeiro) — contrato de
// GET /api/financeiro/parcelas-do-cliente?telefone=
// ---------------------------------------------------------------------------

interface ParcelaAberta {
  id: string
  descricao: string
  valor_centavos: number
  vencimento: string // yyyy-mm-dd
  vencida?: boolean
  /** Copia-e-cola pronto (null quando o escritório não configurou o Pix). */
  pix?: string | null
  /** Texto do aviso pronto para o composer (gerado no servidor). */
  textoAviso?: string | null
}

interface RespostaParcelasCliente {
  cliente: { id: string; nome: string } | null
  parcelas?: ParcelaAberta[]
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  )
}

/**
 * Coluna direita da tela de Conversas: contexto SIMAS do contato.
 * Busca sozinho GET /api/conversas/contexto?telefone= quando a conversa muda.
 * Com cliente casado: casos ativos, publicações recentes e ações rápidas
 * (agendar + transferir). Sem cliente: estado "não vinculado" + VincularCliente.
 */
export function PainelContexto({
  conversa,
  conectado,
  onAtribuido,
  onAgendar,
  onAgenteDesconectado,
  onInserirTexto,
}: {
  conversa: Conversa | null
  conectado: boolean
  onAtribuido: () => void
  onAgendar: (cliente: { id: string; nome: string } | null) => void
  /** Opcional: um 428 na transferência marca o agente como desconectado no shell. */
  onAgenteDesconectado?: () => void
  /** Opcional (plumbing do shell): preenche o composer da thread com um texto
   * pronto — o humano revisa e envia; nada sai automaticamente. */
  onInserirTexto?: (texto: string) => void
}) {
  const { success, error: toastError } = useToast()

  const telefone = conversa?.contato.telefone ?? null

  const [contexto, setContexto] = useState<ContextoConversa | null>(null)
  // Com telefone, o primeiro paint já é "Carregando…" (o fetch só dispara no
  // effect; sem isso, o estado "não vinculado" piscaria a cada troca de conversa).
  const [loading, setLoading] = useState(() => telefone !== null)
  const [erro, setErro] = useState<string | null>(null)

  // Transferir
  const [agentes, setAgentes] = useState<Agente[] | null>(null)
  const [loadingAgentes, setLoadingAgentes] = useState(false)
  const [transferindo, setTransferindo] = useState(false)

  // Parcelas em aberto (Financeiro) — best-effort: erro/rota ausente só oculta o card.
  const [parcelasResp, setParcelasResp] = useState<RespostaParcelasCliente | null>(null)

  const carregarContexto = useCallback(async () => {
    if (!telefone) {
      setContexto(null)
      setErro(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setErro(null)
    try {
      const r = await fetch(`/api/conversas/contexto?telefone=${encodeURIComponent(telefone)}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(mensagemErroRelay(r.status, d))
        setContexto(null)
        return
      }
      setContexto(d as ContextoConversa)
    } catch {
      setErro('Falha de rede ao carregar o contexto.')
      setContexto(null)
    } finally {
      setLoading(false)
    }
  }, [telefone])

  useEffect(() => {
    setContexto(null)
    void carregarContexto()
  }, [carregarContexto])

  // Parcelas em aberto do cliente casado — best-effort: qualquer erro
  // (inclusive rota do Financeiro ainda não publicada) só oculta o card.
  const clienteId = contexto?.cliente?.id ?? null
  useEffect(() => {
    setParcelasResp(null)
    if (!telefone || !clienteId) return
    let ativo = true
    void (async () => {
      try {
        const r = await fetch(
          `/api/financeiro/parcelas-do-cliente?telefone=${encodeURIComponent(telefone)}`,
        )
        if (!r.ok) return
        const d = (await r.json().catch(() => null)) as RespostaParcelasCliente | null
        if (ativo && d) setParcelasResp(d)
      } catch {
        /* card fica oculto */
      }
    })()
    return () => {
      ativo = false
    }
  }, [telefone, clienteId])

  async function copiarPix(p: ParcelaAberta) {
    const codigo = p.pix?.trim()
    if (!codigo) return
    try {
      await navigator.clipboard.writeText(codigo)
      success('Pix copiado', 'Copia-e-cola pronto para colar onde precisar.')
    } catch {
      toastError('Não foi possível copiar', 'Copie o código pela tela do Financeiro.')
    }
  }

  /** Preenche o composer com o texto da cobrança — o humano revisa e envia. */
  function inserirCobranca(p: ParcelaAberta) {
    const cli = contexto?.cliente
    if (!onInserirTexto || !cli) return
    // O servidor já manda o texto pronto; o fallback local cobre versões
    // antigas da rota (mesmo formato, sem o nome do escritório).
    const texto =
      p.textoAviso?.trim() ||
      montarTextoAvisoParcela({
        nomeCliente: cli.nome,
        descricao: p.descricao,
        valorCentavos: p.valor_centavos,
        vencimentoISO: p.vencimento,
        pixCopiaECola: p.pix ?? null,
        escritorioNome: null,
        ehHoje: p.vencimento === hojeSaoPauloISO(),
      })
    onInserirTexto(texto)
    success('Cobrança inserida no chat', 'Revise o texto antes de enviar.')
  }

  async function carregarAgentes() {
    if (agentes !== null || loadingAgentes) return
    setLoadingAgentes(true)
    try {
      const r = await fetch('/api/conversas/agentes')
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Agentes indisponíveis', mensagemErroRelay(r.status, d))
        return
      }
      const lista = (d as { agentes?: Agente[] }).agentes ?? (Array.isArray(d) ? (d as Agente[]) : [])
      setAgentes(lista)
    } catch {
      toastError('Agentes indisponíveis', 'Falha de rede ao listar os agentes.')
    } finally {
      setLoadingAgentes(false)
    }
  }

  async function transferir(agente: Agente) {
    if (!conversa || transferindo) return
    setTransferindo(true)
    try {
      const r = await fetch(`/api/conversas/${conversa.id}/atribuir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agente.id }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (r.status === 428 || codeDoErro(d) === 'AGENT_NOT_CONNECTED') {
          onAgenteDesconectado?.()
          toastError('Conecte sua conta', 'Conecte sua conta do Chatwoot para transferir.')
        } else {
          toastError('Não foi possível transferir', mensagemErroRelay(r.status, d))
        }
        return
      }
      success('Conversa transferida', `Transferida para ${agente.nome}.`)
      onAtribuido()
    } catch {
      toastError('Não foi possível transferir', 'Falha de rede. Tente novamente.')
    } finally {
      setTransferindo(false)
    }
  }

  // ── Estados vazios ─────────────────────────────────────────────────────────
  if (!conversa) {
    return (
      <aside className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
        <MessageSquare className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm text-muted-foreground">
          Selecione uma conversa para ver o contexto do cliente.
        </p>
      </aside>
    )
  }

  const nome = conversa.contato.nome || telefone || `Conversa #${conversa.id}`
  const cliente = contexto?.cliente ?? null
  // "Casos ativos" ao pé da letra: encerrados não entram na lista do painel.
  const processosAtivos = (contexto?.processos ?? []).filter((p) => p.situacao !== 'encerrado')
  // Parcelas abertas (a rota já filtra e ordena por vencimento; até 3 no card).
  const hojeISO = hojeSaoPauloISO()
  const parcelasAbertas = parcelasResp?.parcelas ?? []

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-6">
        {/* Identidade do contato */}
        <div className="flex flex-col items-center text-center">
          <AvatarContato nome={nome} avatarUrl={conversa.contato.avatarUrl} className="h-16 w-16 text-xl" />
          <h3 className="mt-3 max-w-full truncate font-semibold text-foreground">{nome}</h3>
          {telefone && <p className="mt-0.5 text-xs text-muted-foreground">{telefone}</p>}
          {cliente && (
            <Link
              href={`/clientes/${cliente.id}`}
              className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-primary hover:underline"
              title="Abrir a ficha do cliente"
            >
              Cliente: {cliente.nome}
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </Link>
          )}
        </div>

        {/* Corpo: loading / erro / sem telefone / vinculado / não vinculado */}
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Carregando contexto…
          </p>
        ) : erro ? (
          <div className="space-y-2 text-center">
            <p className="text-sm text-muted-foreground">{erro}</p>
            <Button variant="ghost" size="sm" onClick={() => carregarContexto()}>
              <RefreshCw className="h-4 w-4" /> Tentar de novo
            </Button>
          </div>
        ) : !telefone ? (
          <p className="text-center text-sm text-muted-foreground">
            Este contato não tem telefone — não é possível vincular a um cliente do SIMAS.
          </p>
        ) : cliente ? (
          <>
            {/* CASOS ATIVOS — o rótulo é literal: processos encerrados ficam de fora
                da lista (as publicações do contexto continuam cobrindo todos). */}
            <section className="space-y-2">
              <Eyebrow>
                Casos ativos{processosAtivos.length > 0 ? ` · ${processosAtivos.length}` : ''}
              </Eyebrow>
              {processosAtivos.length > 0 ? (
                <ul className="space-y-2">
                  {processosAtivos.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/clientes/${cliente.id}`}
                        className={cn(
                          'block rounded-lg border border-border bg-background px-3 py-2 transition-colors',
                          'hover:border-ring hover:bg-muted/50',
                        )}
                      >
                        <span className="flex items-start gap-2">
                          <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">
                              {p.titulo || 'Processo'}
                            </span>
                            {p.numeroMascara && (
                              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                                {p.numeroMascara}
                              </span>
                            )}
                            {p.situacao && (
                              <span className="block truncate text-xs text-muted-foreground">{p.situacao}</span>
                            )}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Nenhum processo cadastrado.</p>
              )}
            </section>

            {/* PUBLICAÇÕES RECENTES */}
            <section className="space-y-2">
              <Eyebrow>Publicações recentes</Eyebrow>
              {contexto && contexto.publicacoes.length > 0 ? (
                <ul className="space-y-3">
                  {contexto.publicacoes.slice(0, 3).map((pub) => (
                    <li key={pub.id}>
                      <Link
                        href={`/publicacoes?pub=${pub.id}`}
                        className="block border-l-2 border-primary/50 pl-3 transition-colors hover:border-primary hover:bg-muted/40"
                        title="Abrir na caixa de Publicações"
                      >
                        <p className="break-words text-sm italic text-foreground">“{pub.trecho}”</p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {[pub.tribunal, dataPtBr(pub.data)].filter(Boolean).join(' · ')}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Sem publicações recentes.</p>
              )}
            </section>

            {/* CASOS (atendimentos — inclui importados do Astrea sem CNJ) */}
            {contexto && contexto.casos.length > 0 && (
              <section className="space-y-2">
                <Eyebrow>Casos</Eyebrow>
                <ul className="space-y-2">
                  {contexto.casos.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/clientes/${cliente.id}/casos/${c.id}`}
                        className="block rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:border-ring hover:bg-muted/50"
                      >
                        <span className="block truncate text-sm font-medium text-foreground">
                          {c.titulo || `Caso de ${c.area || 'atendimento'}`}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[c.area, c.status].filter(Boolean).join(' · ')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* PARCELAS EM ABERTO (Financeiro) — só aparece quando há parcela
                aberta. "Inserir cobrança" preenche o composer: humano revisa
                e envia; nada sai automático. */}
            {parcelasAbertas.length > 0 && (
              <section className="space-y-2">
                <Eyebrow>Parcelas em aberto · {parcelasAbertas.length}</Eyebrow>
                <ul className="space-y-2">
                  {parcelasAbertas.slice(0, 3).map((p) => {
                    const vencida = p.vencida ?? p.vencimento < hojeISO
                    const temPix = !!p.pix?.trim()
                    return (
                      <li key={p.id} className="rounded-lg border border-border bg-background px-3 py-2">
                        <p className="truncate text-sm font-medium text-foreground" title={p.descricao}>
                          {p.descricao}
                        </p>
                        <p className="mt-0.5 text-xs">
                          <span className="font-semibold text-foreground">
                            {formatarValor(p.valor_centavos)}
                          </span>{' '}
                          <span className={cn(vencida ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                            · {vencida ? 'venceu' : 'vence'} {dataPtBr(p.vencimento)}
                          </span>
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {onInserirTexto && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-7 flex-1 whitespace-normal px-2 text-xs"
                              onClick={() => inserirCobranca(p)}
                              title="Preencher o composer com o texto da cobrança (você revisa e envia)"
                            >
                              <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" />
                              Inserir cobrança no chat
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 border border-border"
                            disabled={!temPix}
                            onClick={() => void copiarPix(p)}
                            title={
                              temPix
                                ? 'Copiar o Pix copia-e-cola desta parcela'
                                : 'Configure a chave Pix em Configurações'
                            }
                            aria-label="Copiar Pix copia-e-cola"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {/* AÇÕES RÁPIDAS */}
            <section className="space-y-2">
              <Eyebrow>Ações rápidas</Eyebrow>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-auto min-h-9 whitespace-normal py-2"
                  onClick={() => onAgendar(cliente)}
                >
                  <CalendarPlus className="h-4 w-4 shrink-0" /> Agendar na agenda
                </Button>

                <DropdownMenu
                  onOpenChange={(aberto) => {
                    if (aberto) void carregarAgentes()
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-auto min-h-9 whitespace-normal py-2"
                      disabled={!conectado || transferindo}
                      title={conectado ? 'Transferir a conversa para outro agente' : 'Conecte sua conta para transferir'}
                    >
                      {transferindo ? (
                        <Spinner className="h-4 w-4 shrink-0" />
                      ) : (
                        <ArrowLeftRight className="h-4 w-4 shrink-0" />
                      )}{' '}
                      Transferir
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                    {loadingAgentes ? (
                      <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                        <Spinner className="h-3.5 w-3.5" /> Carregando…
                      </div>
                    ) : agentes && agentes.length > 0 ? (
                      agentes.map((a) => (
                        <DropdownMenuItem key={a.id} onSelect={() => void transferir(a)}>
                          <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                          {!a.conectado && (
                            <span className="shrink-0 text-[11px] text-muted-foreground">não conectado</span>
                          )}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">Nenhum agente disponível.</div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </section>
          </>
        ) : (
          <section className="space-y-3">
            <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-center">
              <Link2 className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm font-medium text-foreground">Contato não vinculado ao SIMAS</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Vincule este telefone a um cliente para ver casos e publicações aqui.
              </p>
            </div>
            <Eyebrow>Vincular cliente</Eyebrow>
            <VincularCliente telefone={telefone} onVinculado={() => void carregarContexto()} />
          </section>
        )}
      </div>
    </aside>
  )
}
