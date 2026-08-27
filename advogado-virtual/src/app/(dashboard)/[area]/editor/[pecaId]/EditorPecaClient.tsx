'use client'

import { useState, useRef, useEffect, useLayoutEffect, type ComponentProps } from 'react'
import { useRouter } from 'next/navigation'
import { DocumentEditor } from '@/components/document-editor/DocumentEditor'
import { RelatorioValidacao } from '@/components/pecas/RelatorioValidacao'
import { SeloCitacoes } from '@/components/pecas/SeloCitacoes'
import { ComparadorSecoes } from '@/components/pecas/ComparadorSecoes'
import { PainelSessaoPeca } from '@/components/pecas/sessao/PainelSessaoPeca'
import { useSessaoPeca } from '@/components/pecas/sessao/useSessaoPeca'
import { useStreaming } from '@/components/shared/StreamingText'
import { formatarPeca } from '@/lib/format/formatar-peca'
import { salvarPecaComGuarda } from '@/lib/ia/pecas/salvar-peca-client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Send, CheckCircle, Clock, ClipboardCheck, X, Loader2, GitCompare, Paperclip, Sparkles } from 'lucide-react'

type ValidacaoData = ComponentProps<typeof RelatorioValidacao>['data']

interface EditorPecaClientProps {
  pecaId: string
  atendimentoId: string
  clienteId?: string
  area: string
  tipo: string
  tipoNome: string
  conteudoInicial: string
  versaoInicial: number
  statusInicial: string
  validacaoInicial?: ValidacaoData | null
  /** Já existe um .docx desta peça anexado aos documentos do caso (080). */
  materializada?: boolean
}

// Preferência por navegador: quem fecha o painel da sessão não quer vê-lo
// de volta a cada peça aberta. Fora do React (localStorage falha em modo
// privado/iframe) e lida em layout effect — no HTML do servidor ele não existe.
const SESSAO_RECOLHIDA_KEY = 'pecas.sessao.recolhido'

function lerSessaoRecolhida(): boolean {
  try {
    return localStorage.getItem(SESSAO_RECOLHIDA_KEY) !== '0'
  } catch {
    return true
  }
}

const PRAZO_OPTIONS = [
  { label: '24 horas',  days: 1 },
  { label: '2 dias',    days: 2 },
  { label: '3 dias',    days: 3 },
  { label: '5 dias',    days: 5 },
  { label: '1 semana',  days: 7 },
  { label: '2 semanas', days: 14 },
]

export function EditorPecaClient({
  pecaId,
  atendimentoId,
  clienteId,
  area,
  tipo,
  tipoNome,
  conteudoInicial,
  statusInicial,
  validacaoInicial,
  materializada,
}: EditorPecaClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [salvando, setSalvando]       = useState(false)
  const [enviando, setEnviando]       = useState(false)
  const [status, setStatus]           = useState(statusInicial)
  const [menuOpen, setMenuOpen]       = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Conteúdo atual da peça — pode ser substituído por uma correção automática.
  // editorKey força o remount do DocumentEditor quando o conteúdo é reescrito.
  const [conteudoAtual, setConteudoAtual] = useState(conteudoInicial)
  const [editorKey, setEditorKey]         = useState(0)

  // Painel de revisão automática (validar → corrigir)
  const [painelAberto, setPainelAberto] = useState(false)
  const [validando, setValidando]       = useState(false)
  // Inicia com a revisão já gravada (auto ou manual), se houver.
  const [validacao, setValidacao]       = useState<ValidacaoData | null>(validacaoInicial ?? null)
  const [corrigindo, setCorrigindo]     = useState<string | null>(null)
  const { startStream } = useStreaming()

  // Sessão de lapidação (Motor v3 / F0.4). O hook mora AQUI, e não dentro do
  // painel: a conversa sobrevive ao remount do editor (que acontece a cada
  // proposta aplicada) e o badge de proposta pendente existe com o painel
  // fechado.
  const sessao = useSessaoPeca({ pecaId, atendimentoId })
  const [painelSessao, setPainelSessao] = useState(false)

  useLayoutEffect(() => {
    setPainelSessao(!lerSessaoRecolhida())
  }, [])

  function definirPainelSessao(aberto: boolean) {
    setPainelSessao(aberto)
    try {
      localStorage.setItem(SESSAO_RECOLHIDA_KEY, aberto ? '0' : '1')
    } catch { /* ignore */ }
  }

  // Vindo do refinamento (?abrirSessao=1): abre o painel e, se não houver
  // sessão ativa, cria uma. O parâmetro sai da URL para não repetir a criação
  // num F5. Lido do window (e não de useSearchParams) para não obrigar a
  // página a uma fronteira de Suspense no build.
  const [abrirPedido, setAbrirPedido] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('abrirSessao') !== '1') return
    setAbrirPedido(true)
    definirPainelSessao(true)
    params.delete('abrirSessao')
    const busca = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${busca ? `?${busca}` : ''}`)
  }, [])

  const criouSessaoRef = useRef(false)
  const { carregando: sessaoCarregando, sessao: sessaoAtiva, criarSessao } = sessao
  useEffect(() => {
    if (!abrirPedido || sessaoCarregando || sessaoAtiva || criouSessaoRef.current) return
    criouSessaoRef.current = true
    void criarSessao('padrao')
  }, [abrirPedido, sessaoCarregando, sessaoAtiva, criarSessao])

  // Uma proposta virou versão nova: o texto autoritativo está no servidor.
  async function recarregarPeca() {
    try {
      const res = await fetch(`/api/pecas/${pecaId}`)
      if (res.ok) {
        const data = await res.json()
        const novo = (data.peca?.conteudo_markdown as string | undefined) ?? ''
        setConteudoAtual(novo)
        setEditorKey((k) => k + 1)
      }
    } catch {
      toastError('Peça atualizada', 'Não foi possível recarregar o texto — recarregue a página.')
    }
    // Cabeçalho (v{n}) e histórico de versões vêm do servidor.
    router.refresh()
  }

  // Comparador de versões (E9): base = versão anterior carregada sob demanda.
  const [comparando, setComparando]     = useState<{ base: string; versao?: number } | null>(null)
  const [carregandoComp, setCarregandoComp] = useState(false)

  async function handleComparar() {
    setCarregandoComp(true)
    try {
      const res = await fetch(`/api/pecas/${pecaId}/versao-anterior`)
      const data = await res.json()
      if (!res.ok || !data.temVersao) {
        success('Sem versão anterior', 'Esta peça ainda não tem histórico para comparar (gere uma correção ou refino antes).')
        return
      }
      setComparando({ base: data.conteudo, versao: data.versao })
    } catch {
      toastError('Erro', 'Falha ao carregar a versão anterior.')
    } finally {
      setCarregandoComp(false)
    }
  }

  async function handleAplicarComparacao(markdown: string) {
    setComparando(null)
    await handleSalvar(markdown)
    setConteudoAtual(markdown)
    setEditorKey((k) => k + 1)
    success('Alterações aplicadas', 'As escolhas por seção foram salvas na peça.')
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  async function handleSalvar(conteudo: string, opts?: { silencioso?: boolean }) {
    const silencioso = opts?.silencioso ?? false
    if (!silencioso) setSalvando(true)
    try {
      // Autosave (silencioso) não versiona e não passa pela guarda anti-encolhimento.
      const r = await salvarPecaComGuarda({ pecaId, conteudo, semVersao: silencioso })
      if (r.ok) {
        setConteudoAtual(conteudo)
        if (!silencioso) success('Peça salva!', 'Conteúdo salvo com sucesso.')
      } else if (!silencioso && !r.cancelado) {
        toastError('Erro ao salvar', r.erro)
      }
    } finally {
      if (!silencioso) setSalvando(false)
    }
  }

  // Revisão automática por IA (coerência, citações, score) + checagem
  // determinística de formatação forense. Sob demanda para não gastar cota a
  // cada abertura do editor.
  async function handleRevisar(opts?: { auto?: boolean }) {
    const auto = opts?.auto ?? false
    if (!auto) {
      setValidando(true)
      setPainelAberto(true)
      setValidacao(null)
    }
    try {
      const res = await fetch('/api/ia/validar-peca', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pecaId, auto }),
      })
      const data = await res.json()
      if (!res.ok) {
        // No modo auto (background) falha em silêncio — não incomoda o usuário.
        if (!auto) {
          toastError('Erro na revisão', data.error ?? 'Tente novamente')
          setPainelAberto(false)
        }
        return
      }
      setValidacao(data as ValidacaoData)
      if (!auto) setStatus((s) => (s === 'rascunho' ? 'revisada' : s))
    } catch {
      if (!auto) {
        toastError('Erro', 'Falha de rede na revisão')
        setPainelAberto(false)
      }
    } finally {
      if (!auto) setValidando(false)
    }
  }

  // Revisão automática DESACOPLADA da geração: se a peça ainda não tem revisão,
  // dispara uma vez em background (chamada separada, própria — não pesa no tempo
  // da geração). Só com conteúdo relevante (não revisa peça vazia/truncada).
  const autoRevisaoRef = useRef(false)
  useEffect(() => {
    if (!validacaoInicial && !autoRevisaoRef.current && (conteudoInicial?.trim().length ?? 0) > 200) {
      autoRevisaoRef.current = true
      handleRevisar({ auto: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Correção de um clique: reescreve a peça aplicando a correção sugerida,
  // persiste (salvar-peca versiona a anterior) e remonta o editor.
  async function handleCorrecao(tipo: string) {
    setCorrigindo(tipo)
    try {
      const resultado = await startStream('/api/ia/correcao-auto', { pecaId, tipo })
      // Sem resultado OU stream incompleto (queda de conexão): mantém a peça
      // original intacta — não sobrescreve com um texto parcial.
      if (!resultado || resultado.completo === false) {
        toastError('Correção interrompida', 'A conexão caiu durante a correção — a peça original foi mantida. Tente novamente.')
        return
      }
      const corrigido = formatarPeca(resultado.fullText)
      const r = await salvarPecaComGuarda({ pecaId, conteudo: corrigido })
      if (!r.ok) {
        if (!r.cancelado) toastError('Erro ao salvar', r.erro)
        return
      }
      setConteudoAtual(corrigido)
      setEditorKey((k) => k + 1)
      setPainelAberto(false)
      setValidacao(null)
      success('Correção aplicada', 'A peça foi atualizada. Clique em "Revisar peça" para validar de novo.')
    } catch {
      toastError('Erro', 'Falha ao aplicar a correção.')
    } finally {
      setCorrigindo(null)
    }
  }

  async function handleEnviarRevisao(days: number) {
    setMenuOpen(false)
    setEnviando(true)
    try {
      const prazo = new Date()
      prazo.setDate(prazo.getDate() + days)

      const res = await fetch(`/api/pecas/${pecaId}/enviar-revisao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prazo_revisao: prazo.toISOString() }),
      })
      if (res.ok) {
        setStatus('aguardando_revisao')
        success('Enviada para revisão!', `Prazo: ${days === 1 ? '24 horas' : `${days} dias`}. Tarefa criada no kanban.`)
      } else {
        const data = await res.json()
        toastError('Erro', data.error ?? 'Não foi possível enviar para revisão')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setEnviando(false)
    }
  }

  const botaoRevisao = status === 'rascunho' ? (
    <div className="relative" ref={menuRef}>
      <Button
        size="sm"
        variant="accent"
        onClick={() => setMenuOpen(v => !v)}
        disabled={enviando}
        className="gap-1.5"
      >
        <Send className="h-4 w-4" />
        {enviando ? 'Enviando...' : 'Enviar para Revisão'}
      </Button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-border bg-card p-2 shadow-elevated">
          <p className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Prazo para revisão
          </p>
          {PRAZO_OPTIONS.map(opt => (
            <button
              key={opt.days}
              onClick={() => handleEnviarRevisao(opt.days)}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : status === 'aguardando_revisao' ? (
    <div className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">
      <CheckCircle className="h-3.5 w-3.5" />
      Aguardando Revisão
    </div>
  ) : null

  // Badge da revisão automática (aparece quando há score gravado pós-geração).
  const scoreRevisao = validacao?.score_confianca
  const badgeRevisao = scoreRevisao !== undefined && !validando && !painelAberto ? (
    <button
      onClick={() => setPainelAberto(true)}
      title="Ver revisão automática da peça"
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        scoreRevisao >= 80
          ? 'bg-success/10 text-success hover:bg-success/20'
          : scoreRevisao >= 60
            ? 'bg-warning/10 text-warning hover:bg-warning/20'
            : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
      }`}
    >
      <ClipboardCheck className="h-3.5 w-3.5" />
      Revisão {scoreRevisao}
    </button>
  ) : null

  // Selo de citações verificadas (E1): aparece quando a revisão trouxe citações.
  const seloCitacoes = !validando && !painelAberto && validacao?.citacoes && validacao.citacoes.total > 0
    ? <SeloCitacoes citacoes={validacao.citacoes} onClick={() => setPainelAberto(true)} />
    : null

  // Aviso discreto: a peça já foi materializada num .docx dentro dos documentos do
  // caso (080). Link ao dossiê do cliente, onde a árvore lista o arquivo.
  const avisoAnexada = materializada && clienteId ? (
    <a
      href={`/clientes/${clienteId}`}
      title="Ver nos documentos do caso"
      className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
    >
      <Paperclip className="h-3.5 w-3.5" />
      Anexada aos documentos do caso
    </a>
  ) : null

  // Lapidar com IA: abre/fecha o painel da sessão. O badge avisa que existe
  // uma proposta esperando decisão mesmo com o painel fechado.
  const botaoSessao = (
    <div className="relative">
      <Button
        size="sm"
        variant={painelSessao ? 'secondary' : 'ghost'}
        onClick={() => definirPainelSessao(!painelSessao)}
        className="gap-1.5"
        title="Conversar com a IA sobre esta peça, com o dossiê do caso"
      >
        <Sparkles className="h-4 w-4" />
        Lapidar com IA
      </Button>
      {sessao.propostaPendente && !painelSessao && (
        <span
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
          title="Há uma proposta aguardando sua decisão"
        >
          1
        </span>
      )}
    </div>
  )

  const acoes = (
    <div className="flex items-center gap-2">
      {avisoAnexada}
      {botaoSessao}
      {seloCitacoes}
      {badgeRevisao}
      <Button
        size="sm"
        variant="ghost"
        onClick={handleComparar}
        disabled={carregandoComp || corrigindo !== null}
        className="gap-1.5"
        title="Comparar com a versão anterior, seção a seção"
      >
        {carregandoComp ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
        Comparar
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => handleRevisar()}
        disabled={validando || corrigindo !== null}
        className="gap-1.5"
      >
        {validando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
        {validando ? 'Revisando...' : 'Revisar peça'}
      </Button>
      {botaoRevisao}
    </div>
  )

  return (
    <>
      <DocumentEditor
        key={editorKey}
        titulo={tipoNome ?? tipo}
        conteudo={conteudoAtual}
        onVoltar={() => {
          router.push(
            clienteId && atendimentoId
              ? `/clientes/${clienteId}/casos/${atendimentoId}`
              : `/${area}`
          )
          router.refresh()
        }}
        onSalvar={handleSalvar}
        salvando={salvando}
        extraAcoes={acoes}
        pecaId={pecaId}
        painelTitulo="Lapidação com IA"
        onFecharPainel={() => definirPainelSessao(false)}
        onEnviarParaSessao={
          sessao.sessao && !sessao.encerrada
            ? (instrucao) => {
                definirPainelSessao(true)
                void sessao.enviar(instrucao)
              }
            : undefined
        }
        painelLateral={
          painelSessao ? (
            <PainelSessaoPeca
              sessao={sessao}
              conteudoAtual={conteudoAtual}
              temCaso={Boolean(atendimentoId)}
              onAplicada={(versao) => {
                if (versao != null) void recarregarPeca()
              }}
            />
          ) : undefined
        }
      />

      {/* Painel de revisão automática (validar → corrigir) */}
      {painelAberto && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !corrigindo && setPainelAberto(false)} />
          <aside className="relative flex w-full max-w-md flex-col overflow-hidden bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold text-foreground">
                <ClipboardCheck className="h-4 w-4 text-primary" />
                Revisão automática
              </h2>
              <button
                onClick={() => !corrigindo && setPainelAberto(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                disabled={corrigindo !== null}
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {corrigindo ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <p className="text-sm">Aplicando correção e reescrevendo a peça...</p>
                </div>
              ) : validando ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <p className="text-sm">Analisando a peça (coerência, citações e formatação)...</p>
                </div>
              ) : validacao ? (
                <RelatorioValidacao data={validacao} onCorrecao={handleCorrecao} />
              ) : null}
            </div>
          </aside>
        </div>
      )}

      {/* Comparador de seções (E9) */}
      {comparando && (
        <ComparadorSecoes
          base={comparando.base}
          atual={conteudoAtual}
          versaoBase={comparando.versao}
          onAplicar={handleAplicarComparacao}
          onFechar={() => setComparando(null)}
        />
      )}
    </>
  )
}
