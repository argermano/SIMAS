'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Lock,
  PanelRightOpen,
  Paperclip,
  Pencil,
  RotateCcw,
  Send,
  StickyNote,
  UserPlus,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { AvatarContato } from './AvatarContato'
import { agrupadorDia } from '@/lib/conversas/formato'
import { autorCitacao, indexarPorId, resumoCitacao } from '@/lib/conversas/citacao'
import { menorId, mesclarMensagens } from '@/lib/conversas/paginacao'
import type { Conversa, Mensagem, RespostaMensagens } from '@/lib/conversas/tipos'
import { BlocoCitacao } from './BlocoCitacao'
import { MensagemBolha } from './MensagemBolha'
import { codeDoErro, mensagemErroApi, mensagemErroRelay, rotuloDia } from './erros'
import { createClient } from '@/lib/supabase/client'
import {
  LIMITE_UPLOAD_BYTES,
  TIPOS_ANEXO_PERMITIDOS,
  tipoAnexoPermitido,
  mimePorNomeArquivo,
} from '@/lib/conversas/anexos'

// accept do seletor: MIME da allowlist + mídia inerte (áudio/vídeo, aceitos por
// regra de prefixo em anexos.ts) + extensões (alguns navegadores só casam por extensão).
const ACCEPT_ANEXO = [
  ...TIPOS_ANEXO_PERMITIDOS,
  'audio/*', 'video/*',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt',
  '.mp4', '.3gp', '.mov', '.ogg', '.opus', '.mp3', '.m4a',
].join(',')

/** Distância do topo (px) que dispara a busca da página anterior do histórico. */
const LIMIAR_TOPO_PX = 80

/** Tamanho legível para o chip do anexo (B/KB/MB). */
function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Grupo {
  dia: string
  mensagens: Mensagem[]
}

/** Agrupa mensagens consecutivas por dia (America/Sao_Paulo). */
function agruparPorDia(mensagens: Mensagem[]): Grupo[] {
  const grupos: Grupo[] = []
  for (const m of mensagens) {
    const dia = agrupadorDia(m.timestamp)
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.dia === dia) ultimo.mensagens.push(m)
    else grupos.push({ dia, mensagens: [m] })
  }
  return grupos
}

export function Thread({
  conversa,
  conectado,
  modo,
  nomeAgente,
  onListaMudou,
  onAgenteDesconectado,
  onFechar,
  onAbrirContexto,
  registrarInserirTexto,
  registrarRecarregar,
}: {
  conversa: Conversa
  conectado: boolean
  modo: 'inline' | 'overlay'
  /** Nome do agente conectado — citação da própria saída dele vira "Você". */
  nomeAgente?: string | null
  onListaMudou: () => void
  onAgenteDesconectado: () => void
  onFechar?: () => void
  /** Abre o painel de contexto como overlay (visível só abaixo de 2xl). */
  onAbrirContexto?: () => void
  /** Plumbing do shell: registra uma função que preenche o composer (usada
   * pelo "Inserir cobrança no chat" do PainelContexto). null ao desmontar. */
  registrarInserirTexto?: (fn: ((texto: string) => void) | null) => void
  /** Plumbing do shell: registra "recarregar a thread" (usada quando o
   * PainelContexto envia um documento do SIMAS nesta conversa). null ao desmontar. */
  registrarRecarregar?: (fn: (() => void) | null) => void
}) {
  const { success, error: toastError } = useToast()
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Paginação retroativa do histórico (o relay entrega ~20 por página).
  const [carregandoAntigas, setCarregandoAntigas] = useState(false)
  const [fimDoHistorico, setFimDoHistorico] = useState(false)
  const [erroAntigas, setErroAntigas] = useState<string | null>(null)

  const [texto, setTexto] = useState('')
  const [notaInterna, setNotaInterna] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [acao, setAcao] = useState<'assumir' | 'status' | null>(null)
  // Arquivo do PC selecionado no clipe (envio como anexo; a legenda é o próprio textarea).
  const [arquivo, setArquivo] = useState<File | null>(null)
  // Modo RESPOSTA (citação no padrão WhatsApp): mensagem que está sendo citada.
  const [respondendo, setRespondendo] = useState<Mensagem | null>(null)
  // Modo EDIÇÃO (padrão WhatsApp): mensagem própria sendo corrigida. Exclusivo
  // com o modo resposta — entrar num sai do outro (o composer só faz uma coisa).
  const [editando, setEditando] = useState<Mensagem | null>(null)
  // Mensagem destacada por um clique numa citação (realce breve).
  const [destaque, setDestaque] = useState<number | null>(null)

  const fimRef = useRef<HTMLDivElement>(null)
  const rolagemRef = useRef<HTMLDivElement>(null)
  const inputFileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const destaqueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Rascunho que estava no campo quando o modo edição começou: cancelar a edição
  // devolve o que a pessoa tinha escrito, em vez de comê-lo em silêncio.
  const rascunhoRef = useRef('')
  // Reentrância: o onScroll dispara várias vezes no mesmo frame, antes de
  // `carregandoAntigas` chegar ao próximo render — só o ref segura a 2ª chamada.
  const buscandoAntigasRef = useRef(false)
  // Distância do topo da viewport até o FIM do conteúdo, medida logo antes do
  // prepend e restaurada no layout effect (âncora de rolagem).
  const ancoraRef = useRef<number | null>(null)
  const id = conversa.id

  const carregar = useCallback(async (silencioso = false) => {
    // silencioso: revalida sem trocar a thread pelo spinner de tela cheia
    // (usado após enviar) e sem apagar as mensagens já visíveis em caso de erro.
    if (!silencioso) {
      setLoading(true)
      setErro(null)
    }
    try {
      const r = await fetch(`/api/conversas/${id}/mensagens`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (!silencioso) {
          setErro(mensagemErroRelay(r.status, d))
          setMensagens([])
        }
        return
      }
      // MESCLA (não substitui): esta rota só devolve a página MAIS RECENTE, e
      // trocar a lista inteira por ela jogaria fora o histórico que o usuário já
      // puxou rolando para cima (o refresh roda a cada 3s e após cada envio).
      const novas = (d as RespostaMensagens).mensagens ?? []
      setMensagens((prev) => mesclarMensagens(prev, novas))
    } catch {
      if (!silencioso) {
        setErro('Falha de rede ao carregar as mensagens.')
        setMensagens([])
      }
    } finally {
      if (!silencioso) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Expõe "preencher o composer" para o shell (PainelContexto → cobrança).
  useEffect(() => {
    registrarInserirTexto?.((texto) => setTexto(texto))
    return () => registrarInserirTexto?.(null)
  }, [registrarInserirTexto])

  // Expõe "recarregar a thread" para o shell (PainelContexto → documento do SIMAS).
  useEffect(() => {
    registrarRecarregar?.(() => void carregar(true))
    return () => registrarRecarregar?.(null)
  }, [registrarRecarregar, carregar])

  // Atualização automática da conversa aberta: revalida em silêncio a cada 3s
  // (aba visível). Não mexe no composer (estado separado) e o auto-scroll abaixo
  // só dispara quando chega mensagem NOVA — ler histórico não é interrompido.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void carregar(true)
    }, 3_000)
    return () => clearInterval(id)
  }, [carregar])

  // Rola para o fim só quando chega mensagem NOVA (id do fim mudou) — a
  // revalidação silenciosa com o mesmo conteúdo não rouba o scroll da leitura.
  const ultimaIdRef = useRef<number | null>(null)
  useEffect(() => {
    const ultima = mensagens.length ? mensagens[mensagens.length - 1].id : null
    if (ultima !== ultimaIdRef.current) {
      ultimaIdRef.current = ultima
      fimRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [mensagens])

  /** Página ANTERIOR do histórico (?before=<menor id carregado>) — estilo WhatsApp. */
  async function carregarAntigas() {
    const cont = rolagemRef.current
    const cursor = menorId(mensagens)
    if (!cont || cursor === null || buscandoAntigasRef.current) return
    buscandoAntigasRef.current = true
    setCarregandoAntigas(true)
    setErroAntigas(null)
    try {
      const r = await fetch(`/api/conversas/${id}/mensagens?before=${cursor}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErroAntigas(mensagemErroRelay(r.status, d))
        return
      }
      const novas = (d as RespostaMensagens).mensagens ?? []
      // Vazia — ou sem nada mais antigo que o cursor — é o começo da conversa.
      // Sem esta 2ª guarda, uma página só de repetidos não mudaria a altura e o
      // gatilho do topo dispararia de novo, em laço.
      const menorNova = menorId(novas)
      if (menorNova === null || menorNova >= cursor) {
        setFimDoHistorico(true)
        return
      }
      // Mede AGORA (DOM ainda sem as antigas) e restaura no layout effect: sem a
      // âncora a tela pula para o topo e dispara fetch em cascata.
      ancoraRef.current = cont.scrollHeight - cont.scrollTop
      setMensagens((prev) => mesclarMensagens(prev, novas))
    } catch {
      setErroAntigas('Falha de rede ao carregar as mensagens anteriores.')
    } finally {
      buscandoAntigasRef.current = false
      setCarregandoAntigas(false)
    }
  }

  /** Gatilho do histórico: perto do topo, puxa a página anterior. O erro trava o
   *  gatilho de propósito — quem destrava é o clique em "Tentar de novo". */
  function aoRolar() {
    const cont = rolagemRef.current
    if (!cont || fimDoHistorico || erroAntigas || buscandoAntigasRef.current) return
    if (cont.scrollTop < LIMIAR_TOPO_PX) void carregarAntigas()
  }

  // Âncora de rolagem do prepend: repõe a distância até o fim medida antes do
  // render, mantendo na tela a mensagem que estava sendo lida. Roda antes do
  // efeito de "rolar para o fim" (layout effect vem antes do passivo), que de
  // toda forma não dispara aqui — ele é chaveado pela ÚLTIMA mensagem, e o
  // prepend só mexe no começo da lista.
  useLayoutEffect(() => {
    const cont = rolagemRef.current
    const distanciaDoFim = ancoraRef.current
    if (!cont || distanciaDoFim === null) return
    ancoraRef.current = null
    cont.scrollTop = cont.scrollHeight - distanciaDoFim
  }, [mensagens])

  // O modo resposta e o histórico paginado são da CONVERSA aberta: trocar de
  // conversa zera a citação e volta a paginação ao começo.
  // (O shell já remonta a Thread por `key`; a guarda existe para o dia em que
  // isso mudar — citar a mensagem de outra conversa, ou misturar históricos,
  // seria erro silencioso.)
  useEffect(() => {
    setRespondendo(null)
    setEditando(null)
    setDestaque(null)
    setMensagens([])
    setFimDoHistorico(false)
    setErroAntigas(null)
    setCarregandoAntigas(false)
    buscandoAntigasRef.current = false
    ancoraRef.current = null
  }, [id])

  /** Sai do modo edição devolvendo ao campo o rascunho que havia antes. */
  const cancelarEdicao = useCallback(() => {
    setEditando(null)
    setTexto(rascunhoRef.current)
    rascunhoRef.current = ''
  }, [])

  // Esc cancela a resposta OU a edição (padrão WhatsApp), com o foco em qualquer
  // ponto da tela. Os dois modos são exclusivos, então nunca há ambiguidade.
  useEffect(() => {
    if (!respondendo && !editando) return
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (editando) cancelarEdicao()
      else setRespondendo(null)
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [respondendo, editando, cancelarEdicao])

  useEffect(() => () => {
    if (destaqueTimerRef.current) clearTimeout(destaqueTimerRef.current)
  }, [])

  /** Entra em modo resposta e devolve o foco ao campo de texto. */
  const responder = useCallback((m: Mensagem) => {
    setEditando(null) // exclusivo com o modo edição
    setRespondendo(m)
    // O anexo sai por outro endpoint, que não leva citação: descartamos o arquivo
    // pendente (mesma regra que a nota interna já aplicava) para o que está na
    // tela ser exatamente o que vai ser enviado.
    setArquivo(null)
    textareaRef.current?.focus()
  }, [])

  /** Entra em modo edição: o campo passa a conter o texto ATUAL da mensagem. */
  const editar = useCallback((m: Mensagem) => {
    setRespondendo(null) // exclusivo com o modo resposta
    setArquivo(null)
    setNotaInterna(false) // editar é sempre no WhatsApp, nunca nota interna
    setEditando((anterior) => {
      // Só guarda o rascunho na PRIMEIRA entrada: trocar de mensagem no meio da
      // edição não pode substituir o rascunho pelo texto da mensagem anterior.
      if (!anterior) rascunhoRef.current = texto
      return m
    })
    setTexto(m.conteudo)
    textareaRef.current?.focus()
  }, [texto])

  /** Clique no bloco de citação: rola até a mensagem citada e a destaca. */
  const irParaCitada = useCallback(
    (idCitada: number) => {
      const el = document.getElementById(`msg-${id}-${idCitada}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setDestaque(idCitada)
      if (destaqueTimerRef.current) clearTimeout(destaqueTimerRef.current)
      destaqueTimerRef.current = setTimeout(() => setDestaque(null), 1800)
    },
    [id],
  )

  // Índice id → mensagem: resolve as citações da página em O(N), não O(N²).
  const porId = useMemo(() => indexarPorId(mensagens), [mensagens])

  // Resumo da citação da faixa do composer (autor + trecho), calculado uma vez.
  const citacaoComposer = useMemo(() => {
    if (!respondendo) return null
    const { midia, trecho } = resumoCitacao(respondendo)
    return {
      autor: autorCitacao(respondendo, { nomeContato: conversa.contato.nome, nomeAgente }),
      midia,
      trecho,
    }
  }, [respondendo, conversa.contato.nome, nomeAgente])

  /** Trata um 428 (agente não conectado) de qualquer escrita. */
  function tratou428(status: number, data: unknown): boolean {
    if (status === 428 || codeDoErro(data) === 'AGENT_NOT_CONNECTED') {
      onAgenteDesconectado()
      toastError('Conecte sua conta', 'Conecte sua conta do Chatwoot para responder.')
      return true
    }
    return false
  }

  /** Valida (tipo/tamanho) e guarda o arquivo escolhido no seletor oculto. */
  function selecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = '' // permite re-selecionar o mesmo arquivo depois
    if (!f) return
    // Alguns SOs dão File.type '' para .doc/.docx: cai na extensão antes de barrar.
    const tipo = f.type ? f.type : mimePorNomeArquivo(f.name)
    if (!tipoAnexoPermitido(tipo)) {
      toastError('Tipo não permitido', 'Envie imagem, vídeo, áudio, PDF, Word, Excel ou texto.')
      return
    }
    if (f.size > LIMITE_UPLOAD_BYTES) {
      toastError('Arquivo muito grande', 'O limite é 40 MB.')
      return
    }
    // O envio de ANEXO é outro endpoint (não leva citação): sair do modo resposta
    // aqui é honesto — a faixa some na hora, em vez de a citação se perder calada.
    setRespondendo(null)
    setArquivo(f)
  }

  /** Envia o arquivo do PC ao cliente: sobe DIRETO ao Storage por URL assinada e
   *  só então manda o storagePath ao servidor — o binário nunca passa pelo corpo
   *  da função Vercel (teto ~4,5 MB). A legenda é o texto do composer. */
  async function enviarAnexo() {
    if (!arquivo) return
    setEnviando(true)
    try {
      const caption = texto.trim()

      // 1) Prepara: valida tipo/tamanho no servidor e devolve a URL assinada.
      const prep = await fetch(`/api/conversas/${id}/anexo/preparar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: arquivo.name, mimetype: arquivo.type, tamanho: arquivo.size }),
      })
      const prepData = await prep.json().catch(() => ({}))
      if (!prep.ok) {
        if (tratou428(prep.status, prepData)) return
        if (prep.status === 413) toastError('Arquivo muito grande', 'O limite é 40 MB.')
        else toastError('Não enviado', mensagemErroRelay(prep.status, prepData))
        return
      }
      const { token, storagePath } = prepData as { token: string; storagePath: string }

      // 2) Upload direto ao Storage (contorna o teto de corpo da função Vercel).
      const supabase = createClient()
      const { error: upErr } = await supabase.storage
        .from('documentos')
        .uploadToSignedUrl(storagePath, token, arquivo, {
          contentType: arquivo.type || 'application/octet-stream',
        })
      if (upErr) {
        toastError('Não enviado', 'Falha ao subir o arquivo. Tente novamente.')
        return
      }

      // 3) Dispara o envio ao cliente pelo relay (o servidor baixa do Storage).
      const r = await fetch(`/api/conversas/${id}/anexo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath,
          filename: arquivo.name,
          mimetype: arquivo.type,
          caption: caption || undefined,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (tratou428(r.status, d)) return
        if (r.status === 413) toastError('Arquivo muito grande', 'O limite é 40 MB.')
        else toastError('Não enviado', mensagemErroRelay(r.status, d))
        return
      }
      setArquivo(null)
      setTexto('')
      success('Documento enviado')
      await carregar(true)
      onListaMudou()
    } catch {
      toastError('Não enviado', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  /**
   * Salva a EDIÇÃO da mensagem no WhatsApp (PATCH → VPS → Evolution).
   * Nada é postado no Chatwoot daqui: o acompanhamento "Editada: <novo texto>"
   * é publicado pelo próprio Evolution, então o recarregar silencioso já o traz.
   */
  async function salvarEdicao() {
    if (!editando) return
    const novo = texto.trim()
    if (!novo) return
    if (novo === editando.conteudo.trim()) {
      cancelarEdicao()
      return
    }
    setEnviando(true)
    try {
      const r = await fetch(`/api/conversas/${id}/mensagens/${editando.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: novo }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (tratou428(r.status, d)) return
        // A rota devolve a falha TIPADA: o 'timeout' é a janela "talvez editou" e
        // JAMAIS pode virar "tente novamente" — reenviar às cegas não conserta
        // nada e ainda confunde quem está com o cliente na linha.
        const motivo = (d as { motivo?: string }).motivo
        if (motivo === 'timeout') {
          toastError(
            'Edição não confirmada',
            'Não deu para confirmar a edição — confira no WhatsApp antes de tentar de novo.',
          )
        } else {
          // mensagemErroApi, não o mapa do relay: os 404/422 desta rota vêm com
          // explicação própria ("Não localizei essa mensagem no WhatsApp…") que o
          // mapa genérico achataria num "Não encontrado." inútil.
          toastError('Não editada', mensagemErroApi(r.status, d))
        }
        return
      }
      setEditando(null)
      setTexto(rascunhoRef.current)
      rascunhoRef.current = ''
      success('Mensagem editada')
      await carregar(true)
      onListaMudou()
    } catch {
      toastError('Não editada', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  async function enviar() {
    if (enviando) return
    if (editando) return salvarEdicao() // no modo edição o campo salva, não envia
    if (arquivo) return enviarAnexo() // com arquivo, o textarea vira legenda
    const content = texto.trim()
    if (!content) return
    setEnviando(true)
    try {
      const r = await fetch(`/api/conversas/${id}/mensagens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          private: notaInterna,
          // Só vai quando há citação — o corpo de sempre continua idêntico.
          ...(respondendo ? { emRespostaA: respondendo.id } : {}),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (!tratou428(r.status, d)) toastError('Não enviado', mensagemErroRelay(r.status, d))
        return
      }
      setTexto('')
      setRespondendo(null)
      success(notaInterna ? 'Nota interna salva' : 'Mensagem enviada')
      await carregar(true)
      onListaMudou()
    } catch {
      toastError('Não enviado', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  async function assumir() {
    setAcao('assumir')
    try {
      const r = await fetch(`/api/conversas/${id}/atribuir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ self: true }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (!tratou428(r.status, d)) toastError('Não foi possível assumir', mensagemErroRelay(r.status, d))
        return
      }
      success('Conversa assumida')
      onListaMudou()
    } catch {
      toastError('Não foi possível assumir', 'Falha de rede. Tente novamente.')
    } finally {
      setAcao(null)
    }
  }

  async function alternarStatus() {
    const novo = conversa.status === 'open' ? 'resolved' : 'open'
    setAcao('status')
    try {
      const r = await fetch(`/api/conversas/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novo }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (!tratou428(r.status, d)) toastError('Não foi possível alterar', mensagemErroRelay(r.status, d))
        return
      }
      success(novo === 'resolved' ? 'Conversa resolvida' : 'Conversa reaberta')
      onListaMudou()
    } catch {
      toastError('Não foi possível alterar', 'Falha de rede. Tente novamente.')
    } finally {
      setAcao(null)
    }
  }

  const nome = conversa.contato.nome || conversa.contato.telefone || `Conversa #${id}`
  const grupos = agruparPorDia(mensagens)
  const resolvida = conversa.status === 'resolved'
  // Cabeçalho compacto (coluna estreita) esconde o rótulo: o título/aria-label
  // é a única pista do que o botão faz, então tem de valer nos dois estados.
  const tituloStatus = !conectado
    ? `Conecte sua conta para ${resolvida ? 'reabrir' : 'resolver'}`
    : resolvida
      ? 'Reabrir a conversa'
      : 'Resolver a conversa'

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card',
        modo === 'overlay' ? 'fixed inset-0 z-50 rounded-none' : 'h-full',
      )}
    >
      {/* Cabeçalho do contato. `container-type: inline-size` faz o cabeçalho
          responder à LARGURA DESTA COLUNA, não à da janela: num notebook 1366 a
          janela é "grande" mas a coluna do meio fica estreita — é ela que decide
          entre rótulo e só ícone. Regra: Assumir/Resolver NUNCA saem da tela;
          quem some/trunca primeiro é o texto (nome e responsável). */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 [container-type:inline-size]">
        <AvatarContato nome={nome} avatarUrl={conversa.contato.avatarUrl} className="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <h2 className="min-w-0 truncate font-semibold text-foreground">{nome}</h2>
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {conversa.contato.telefone ? `${conversa.contato.telefone} · ` : ''}
            WhatsApp · {conversa.inbox}
            {/* Sem largura para o "Responsável" ao lado dos botões, ele vem
                aqui — as duas formas se excluem pela MESMA container query. */}
            <span className="[@container(min-width:38rem)]:hidden">
              {` · ${conversa.assignee ? `Resp.: ${conversa.assignee.nome}` : 'Sem responsável'}`}
            </span>
          </p>
        </div>
        {/* Encolhe/trunca antes dos botões (que são shrink-0). */}
        <span className="hidden min-w-0 max-w-[11rem] truncate text-xs text-muted-foreground [@container(min-width:38rem)]:inline">
          {conversa.assignee ? `Responsável: ${conversa.assignee.nome}` : 'Sem responsável'}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={assumir}
            disabled={acao !== null || !conectado}
            className="border border-border bg-transparent px-2.5 hover:bg-muted [@container(min-width:26rem)]:px-4"
            title={conectado ? 'Assumir a conversa' : 'Conecte sua conta para assumir'}
            aria-label={conectado ? 'Assumir a conversa' : 'Conecte sua conta para assumir'}
          >
            {acao === 'assumir' ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            <span className="hidden [@container(min-width:26rem)]:inline">Assumir</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={alternarStatus}
            disabled={acao !== null || !conectado}
            className="bg-foreground px-2.5 text-background hover:bg-foreground/90 [@container(min-width:26rem)]:px-4"
            title={tituloStatus}
            aria-label={tituloStatus}
          >
            {acao === 'status' ? (
              <Spinner className="h-4 w-4" />
            ) : resolvida ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <span className="hidden [@container(min-width:26rem)]:inline">
              {resolvida ? 'Reabrir' : 'Resolver'}
            </span>
          </Button>
          {onAbrirContexto && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onAbrirContexto}
              className="h-9 w-9 2xl:hidden"
              title="Contexto do contato"
              aria-label="Abrir contexto do contato"
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          )}
          {modo === 'overlay' && onFechar && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onFechar}
              className="h-9 w-9"
              title="Fechar"
              aria-label="Fechar conversa"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Thread de mensagens */}
      <div
        ref={rolagemRef}
        onScroll={aoRolar}
        className="flex-1 space-y-3 overflow-y-auto bg-background/40 px-4 py-4"
      >
        {/* Topo da paginação retroativa (histórico). Só aparece com a thread já
            carregada — durante o spinner de tela cheia não há o que paginar. */}
        {!loading && !erro && mensagens.length > 0 && (
          <>
            {carregandoAntigas && (
              <div className="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground">
                <Spinner className="h-3.5 w-3.5" /> Carregando mensagens anteriores…
              </div>
            )}
            {erroAntigas && (
              <div className="flex flex-wrap items-center justify-center gap-2 py-1 text-xs text-muted-foreground">
                <span>{erroAntigas}</span>
                <button
                  type="button"
                  onClick={() => void carregarAntigas()}
                  className="rounded-md border border-border px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Tentar de novo
                </button>
              </div>
            )}
            {fimDoHistorico && (
              <p className="py-1 text-center text-[11px] uppercase tracking-wider text-muted-foreground/70">
                Início da conversa
              </p>
            )}
          </>
        )}
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Carregando mensagens…
          </div>
        ) : erro ? (
          <div className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">
            {erro}
          </div>
        ) : mensagens.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Sem mensagens nesta conversa.</div>
        ) : (
          grupos.map((g) => (
            <div key={g.dia} className="space-y-2">
              <div className="flex justify-center">
                <span className="rounded-full border border-border bg-card px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {rotuloDia(g.dia)}
                </span>
              </div>
              {g.mensagens.map((m) => (
                <MensagemBolha
                  key={m.id}
                  mensagem={m}
                  conversaId={id}
                  telefone={conversa.contato.telefone}
                  conectado={conectado}
                  ancoraId={`msg-${id}-${m.id}`}
                  destacada={destaque === m.id}
                  citada={
                    typeof m.emRespostaA === 'number' ? (porId.get(m.emRespostaA) ?? null) : null
                  }
                  nomeContato={conversa.contato.nome}
                  nomeAgente={nomeAgente}
                  onResponder={responder}
                  onEditar={editar}
                  onIrParaCitada={irParaCitada}
                />
              ))}
            </div>
          ))
        )}
        <div ref={fimRef} />
      </div>

      {/* Rodapé — composer */}
      <div className="border-t border-border bg-card px-4 py-3">
        {!conectado && (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Conecte sua conta do Chatwoot para responder. A leitura funciona sem conectar.
          </p>
        )}

        {/* Seletor de arquivo oculto — acionado pelo botão de clipe (rótulo no botão). */}
        <input
          ref={inputFileRef}
          type="file"
          accept={ACCEPT_ANEXO}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={selecionarArquivo}
        />

        {/* Chip do arquivo selecionado: nome + tamanho + remover. */}
        {arquivo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate" title={arquivo.name}>{arquivo.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatarTamanho(arquivo.size)}</span>
            <button
              type="button"
              onClick={() => setArquivo(null)}
              disabled={enviando}
              aria-label="Remover arquivo"
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Modo RESPOSTA: faixa de citação acima do campo (padrão WhatsApp).
            aria-live: quem usa leitor de tela clica "Responder" e o foco vai pro
            campo — sem o aviso, a faixa apareceria calada. */}
        {citacaoComposer && (
          <div className="mb-2" aria-live="polite">
            <BlocoCitacao
              autor={citacaoComposer.autor}
              trecho={citacaoComposer.trecho}
              midia={citacaoComposer.midia}
              aoCancelar={() => setRespondendo(null)}
            />
          </div>
        )}

        {/* Modo EDIÇÃO: mesma faixa da citação (mesma peça, mesmo lugar), com o
            texto ATUAL da mensagem — a referência de "o que estou corrigindo"
            continua visível mesmo depois de o campo ser todo reescrito. */}
        {editando && (
          <div className="mb-2" aria-live="polite">
            <BlocoCitacao
              autor="Editando mensagem"
              trecho={editando.conteudo}
              aoCancelar={cancelarEdicao}
              rotuloCancelar="Cancelar edição"
            />
          </div>
        )}

        <Textarea
          ref={textareaRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={!conectado || enviando}
          placeholder={
            editando
              ? 'Corrija o texto da mensagem…'
              : notaInterna
                ? 'Escreva uma nota interna (não vai pro WhatsApp)…'
                : arquivo
                  ? 'Legenda do documento (opcional)…'
                  : 'Digite sua mensagem...'
          }
          className={cn('min-h-[70px] rounded-xl', notaInterna && 'border-warning/50 bg-warning/5')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void enviar()
            }
          }}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            // Nota interna não leva anexo: ao ligar, descarta o arquivo pendente.
            onClick={() => setNotaInterna((v) => { if (!v) setArquivo(null); return !v })}
            aria-pressed={notaInterna}
            // Editar mexe numa mensagem que JÁ está no WhatsApp: nota interna não
            // se aplica (e trocaria o destino do que está no campo).
            disabled={!!editando}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
              notaInterna
                ? 'border-warning/50 bg-warning/10 text-warning'
                : 'border-border bg-background text-muted-foreground hover:border-ring',
            )}
          >
            <StickyNote className="h-3.5 w-3.5" />
            Nota interna
          </button>
          {notaInterna && (
            <span className="text-[11px] font-medium text-warning">Não vai pro WhatsApp — visível só para a equipe.</span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => inputFileRef.current?.click()}
              disabled={!conectado || enviando || notaInterna || !!editando}
              className="border border-border bg-transparent hover:bg-muted"
              title={
                editando
                  ? 'Termine ou cancele a edição para anexar'
                  : notaInterna
                    ? 'Anexos não vão em nota interna'
                    : conectado
                      ? 'Anexar arquivo do computador'
                      : 'Conecte sua conta para anexar'
              }
              aria-label="Anexar arquivo"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">⌘+↵ para enviar</span>
            <Button
              variant="default"
              size="sm"
              onClick={enviar}
              loading={enviando}
              disabled={!conectado || (!texto.trim() && !arquivo)}
              className="bg-foreground text-background hover:bg-foreground/90"
              title={
                conectado
                  ? editando
                    ? 'Salvar edição (Ctrl/Cmd+Enter)'
                    : 'Enviar (Ctrl/Cmd+Enter)'
                  : 'Conecte sua conta para responder'
              }
            >
              {!enviando && (editando ? <Pencil className="h-4 w-4" /> : <Send className="h-4 w-4" />)}
              {editando ? 'Salvar edição' : notaInterna ? 'Salvar nota' : 'Enviar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
