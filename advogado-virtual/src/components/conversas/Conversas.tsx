'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, MessageSquare, RefreshCw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { NOTIF_PREF_KEY, notificacoesLigadas } from './NotificadorConversas'
import type { AgenteMe, Conversa, RespostaLista, StatusConversa } from '@/lib/conversas/tipos'
import {
  dedupPorId,
  mesclarPaginas,
  mesmaLista,
  temMaisPorContagem,
} from '@/lib/conversas/lista-infinita'
import { apenasDigitos } from '@/lib/conversas/telefone'
import { transferidaPeloBot } from '@/lib/conversas/handoff'
import type { Pessoa } from '@/lib/agenda/tipos'
import { EventoModal } from '@/components/agenda/EventoModal'
import { ConexaoAgente } from './ConexaoAgente'
import { ListaConversas } from './ListaConversas'
import { PainelContexto } from './PainelContexto'
import { Thread } from './Thread'
import { mensagemErroRelay } from './erros'

type FiltroChip = 'todos' | 'transferidas' | 'aguardando' | 'nao_atribuidas' | 'resolvidas'

export function Conversas({ email }: { email: string }) {
  void email // e-mail (auth) é injetado server-side no header X-Simas-User-Email; aqui é só informativo.

  // Filtros: chips (client-side, exceto "resolvidas" que troca o status da query)
  const [filtroChip, setFiltroChip] = useState<FiltroChip>('todos')
  // Canal (inbox): '' = todas. Quem tem acesso a uma caixa só (escopo do relay)
  // simplesmente não vê diferença; quem vê as duas (ex.: administradora) escolhe.
  const [canal, setCanal] = useState<'' | 'DF' | 'SC'>('')
  const [notifOn, setNotifOn] = useState(true)
  useEffect(() => { setNotifOn(notificacoesLigadas()) }, [])
  function alternarNotif() {
    const novo = !notifOn
    setNotifOn(novo)
    try { localStorage.setItem(NOTIF_PREF_KEY, novo ? 'on' : 'off') } catch { /* ignore */ }
  }
  const [status, setStatus] = useState<StatusConversa>('open')
  const [busca, setBusca] = useState('')

  // Lista (scroll infinito): acumula por página, deduplica por id.
  const [conversas, setConversas] = useState<Conversa[]>([])
  const [paginaMax, setPaginaMax] = useState(1) // maior página já carregada
  const [temMais, setTemMais] = useState(true) // detectado por CONTAGEM (< 25 = fim)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [loading, setLoading] = useState(true) // só carga inicial / reset de query
  const [atualizando, setAtualizando] = useState(false) // giro do botão "Atualizar"
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [selecionadaId, setSelecionadaId] = useState<number | null>(null)

  // Container rolável + sentinela do fim (IntersectionObserver dispara o "mais").
  const listaRef = useRef<HTMLDivElement>(null)
  const sentinelaRef = useRef<HTMLDivElement>(null)
  // Espelhos p/ o polling ler sem virar dependência (não reinicia o timer de 10s).
  const conversasRef = useRef<Conversa[]>([])
  const paginaMaxRef = useRef(1)
  const carregandoMaisRef = useRef(false)
  // Geração da query: incrementa a cada reset (status/canal) p/ descartar respostas
  // de página em voo quando o filtro muda no meio.
  const geracaoRef = useRef(0)
  // Quando o polling reconstrói a lista, guardamos o scroll p/ restaurar sem salto.
  const scrollRestaurarRef = useRef<{ topo: number; altura: number } | null>(null)
  useEffect(() => { conversasRef.current = conversas }, [conversas])
  useEffect(() => { paginaMaxRef.current = paginaMax }, [paginaMax])
  useEffect(() => { carregandoMaisRef.current = carregandoMais }, [carregandoMais])

  // Layout responsivo (um único painel de detalhe/contexto montado por vez)
  const [desktop, setDesktop] = useState(true) // lg: thread inline
  const [xlUp, setXlUp] = useState(true) // xl: coluna de contexto fixa
  const [mobileAberto, setMobileAberto] = useState(false)
  const [contextoAberto, setContextoAberto] = useState(false)

  // Conexão do agente
  const [agente, setAgente] = useState<AgenteMe | null>(null)
  const [loadingAgente, setLoadingAgente] = useState(true)

  // Agendar na agenda (EventoModal da /agenda com cliente pré-vinculado)
  const [agendaAberta, setAgendaAberta] = useState(false)
  const [agendaCliente, setAgendaCliente] = useState<{ id: string; nome: string } | null>(null)
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null) // null = ainda não buscadas

  const buscaRef = useRef<HTMLInputElement>(null)

  // Plumbing PainelContexto → composer da Thread ("Inserir cobrança no chat"):
  // a Thread montada registra aqui a função que preenche o composer.
  const inserirTextoRef = useRef<((texto: string) => void) | null>(null)
  const registrarInserirTexto = useCallback((fn: ((texto: string) => void) | null) => {
    inserirTextoRef.current = fn
  }, [])
  const inserirNoComposer = useCallback((texto: string) => {
    inserirTextoRef.current?.(texto)
    // Fecha o overlay de contexto (< xl) para o composer ficar visível.
    setContextoAberto(false)
  }, [])

  // Tick de 60s para os selos "AGUARDANDO X" envelhecerem com a tela aberta
  // (recomputa os rótulos client-side, sem refetch).
  const [agoraEpochSeg, setAgoraEpochSeg] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setAgoraEpochSeg(Math.floor(Date.now() / 1000)), 60_000)
    return () => clearInterval(t)
  }, [])

  // Rastreia os breakpoints lg (1024px) e xl (1280px).
  useEffect(() => {
    const lg = window.matchMedia('(min-width: 1024px)')
    const xl = window.matchMedia('(min-width: 1280px)')
    const upd = () => {
      setDesktop(lg.matches)
      setXlUp(xl.matches)
    }
    upd()
    lg.addEventListener('change', upd)
    xl.addEventListener('change', upd)
    return () => {
      lg.removeEventListener('change', upd)
      xl.removeEventListener('change', upd)
    }
  }, [])

  // ⌘K / Ctrl+K foca a busca.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        buscaRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Busca UMA página do relay. Só rede — não toca em estado (composável).
  const buscarPagina = useCallback(
    async (
      pagina: number,
    ): Promise<{ ok: true; conversas: Conversa[] } | { ok: false; erro: string }> => {
      try {
        const params = new URLSearchParams()
        params.set('status', status)
        params.set('page', String(pagina))
        if (canal) params.set('inbox', canal)
        const r = await fetch(`/api/conversas?${params.toString()}`)
        const d = await r.json().catch(() => ({}))
        if (!r.ok) return { ok: false, erro: mensagemErroRelay(r.status, d) }
        return { ok: true, conversas: (d as RespostaLista).conversas ?? [] }
      } catch {
        return { ok: false, erro: 'Falha de rede ao carregar as conversas.' }
      }
    },
    [status, canal],
  )

  // Próxima página (scroll infinito): APPEND + dedup, fim detectado por contagem.
  // Lê guardas via ref p/ manter identidade estável entre as flips do carregamento.
  const carregarMais = useCallback(async () => {
    if (carregandoMaisRef.current || loading || !temMais) return
    if (busca.trim()) return // busca é filtro sobre o carregado; não varre o servidor
    carregandoMaisRef.current = true
    setCarregandoMais(true)
    const geracao = geracaoRef.current
    const prox = paginaMaxRef.current + 1
    const res = await buscarPagina(prox)
    if (geracaoRef.current === geracao && res.ok) {
      // Descarta se a query mudou no meio (reset trocou a geração).
      setConversas((atual) => dedupPorId([...atual, ...res.conversas]))
      setPaginaMax(prox)
      // Espelho SÍNCRONO: um polling em voo (que capturou `total` antes) enxerga
      // o append na hora e desiste de reconstruir com menos páginas (não perde a cauda).
      paginaMaxRef.current = prox
      setTemMais(temMaisPorContagem(res.conversas.length))
    }
    // Erro no append: mantém o já carregado; tenta de novo no próximo gatilho.
    carregandoMaisRef.current = false
    setCarregandoMais(false)
  }, [buscarPagina, loading, temMais, busca])

  // Revalidação (polling de 10s e botão "Atualizar"): re-busca as páginas
  // 1..paginaMax EM PARALELO e reconstrói a lista por concat+dedup (ordem do
  // servidor). Escolhi esta estratégia p/ cumprir as 4 invariantes do tick
  // silencioso: (1) não perde a CAUDA — revisita todas as páginas já abertas;
  // (2) só faz setState se `mesmaLista` acusar mudança (nada de clear+set → não
  // pisca); (3) preserva o scrollTop (capturado aqui, restaurado no
  // useLayoutEffect) → não rouba a leitura; (4) reflete campos novos (última
  // msg, aguardando, labels, naoLidas) nos itens já visíveis. Pula se um
  // "carregar mais" estiver em voo, p/ não competir com o append.
  const revalidar = useCallback(
    async (silencioso: boolean) => {
      if (carregandoMaisRef.current) return
      if (!silencioso) setAtualizando(true)
      const geracao = geracaoRef.current
      const total = paginaMaxRef.current
      const paginas = await Promise.all(
        Array.from({ length: total }, (_, i) => buscarPagina(i + 1)),
      )
      // Se `paginaMax` cresceu durante o await, um "carregar mais" anexou uma
      // página no meio-tempo: reconstruir com as `total` páginas antigas dropava
      // essa cauda (e pularia a página no próximo append). O append já é a verdade.
      if (
        geracaoRef.current === geracao &&
        paginaMaxRef.current === total &&
        paginas.every((p) => p.ok)
      ) {
        const nova = mesclarPaginas(paginas.map((p) => (p.ok ? p.conversas : [])))
        if (!mesmaLista(nova, conversasRef.current)) {
          const el = listaRef.current
          if (el) scrollRestaurarRef.current = { topo: el.scrollTop, altura: el.scrollHeight }
          setConversas(nova)
          const ultima = paginas[paginas.length - 1]
          if (ultima?.ok) setTemMais(temMaisPorContagem(ultima.conversas.length))
        }
      }
      if (!silencioso) setAtualizando(false)
    },
    [buscarPagina],
  )

  const carregarAgente = useCallback(async () => {
    setLoadingAgente(true)
    try {
      const r = await fetch('/api/conversas/agente')
      const d = await r.json().catch(() => ({ conectado: false }))
      setAgente(r.ok ? (d as AgenteMe) : { conectado: false })
    } catch {
      setAgente({ conectado: false })
    } finally {
      setLoadingAgente(false)
    }
  }, [])

  // Reset da QUERY (status/canal): zera o acumulado, volta pro topo e recarrega
  // a página 1. A BUSCA NÃO entra aqui — é filtro cliente sobre o acumulado (ver
  // `visiveis`), não mexe na query. `buscarPagina` troca de identidade quando
  // status/canal mudam, então este efeito re-roda exatamente nesses casos.
  useEffect(() => {
    let cancelado = false
    const geracao = ++geracaoRef.current
    setLoading(true)
    setErroLista(null)
    setTemMais(true)
    setCarregandoMais(false)
    carregandoMaisRef.current = false // um append da query ANTIGA não deve travar a nova
    setPaginaMax(1)
    paginaMaxRef.current = 1 // mantém o espelho verdadeiro já neste tick (antes do efeito)
    listaRef.current?.scrollTo({ top: 0 })
    void (async () => {
      const res = await buscarPagina(1)
      if (cancelado || geracaoRef.current !== geracao) return
      if (!res.ok) {
        setConversas([])
        setErroLista(res.erro)
        setTemMais(false) // query quebrada: não tenta paginar
      } else {
        setConversas(res.conversas)
        setTemMais(temMaisPorContagem(res.conversas.length))
      }
      setLoading(false)
    })()
    return () => { cancelado = true }
  }, [buscarPagina])

  // Scroll infinito: observa a sentinela ~300px antes do fim e puxa a próxima
  // página. Só observa quando há mais e não há busca ativa. Re-inscreve quando
  // `carregarMais`/`paginaMax` mudam (após cada página) p/ reavaliar e "encher" a
  // viewport se o conteúdo carregado ainda não a preencheu.
  useEffect(() => {
    const root = listaRef.current
    const alvo = sentinelaRef.current
    if (!root || !alvo || !temMais || busca.trim()) return
    const io = new IntersectionObserver(
      (entradas) => { if (entradas.some((e) => e.isIntersecting)) void carregarMais() },
      { root, rootMargin: '0px 0px 300px 0px' },
    )
    io.observe(alvo)
    return () => io.disconnect()
  }, [carregarMais, temMais, busca, paginaMax])

  // Restaura o scroll após uma reconstrução do polling (não em append/seleção,
  // onde `scrollRestaurarRef` fica null). Quando o usuário está lendo (rolado),
  // re-ancora somando o que cresceu ACIMA (item novo no topo) p/ manter a
  // posição; no topo (topo≈0), deixa o item novo aparecer.
  useLayoutEffect(() => {
    const alvo = scrollRestaurarRef.current
    scrollRestaurarRef.current = null
    const el = listaRef.current
    if (!alvo || !el) return
    if (alvo.topo > 2) el.scrollTop = alvo.topo + (el.scrollHeight - alvo.altura)
  }, [conversas])

  // Deep-link do toast de notificação: /conversas?conversa=<id> abre a conversa.
  const deepLinkRef = useRef<number | null>(null)
  useEffect(() => {
    const m = /[?&]conversa=(\d+)/.exec(window.location.search)
    if (m) deepLinkRef.current = Number(m[1])
  }, [])
  useEffect(() => {
    if (deepLinkRef.current == null || conversas.length === 0) return
    const alvo = conversas.find((c) => c.id === deepLinkRef.current)
    if (alvo) {
      setSelecionadaId(alvo.id)
      deepLinkRef.current = null
    }
  }, [conversas])

  // Atualização automática (pedido do dono, 2026-07-10): a lista se revalida em
  // silêncio a cada 10s com a aba visível, e imediatamente quando a aba volta ao
  // foco. Sem piscar (silencioso) e sem custo com a aba em segundo plano.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void revalidar(true)
    }
    const id = setInterval(tick, 10_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [revalidar])

  useEffect(() => {
    void carregarAgente()
  }, [carregarAgente])

  function mudarChip(chip: FiltroChip) {
    setFiltroChip(chip)
    const novoStatus: StatusConversa = chip === 'resolvidas' ? 'resolved' : 'open'
    if (novoStatus !== status) {
      // "Resolvidas" (e a volta) troca o status da QUERY → reset via efeito.
      setStatus(novoStatus)
      setSelecionadaId(null)
    }
  }

  function selecionar(id: number) {
    setSelecionadaId(id)
    setMobileAberto(true)
  }

  /** Um envio/ação retornou 428 → agente não está conectado. */
  function marcarDesconectado() {
    setAgente({ conectado: false })
  }

  async function abrirAgenda(cliente: { id: string; nome: string } | null) {
    setAgendaCliente(cliente)
    setAgendaAberta(true)
    // Pessoas do tenant só quando o modal abre pela primeira vez.
    if (pessoas === null) {
      try {
        const r = await fetch('/api/agenda/pessoas')
        const d = await r.json().catch(() => ({}))
        setPessoas(r.ok ? ((d as { pessoas?: Pessoa[] }).pessoas ?? []) : [])
      } catch {
        setPessoas([])
      }
    }
  }

  const selecionada = conversas.find((c) => c.id === selecionadaId) ?? null
  const conectado = agente?.conectado === true

  // Busca client-side por nome / telefone (dígitos) / trecho da última mensagem.
  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return conversas
    const dig = apenasDigitos(t)
    return conversas.filter((c) => {
      const nome = (c.contato.nome ?? '').toLowerCase()
      const trecho = (c.ultimaMensagem?.trecho ?? '').toLowerCase()
      const tel = apenasDigitos(c.contato.telefone)
      return nome.includes(t) || trecho.includes(t) || (dig.length > 0 && tel.includes(dig))
    })
  }, [conversas, busca])

  // Contagens dos chips — sobre TODO o acumulado (pós-busca), não só uma página.
  const nTodos = visiveis.length
  const nTransferidas = visiveis.filter((c) => transferidaPeloBot(c)).length
  const nAguardando = visiveis.filter((c) => c.aguardandoDesde !== null).length
  const nNaoAtribuidas = visiveis.filter((c) => !c.assignee).length

  const chips: { value: FiltroChip; label: string; n: number | null }[] = [
    { value: 'todos', label: 'Todos', n: nTodos },
    { value: 'transferidas', label: 'Transferidas', n: nTransferidas },
    { value: 'aguardando', label: 'Aguardando', n: nAguardando },
    { value: 'nao_atribuidas', label: 'Não atribuídas', n: nNaoAtribuidas },
    { value: 'resolvidas', label: 'Resolvidas', n: null },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 lg:p-6">
      {/* Banner/estado de conexão da conta (fluxo 428 preservado) */}
      <ConexaoAgente agente={agente} loading={loadingAgente} onMudou={carregarAgente} />

      {/* 3 colunas full-height: LISTA | THREAD | CONTEXTO (xl+) */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* COLUNA 1 — LISTA (~330px) */}
        <section className="flex w-full min-w-0 flex-col lg:w-[330px] lg:shrink-0">
          {/* Cabeçalho: título + contador, subtítulo, busca ⌘K, chips */}
          <div className="shrink-0 space-y-3 pb-3">
            <div className="max-lg:pl-12">
              <div className="flex items-center gap-2">
                <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-foreground font-heading">
                  Conversas
                </h1>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void revalidar(false)}
                  title="Atualizar lista"
                  aria-label="Atualizar lista"
                  className="h-7 w-7"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', (loading || atualizando) && 'animate-spin')} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={alternarNotif}
                  title={notifOn ? 'Notificações de mensagens novas: LIGADAS (clique para desligar)' : 'Notificações de mensagens novas: DESLIGADAS (clique para ligar)'}
                  aria-label={notifOn ? 'Desligar notificações' : 'Ligar notificações'}
                  aria-pressed={notifOn}
                  className="h-7 w-7"
                >
                  {notifOn ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5 text-muted-foreground" />}
                </Button>
                <span className="inline-flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
                  {loading && conversas.length === 0 ? '…' : nTodos}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                Atendimento omnichannel · WhatsApp DF/SC
              </p>
            </div>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                ref={buscaRef}
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar cliente, telefone..."
                aria-label="Buscar conversa por nome, telefone ou trecho"
                className="h-9 w-full rounded-full border border-input bg-background pl-9 pr-12 text-sm text-foreground placeholder:text-muted-foreground transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <kbd
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                aria-hidden
              >
                ⌘K
              </kbd>
            </div>

            {/* Canal: Todas · DF · SC (o relay filtra na origem; agentes com uma
                caixa só continuam vendo só a sua, qualquer que seja a escolha). */}
            <div className="flex items-center gap-1.5" role="group" aria-label="Canal">
              {([['', 'Todas'], ['DF', 'DF'], ['SC', 'SC']] as const).map(([v, rotulo]) => (
                <button
                  key={rotulo}
                  type="button"
                  onClick={() => { setCanal(v); setSelecionadaId(null) }}
                  aria-pressed={canal === v}
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    canal === v
                      ? 'bg-foreground text-background'
                      : 'border border-border bg-card text-muted-foreground hover:border-ring hover:text-foreground',
                  )}
                >
                  {rotulo}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtro de conversas">
              {chips.map((chip) => {
                const ativo = filtroChip === chip.value
                return (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => mudarChip(chip.value)}
                    aria-pressed={ativo}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                      ativo
                        ? 'bg-foreground text-background'
                        : 'border border-border bg-card text-muted-foreground hover:border-ring hover:text-foreground',
                    )}
                  >
                    {chip.label}
                    {chip.n !== null && (
                      <span className={cn('font-semibold', ativo ? 'text-background/70' : 'text-foreground/70')}>
                        {chip.n}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Lista rolável (scroll infinito). O container é o root do observer;
              a sentinela no fim dispara o carregamento da próxima página. */}
          <div ref={listaRef} className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            <ListaConversas
              conversas={visiveis}
              loading={loading}
              erro={erroLista}
              selecionadaId={selecionadaId}
              onSelecionar={selecionar}
              filtroChip={filtroChip}
              agoraEpochSeg={agoraEpochSeg}
            />

            {/* Sentinela + rodapé do scroll infinito. Só relevante sem busca
                ativa (busca é filtro cliente sobre o já carregado). */}
            {!busca.trim() && conversas.length > 0 && (
              <>
                <div ref={sentinelaRef} aria-hidden className="h-px w-full" />
                {carregandoMais ? (
                  <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
                    <Spinner className="h-3.5 w-3.5" /> Carregando mais…
                  </div>
                ) : !temMais ? (
                  <p className="py-3 text-center text-xs text-muted-foreground/60" aria-hidden>
                    •
                  </p>
                ) : null}
              </>
            )}
          </div>
        </section>

        {/* COLUNA 2 — THREAD (inline no desktop) */}
        <div className="hidden min-w-0 flex-1 lg:block">
          {selecionada && desktop ? (
            <Thread
              key={selecionada.id}
              conversa={selecionada}
              conectado={conectado}
              modo="inline"
              onListaMudou={() => void revalidar(true)}
              onAgenteDesconectado={marcarDesconectado}
              onAbrirContexto={() => setContextoAberto(true)}
              registrarInserirTexto={registrarInserirTexto}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
              <MessageSquare className="h-9 w-9 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-sm font-medium text-foreground">Selecione uma conversa</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Escolha uma conversa à esquerda para ler o histórico e responder sem sair da tela.
              </p>
            </div>
          )}
        </div>

        {/* COLUNA 3 — CONTEXTO (~300px, só xl+; abaixo vira overlay).
            A guarda CSS (hidden xl:block) evita a coluna no primeiro paint do
            mobile (SSR/pré-hydration, antes do matchMedia corrigir xlUp);
            o {xlUp && ...} continua evitando painel duplicado com o overlay. */}
        {xlUp && (
          <aside className="hidden w-[300px] shrink-0 xl:block">
            <PainelContexto
              key={selecionada?.id ?? 'vazio'}
              conversa={selecionada}
              conectado={conectado}
              onAtribuido={() => void revalidar(true)}
              onAgendar={abrirAgenda}
              onAgenteDesconectado={marcarDesconectado}
              onInserirTexto={inserirNoComposer}
            />
          </aside>
        )}
      </div>

      {/* Overlay de detalhe no mobile (< lg) */}
      {!desktop && mobileAberto && selecionada && (
        <Thread
          key={`overlay-${selecionada.id}`}
          conversa={selecionada}
          conectado={conectado}
          modo="overlay"
          onListaMudou={() => void revalidar(true)}
          onAgenteDesconectado={marcarDesconectado}
          onFechar={() => setMobileAberto(false)}
          onAbrirContexto={() => setContextoAberto(true)}
          registrarInserirTexto={registrarInserirTexto}
        />
      )}

      {/* Overlay do CONTEXTO (< xl), aberto pelo botão do cabeçalho da thread */}
      {!xlUp && contextoAberto && selecionada && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Contexto da conversa">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/30"
            onClick={() => setContextoAberto(false)}
            aria-label="Fechar contexto"
            tabIndex={-1}
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-border bg-card shadow-card">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Contexto</p>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setContextoAberto(false)}
                title="Fechar"
                aria-label="Fechar contexto"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PainelContexto
                key={`overlay-ctx-${selecionada.id}`}
                conversa={selecionada}
                conectado={conectado}
                onAtribuido={() => void revalidar(true)}
                onAgenteDesconectado={marcarDesconectado}
                onAgendar={(cliente) => {
                  setContextoAberto(false)
                  void abrirAgenda(cliente)
                }}
                onInserirTexto={inserirNoComposer}
              />
            </div>
          </div>
        </div>
      )}

      {/* Agendar na agenda — EventoModal da /agenda com cliente pré-vinculado */}
      <EventoModal
        aberto={agendaAberta}
        evento={null}
        pessoas={pessoas ?? []}
        inicial={
          agendaCliente ? { clienteId: agendaCliente.id, clienteNome: agendaCliente.nome } : undefined
        }
        onFechar={() => setAgendaAberta(false)}
        onSalvo={() => setAgendaAberta(false)}
      />
    </div>
  )
}
