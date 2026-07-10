'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Lock,
  PanelRightOpen,
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
import type { Conversa, Mensagem, RespostaMensagens } from '@/lib/conversas/tipos'
import { MensagemBolha } from './MensagemBolha'
import { codeDoErro, mensagemErroRelay, rotuloDia } from './erros'

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
  onListaMudou,
  onAgenteDesconectado,
  onFechar,
  onAbrirContexto,
}: {
  conversa: Conversa
  conectado: boolean
  modo: 'inline' | 'overlay'
  onListaMudou: () => void
  onAgenteDesconectado: () => void
  onFechar?: () => void
  /** Abre o painel de contexto como overlay (visível só abaixo de xl). */
  onAbrirContexto?: () => void
}) {
  const { success, error: toastError } = useToast()
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [texto, setTexto] = useState('')
  const [notaInterna, setNotaInterna] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [acao, setAcao] = useState<'assumir' | 'status' | null>(null)

  const fimRef = useRef<HTMLDivElement>(null)
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
      setMensagens((d as RespostaMensagens).mensagens ?? [])
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

  // Atualização automática da conversa aberta: revalida em silêncio a cada 7s
  // (aba visível). Não mexe no composer (estado separado) e o auto-scroll abaixo
  // só dispara quando chega mensagem NOVA — ler histórico não é interrompido.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void carregar(true)
    }, 7_000)
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

  /** Trata um 428 (agente não conectado) de qualquer escrita. */
  function tratou428(status: number, data: unknown): boolean {
    if (status === 428 || codeDoErro(data) === 'AGENT_NOT_CONNECTED') {
      onAgenteDesconectado()
      toastError('Conecte sua conta', 'Conecte sua conta do Chatwoot para responder.')
      return true
    }
    return false
  }

  async function enviar() {
    const content = texto.trim()
    if (!content || enviando) return
    setEnviando(true)
    try {
      const r = await fetch(`/api/conversas/${id}/mensagens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, private: notaInterna }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (!tratou428(r.status, d)) toastError('Não enviado', mensagemErroRelay(r.status, d))
        return
      }
      setTexto('')
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

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card',
        modo === 'overlay' ? 'fixed inset-0 z-50 rounded-none' : 'h-full',
      )}
    >
      {/* Cabeçalho do contato */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <AvatarContato nome={nome} avatarUrl={conversa.contato.avatarUrl} className="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <h2 className="min-w-0 truncate font-semibold text-foreground">{nome}</h2>
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {conversa.contato.telefone ? `${conversa.contato.telefone} · ` : ''}
            WhatsApp · {conversa.inbox}
            {/* No overlay (< lg) o "Responsável" do lado direito fica oculto;
                mostra aqui para a informação existir no mobile. */}
            {modo === 'overlay' &&
              ` · ${conversa.assignee ? `Resp.: ${conversa.assignee.nome}` : 'Sem responsável'}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden max-w-[180px] truncate text-xs text-muted-foreground lg:inline">
            {conversa.assignee ? `Responsável: ${conversa.assignee.nome}` : 'Sem responsável'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={assumir}
            disabled={acao !== null || !conectado}
            className="border border-border bg-transparent hover:bg-muted"
            title={conectado ? 'Assumir a conversa' : 'Conecte sua conta para assumir'}
          >
            {acao === 'assumir' ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            <span className="hidden sm:inline">Assumir</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={alternarStatus}
            disabled={acao !== null || !conectado}
            className="bg-foreground text-background hover:bg-foreground/90"
            title={
              !conectado
                ? `Conecte sua conta para ${resolvida ? 'reabrir' : 'resolver'}`
                : resolvida
                  ? 'Reabrir a conversa'
                  : 'Resolver a conversa'
            }
          >
            {acao === 'status' ? (
              <Spinner className="h-4 w-4" />
            ) : resolvida ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{resolvida ? 'Reabrir' : 'Resolver'}</span>
          </Button>
          {onAbrirContexto && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onAbrirContexto}
              className="xl:hidden"
              title="Contexto do contato"
              aria-label="Abrir contexto do contato"
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          )}
          {modo === 'overlay' && onFechar && (
            <Button variant="ghost" size="icon" onClick={onFechar} title="Fechar" aria-label="Fechar conversa">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Thread de mensagens */}
      <div className="flex-1 space-y-3 overflow-y-auto bg-background/40 px-4 py-4">
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
                <MensagemBolha key={m.id} mensagem={m} />
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
            Conecte sua conta do Chatwoot (acima) para responder. A leitura funciona sem conectar.
          </p>
        )}

        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={!conectado || enviando}
          placeholder={notaInterna ? 'Escreva uma nota interna (não vai pro WhatsApp)…' : 'Digite sua mensagem...'}
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
            onClick={() => setNotaInterna((v) => !v)}
            aria-pressed={notaInterna}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
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
            <span className="hidden text-[11px] text-muted-foreground sm:inline">⌘+↵ para enviar</span>
            <Button
              variant="default"
              size="sm"
              onClick={enviar}
              loading={enviando}
              disabled={!conectado || !texto.trim()}
              className="bg-foreground text-background hover:bg-foreground/90"
              title={conectado ? 'Enviar (Ctrl/Cmd+Enter)' : 'Conecte sua conta para responder'}
            >
              {!enviando && <Send className="h-4 w-4" />}
              {notaInterna ? 'Salvar nota' : 'Enviar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
