'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, Bot, Clock, Inbox, MessageSquare, RefreshCw, Search, UserX, X } from 'lucide-react'
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
  TAMANHO_PAGINA_CONVERSAS,
} from '@/lib/conversas/lista-infinita'
import { mesmoTelefone } from '@/lib/conversas/telefone'
import { conversaCasaBusca } from '@/lib/conversas/busca'
import { transferidaPeloBot } from '@/lib/conversas/handoff'
import { useToast } from '@/components/ui/toast'
import type { Pessoa } from '@/lib/agenda/tipos'
import { EventoModal } from '@/components/agenda/EventoModal'
import { ConexaoAgente } from './ConexaoAgente'
import { ListaConversas } from './ListaConversas'
import { PainelContexto } from './PainelContexto'
import { Thread } from './Thread'
import { mensagemErroRelay } from './erros'

type FiltroChip = 'todos' | 'transferidas' | 'aguardando' | 'nao_atribuidas'

// Teto generoso da varredura global por status: 12 páginas × 25 = 300 conversas
// mais ativas/status. Ao esgotar sem achar, a UI sugere refinar a busca.
const MAX_PAGINAS_VARREDURA = 12

export function Conversas({ email }: { email: string }) {
  void email // e-mail (auth) é injetado server-side no header X-Simas-User-Email; aqui é só informativo.
  const { info } = useToast()

  // Filtros: chips 100% client-side (o status Abertas/Resolvidas virou segmento
  // próprio — ver `status`/`mudarStatus`, que trocam a QUERY do relay).
  const [filtroChip, setFiltroChip] = useState<FiltroChip>('todos')
  // Canal (inbox): '' = todas. Quem tem acesso a uma caixa só (escopo do relay)
  // simplesmente não vê diferença; quem vê as duas (ex.: administradora) escolhe.
  // DF/SC como alternâncias INDEPENDENTES (dono, 2026-07-21): um marcado filtra;
  // ambos marcados OU nenhum = sem restrição (padrão dos chips da Agenda — nunca
  // lista vazia). `canal` derivado preserva a identidade da query/geração.
  const [canaisSel, setCanaisSel] = useState<ReadonlySet<'DF' | 'SC'>>(new Set())
  const canal: '' | 'DF' | 'SC' = canaisSel.size === 1 ? [...canaisSel][0] : ''
  const [notifOn, setNotifOn] = useState(true)
  useEffect(() => { setNotifOn(notificacoesLigadas()) }, [])
  function alternarNotif() {
    const novo = !notifOn
    setNotifOn(novo)
    try { localStorage.setItem(NOTIF_PREF_KEY, novo ? 'on' : 'off') } catch { /* ignore */ }
  }
  const [status, setStatus] = useState<StatusConversa>('open')
  const [busca, setBusca] = useState('')

  // BUSCA GLOBAL (varredura): com 2+ caracteres, além de filtrar o já carregado,
  // paginamos o relay nos DOIS status (open + resolved) e acumulamos os que casam
  // por nome/telefone numa lista única (item resolvido já traz o selo RESOLVIDO).
  // Assim a equipe reencontra cliente antigo/resolvido sem descobrir o segmento.
  const termoBusca = busca.trim()
  const buscaAtiva = termoBusca.length >= 2
  const [varrendo, setVarrendo] = useState(false) // varredura em voo
  const [varreResultados, setVarreResultados] = useState<Conversa[]>([])
  const [varrePagina, setVarrePagina] = useState(0) // progresso ("página N")
  const [varreCompleto, setVarreCompleto] = useState(false) // terminou/atingiu teto
  // Sequência anti-corrida da varredura (independe do geracaoRef da query normal):
  // cada tecla/limpeza incrementa e invalida qualquer varredura em voo.
  const buscaSeqRef = useRef(0)

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

  // Plumbing PainelContexto → Thread ("Enviar documento do SIMAS"): a Thread
  // montada registra aqui como recarregar a thread (o callback que a usa é
  // `aoEnviarDocumento`, definido após `revalidar`).
  const recarregarThreadRef = useRef<(() => void) | null>(null)
  const registrarRecarregar = useCallback((fn: (() => void) | null) => {
    recarregarThreadRef.current = fn
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

  // Busca UMA página do relay para um status arbitrário. Só rede — não toca em
  // estado (composável). A varredura usa isto p/ paginar open E resolved; a lista
  // normal usa via `buscarPagina` (status atual).
  const buscarPaginaDe = useCallback(
    async (
      statusQ: StatusConversa,
      pagina: number,
    ): Promise<{ ok: true; conversas: Conversa[] } | { ok: false; erro: string }> => {
      try {
        const params = new URLSearchParams()
        params.set('status', statusQ)
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
    [canal],
  )

  // Página do STATUS atual (lista normal). Muda de identidade com status/canal,
  // então o reset da query re-roda exatamente nesses casos.
  const buscarPagina = useCallback(
    (pagina: number) => buscarPaginaDe(status, pagina),
    [buscarPaginaDe, status],
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

  // Ordena por última mensagem desc (desempate por id) — mesma ordem da lista.
  const ordenarPorRecente = useCallback((itens: Conversa[]): Conversa[] => {
    return [...itens].sort((a, b) => {
      const ta = a.ultimaMensagem?.timestamp ?? 0
      const tb = b.ultimaMensagem?.timestamp ?? 0
      return tb - ta || b.id - a.id
    })
  }, [])

  // VARREDURA: pagina open + resolved (teto por status), acumulando por id os que
  // casam o termo, com commit incremental (o usuário vê chegando). `seed` são os
  // matches já carregados (aparecem na hora, sem flash). Cada passo checa o
  // `buscaSeqRef`: se a busca mudou/limpou, aborta sem tocar em estado obsoleto.
  const varrer = useCallback(
    async (seq: number, termo: string, seed: Conversa[]) => {
      const acc = new Map<number, Conversa>(seed.map((c) => [c.id, c]))
      for (const st of ['open', 'resolved'] as const) {
        for (let page = 1; page <= MAX_PAGINAS_VARREDURA; page++) {
          if (buscaSeqRef.current !== seq) return // busca trocou/limpou → aborta
          setVarrePagina(page)
          const res = await buscarPaginaDe(st, page)
          if (buscaSeqRef.current !== seq) return
          if (!res.ok) break // erro neste status: tenta o próximo status
          for (const c of res.conversas) {
            if (conversaCasaBusca(c, termo)) acc.set(c.id, c)
          }
          setVarreResultados(ordenarPorRecente([...acc.values()]))
          if (res.conversas.length < TAMANHO_PAGINA_CONVERSAS) break // fim deste status
        }
      }
      if (buscaSeqRef.current !== seq) return
      setVarrendo(false)
      setVarreCompleto(true)
    },
    [buscarPaginaDe, ordenarPorRecente],
  )

  // Dispara a varredura com DEBOUNCE ao digitar 2+ caracteres (e re-dispara se o
  // canal muda). Sem termo suficiente, sai do modo varredura e limpa — a lista
  // NORMAL (conversas) nunca é tocada aqui, então cancelar a busca volta ao
  // estado anterior sem bagunçar a paginação infinita. Incrementar o seq no corpo
  // (não só no cleanup) invalida na hora qualquer varredura em voo.
  useEffect(() => {
    if (!buscaAtiva) {
      buscaSeqRef.current++
      setVarrendo(false)
      setVarreResultados([])
      setVarrePagina(0)
      setVarreCompleto(false)
      return
    }
    const seq = ++buscaSeqRef.current
    // Só semeia matches do CANAL atual: ao trocar de canal, `conversasRef` ainda
    // segura a lista anterior (o reset refaz a query em async), e sem este guard
    // itens do outro canal vazariam para a varredura e ficariam até limpar a busca.
    const seed = conversasRef.current.filter(
      (c) => (canal === '' || c.inbox === canal) && conversaCasaBusca(c, termoBusca),
    )
    setVarreResultados(seed) // matches locais já aparecem (sem flash)
    setVarreCompleto(false)
    setVarrendo(true)
    setVarrePagina(0)
    const t = setTimeout(() => { void varrer(seq, termoBusca, seed) }, 350)
    return () => clearTimeout(t)
  }, [buscaAtiva, termoBusca, canal, varrer])

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

  // Documento do SIMAS enviado pelo PainelContexto: recarrega a thread aberta
  // (paridade com o upload do PC) e revalida a lista (reordena + prévia).
  const aoEnviarDocumento = useCallback(() => {
    recarregarThreadRef.current?.()
    void revalidar(true)
  }, [revalidar])

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

  // Deep-link /conversas?conversa=<id> (toast de notificação e "Ver conversa" do
  // inbox de comprovantes). Leio o param UMA vez do window.location.search num
  // efeito de mount — assim NÃO preciso do useSearchParams (que exigiria um
  // boundary de Suspense neste client component no App Router). O id gravado pelo
  // webhook do Chatwoot é o display_id (push_event_data.id), o MESMO id que a
  // lista do relay usa — então casa direto por c.id.
  const deepLinkRef = useRef<number | null>(null)
  const deepLinkAvisouRef = useRef(false)
  useEffect(() => {
    const m = /[?&]conversa=(\d+)/.exec(window.location.search)
    if (m) deepLinkRef.current = Number(m[1])
  }, [])
  useEffect(() => {
    const alvoId = deepLinkRef.current
    if (alvoId == null || loading) return
    const alvo = conversas.find((c) => c.id === alvoId)
    if (alvo) {
      setSelecionadaId(alvo.id)
      setMobileAberto(true) // no mobile abre a thread; no desktop é ignorado
      deepLinkRef.current = null
      // Limpa o param p/ um refresh não re-selecionar (preserva pathname/hash).
      const url = new URL(window.location.href)
      url.searchParams.delete('conversa')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
      return
    }
    // Não está nas páginas abertas: puxa mais (teto de 5 páginas ≈ 125 conversas)
    // usando o próprio scroll infinito; cada página nova reavalia este efeito.
    if (temMais && paginaMax < 5) {
      void carregarMais()
      return
    }
    // Esgotou sem casar: a lista abre em "open", então pode estar em Resolvidas.
    // Avisa UMA vez e desiste (não fica em laço).
    if (!deepLinkAvisouRef.current) {
      deepLinkAvisouRef.current = true
      info('Conversa não encontrada na lista atual', 'Verifique o filtro Resolvidas.')
    }
    deepLinkRef.current = null
  }, [conversas, loading, temMais, paginaMax, carregarMais, info])

  // Deep-link por telefone (/conversas?telefone=<dígitos>) — usado pelo cartão de
  // contato do caso ("Chamar no Conversas"). Casa via mesmoTelefone (com/sem 9º
  // dígito, DDI). Varre as páginas já carregadas; se não achou e ainda há mais,
  // avisa UMA vez e segue (o scroll infinito carrega o resto e este efeito
  // reavalia); se a lista terminou sem casar, avisa que não há conversa aberta.
  // Não cria conversa nova (o relay não suporta) nem quebra o deep-link por id.
  const deepLinkTelRef = useRef<string | null>(null)
  const deepLinkTelAvisouRef = useRef(false)
  useEffect(() => {
    const m = /[?&]telefone=(\d+)/.exec(window.location.search)
    if (m) deepLinkTelRef.current = m[1]
  }, [])
  useEffect(() => {
    const alvoTel = deepLinkTelRef.current
    if (alvoTel == null || loading) return
    const alvo = conversas.find((c) => mesmoTelefone(c.contato.telefone, alvoTel))
    if (alvo) {
      setSelecionadaId(alvo.id)
      setMobileAberto(true) // no mobile abre a thread; no desktop é ignorado
      deepLinkTelRef.current = null
      return
    }
    if (!temMais) {
      info('Nenhuma conversa aberta com este número', 'Inicie o contato pelo WhatsApp; a conversa aparecerá aqui.')
      deepLinkTelRef.current = null
    } else if (!deepLinkTelAvisouRef.current) {
      deepLinkTelAvisouRef.current = true
      info('Procurando a conversa…', 'Role a lista para carregar mais conversas.')
    }
  }, [conversas, temMais, loading, info])

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
  }

  // Segmento Abertas | Resolvidas: troca o status da QUERY → reset via efeito
  // (buscarPagina muda de identidade). Zera o chip e a seleção pra não confundir.
  function mudarStatus(novo: StatusConversa) {
    if (novo === status) return
    setStatus(novo)
    setFiltroChip('todos')
    setSelecionadaId(null)
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

  const conectado = agente?.conectado === true

  // Seleção resolvida da lista NORMAL ou da varredura (a conversa aberta pode ser
  // resolvida, fora de `conversas`). Guarda o último objeto num ref pra manter a
  // thread aberta mesmo depois de limpar a busca (quando a varredura é zerada).
  const selecionadaMemoriaRef = useRef<Conversa | null>(null)
  const selecionada = useMemo(() => {
    const achada =
      varreResultados.find((c) => c.id === selecionadaId) ??
      conversas.find((c) => c.id === selecionadaId) ??
      (selecionadaMemoriaRef.current?.id === selecionadaId ? selecionadaMemoriaRef.current : null)
    if (achada) selecionadaMemoriaRef.current = achada
    return achada
  }, [varreResultados, conversas, selecionadaId])

  // Busca client-side (nome/telefone/trecho, acento-insensível) sobre o já
  // carregado — usada quando NÃO estamos em varredura (< 2 chars).
  const visiveis = useMemo(() => {
    const t = busca.trim()
    if (!t) return conversas
    return conversas.filter((c) => conversaCasaBusca(c, t))
  }, [conversas, busca])

  // Lista efetivamente exibida: varredura (2+ chars) ou a lista/filtro normal.
  const listaExibida = buscaAtiva ? varreResultados : visiveis

  // Contagens dos chips — sobre TODO o acumulado (pós-busca), não só uma página.
  const nTodos = visiveis.length
  const nTransferidas = visiveis.filter((c) => transferidaPeloBot(c)).length
  const nAguardando = visiveis.filter((c) => c.aguardandoDesde !== null).length
  const nNaoAtribuidas = visiveis.filter((c) => !c.assignee).length

  // Chips por ÍCONE + contador (rótulo no tooltip): todos cabem na coluna de
  // 330px sem depender de rolagem lateral — pedido do dono após o compactamento.
  const chips: { value: FiltroChip; label: string; Icone: typeof Inbox; n: number | null }[] = [
    { value: 'todos', label: 'Todas as conversas', Icone: Inbox, n: nTodos },
    { value: 'transferidas', label: 'Transferidas pelo assistente', Icone: Bot, n: nTransferidas },
    { value: 'aguardando', label: 'Aguardando resposta', Icone: Clock, n: nAguardando },
    { value: 'nao_atribuidas', label: 'Sem atendente atribuído', Icone: UserX, n: nNaoAtribuidas },
  ]

  // Contador do cabeçalho: na varredura mostra os resultados; senão, o acumulado.
  const nCabecalho = buscaAtiva
    ? varreResultados.length
    : loading && conversas.length === 0
      ? '…'
      : nTodos

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-3 lg:px-6 lg:py-4 [@media(max-height:760px)]:py-2">
      {/* 3 colunas full-height: LISTA | THREAD | CONTEXTO (xl+). A conexão da
          conta virou um indicador discreto na LINHA 1 do cabeçalho da lista
          (não mais uma faixa full-width roubando altura da tela). */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* COLUNA 1 — LISTA (~330px) */}
        <section className="flex w-full min-w-0 flex-col lg:w-[330px] lg:shrink-0">
          {/* Cabeçalho compacto: título slim + 2 linhas de controles. O objetivo
              é devolver altura para lista+thread no notebook — em telas baixas
              (max-height 760px) o subtítulo some e o título encolhe. */}
          <div className="shrink-0 space-y-2 pb-2 [@media(max-height:760px)]:space-y-1.5 [@media(max-height:760px)]:pb-1.5">
            {/* Título da página (encolhe em telas baixas) + ações leves */}
            <div className="flex items-center gap-2 max-lg:pl-12">
              <h1 className="min-w-0 flex-1 truncate font-heading text-lg font-bold text-foreground [@media(max-height:760px)]:text-base">
                Conversas
              </h1>
              <span className="inline-flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
                {nCabecalho}
              </span>
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
            </div>
            <p className="truncate text-xs text-muted-foreground max-lg:pl-12 [@media(max-height:760px)]:hidden">
              Atendimento omnichannel · WhatsApp DF/SC
            </p>

            {/* LINHA 1: busca (flex-1) + segmento Abertas|Resolvidas + indicador
                de conexão (pontinho). O segmento troca a query do relay; a
                varredura (busca 2+ chars) cobre os dois status. */}
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  ref={buscaRef}
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar cliente…"
                  aria-label="Buscar conversa por nome, telefone ou trecho (atalho ⌘K)"
                  title="Buscar — atalho ⌘K / Ctrl+K"
                  className="h-9 w-full rounded-full border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div
                className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-card p-1"
                role="group"
                aria-label="Status das conversas"
              >
                {([['open', 'Abertas'], ['resolved', 'Resolvidas']] as const).map(([v, rotulo]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => mudarStatus(v)}
                    aria-pressed={status === v}
                    className={cn(
                      'inline-flex items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold transition-colors',
                      status === v
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>

              <ConexaoAgente agente={agente} loading={loadingAgente} onMudou={carregarAgente} />
            </div>

            {/* LINHA 2: chips de filtro + canal (Todas·DF·SC) numa faixa única
                com scroll horizontal próprio — nunca quebra em várias linhas. */}
            <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex items-center gap-1.5" role="group" aria-label="Filtro de conversas">
                {chips.map((chip) => {
                  const ativo = filtroChip === chip.value
                  return (
                    <button
                      key={chip.value}
                      type="button"
                      onClick={() => mudarChip(chip.value)}
                      aria-pressed={ativo}
                      title={chip.label}
                      aria-label={chip.label}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium transition-colors',
                        ativo
                          ? 'bg-foreground text-background'
                          : 'border border-border bg-card text-muted-foreground hover:border-ring hover:text-foreground',
                      )}
                    >
                      <chip.Icone className="h-3.5 w-3.5" aria-hidden />
                      {chip.n !== null && (
                        <span className={cn('font-semibold', ativo ? 'text-background/70' : 'text-foreground/70')}>
                          {chip.n}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              <span className="h-4 w-px shrink-0 bg-border" aria-hidden />

              {/* Canal: DF e SC alternáveis de forma independente (sem "Todas") —
                  os dois marcados ou nenhum = mostra tudo. O relay filtra na
                  origem; agente com uma caixa só continua vendo só a sua. */}
              <div className="flex items-center gap-1.5" role="group" aria-label="Canal">
                {(['DF', 'SC'] as const).map((v) => {
                  const marcado = canaisSel.has(v)
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setCanaisSel((s) => {
                          const n = new Set(s)
                          if (n.has(v)) n.delete(v)
                          else n.add(v)
                          return n
                        })
                        setSelecionadaId(null)
                      }}
                      aria-pressed={marcado}
                      title={marcado ? `Mostrando ${v} — clique para desmarcar` : `Filtrar pelo número ${v}`}
                      className={cn(
                        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium transition-colors',
                        marcado
                          ? 'bg-foreground text-background'
                          : 'border border-border bg-card text-muted-foreground hover:border-ring hover:text-foreground',
                      )}
                    >
                      {v}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Lista rolável (scroll infinito). O container é o root do observer;
              a sentinela no fim dispara o carregamento da próxima página. Em
              VARREDURA (busca 2+ chars) exibe os resultados acumulados dos dois
              status; o chip não filtra (passa 'todos') pra não esconder um match. */}
          <div ref={listaRef} className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            {buscaAtiva && listaExibida.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
                {varrendo ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="h-4 w-4" /> Procurando em abertas e resolvidas…
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma conversa encontrada para “{termoBusca}”. Refine a busca.
                  </p>
                )}
              </div>
            ) : (
              <ListaConversas
                conversas={listaExibida}
                loading={buscaAtiva ? false : loading}
                erro={erroLista}
                selecionadaId={selecionadaId}
                onSelecionar={selecionar}
                filtroChip={buscaAtiva ? 'todos' : filtroChip}
                agoraEpochSeg={agoraEpochSeg}
              />
            )}

            {/* Rodapé da VARREDURA: progresso discreto e aviso de teto. Só com
                resultados — o estado vazio acima já cobre "procurando"/"nada". */}
            {buscaAtiva && listaExibida.length > 0 && (varrendo || varreCompleto) && (
              <p className="flex items-center justify-center gap-2 py-3 text-center text-xs text-muted-foreground">
                {varrendo ? (
                  <><Spinner className="h-3.5 w-3.5" /> Procurando… página {varrePagina}</>
                ) : (
                  <>
                    {listaExibida.length} resultado{listaExibida.length === 1 ? '' : 's'} · não achou? refine a busca
                  </>
                )}
              </p>
            )}

            {/* Sentinela + rodapé do scroll infinito. Só relevante sem busca
                ativa (busca é filtro cliente/varredura, não paginação normal). */}
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
              registrarRecarregar={registrarRecarregar}
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
              onDocumentoEnviado={aoEnviarDocumento}
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
          registrarRecarregar={registrarRecarregar}
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
                onDocumentoEnviado={aoEnviarDocumento}
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
