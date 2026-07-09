'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Lock,
  RotateCcw,
  Send,
  StickyNote,
  UserPlus,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn, iniciais } from '@/lib/utils'
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
}: {
  conversa: Conversa
  conectado: boolean
  modo: 'inline' | 'overlay'
  onListaMudou: () => void
  onAgenteDesconectado: () => void
  onFechar?: () => void
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

  // Rola para o fim quando as mensagens mudam.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' })
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
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary"
        >
          {iniciais(nome)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 truncate font-semibold text-foreground">{nome}</h2>
            <Badge variant={conversa.inbox === 'DF' ? 'default' : 'accent'} className="px-2 py-0 text-[11px]">
              {conversa.inbox}
            </Badge>
            <Badge variant={resolvida ? 'success' : 'secondary'} className="px-2 py-0 text-[11px]">
              {resolvida ? 'Resolvida' : 'Aberta'}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {conversa.assignee ? `Responsável: ${conversa.assignee.nome}` : 'Sem responsável'}
            {conversa.contato.nome && conversa.contato.telefone ? ` · ${conversa.contato.telefone}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={assumir}
            disabled={acao !== null || !conectado}
            title={conectado ? 'Assumir a conversa' : 'Conecte sua conta para assumir'}
          >
            {acao === 'assumir' ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            <span className="hidden sm:inline">Assumir</span>
          </Button>
          <Button
            variant={resolvida ? 'secondary' : 'ghost'}
            size="sm"
            onClick={alternarStatus}
            disabled={acao !== null || !conectado}
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
                <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
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

      {/* Rodapé — caixa de resposta */}
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
          placeholder={notaInterna ? 'Escreva uma nota interna (não vai pro WhatsApp)…' : 'Escreva uma mensagem…'}
          className={cn('min-h-[70px]', notaInterna && 'border-warning/50 bg-warning/5')}
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
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
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

          <div className="ml-auto">
            <Button
              variant={notaInterna ? 'secondary' : 'default'}
              size="sm"
              onClick={enviar}
              loading={enviando}
              disabled={!conectado || !texto.trim()}
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
