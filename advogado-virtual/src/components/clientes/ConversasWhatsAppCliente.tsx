'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import {
  MessageCircle, ChevronDown, ChevronRight, ArrowLeft,
  ExternalLink, RotateCcw, Phone,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { AvatarContato } from '@/components/conversas/AvatarContato'
import { MensagemBolha } from '@/components/conversas/MensagemBolha'
import { mensagemErroRelay, rotuloDia } from '@/components/conversas/erros'
import { agrupadorDia, dataHoraCurta } from '@/lib/conversas/formato'
import type { Conversa, Mensagem, RespostaMensagens } from '@/lib/conversas/tipos'

// Card "Conversas no WhatsApp" do dossiê. Carrega SOB DEMANDA (lazy): só busca o
// relay ao expandir pela primeira vez (o dono clica em "Ver conversas"), para não
// pesar o load do dossiê nem o relay em cada visita. Lista as conversas casadas
// pelo telefone; clicar numa abre o histórico completo em modo leitura (sem
// composer — o envio continua no /conversas e no modal do atendimento).

interface RespostaLista {
  semTelefone?: boolean
  conversas?: Conversa[]
}

/** Agrupa mensagens consecutivas por dia (mesma lógica visual da Thread). */
function agruparPorDia(mensagens: Mensagem[]): { dia: string; mensagens: Mensagem[] }[] {
  const grupos: { dia: string; mensagens: Mensagem[] }[] = []
  for (const m of mensagens) {
    const dia = agrupadorDia(m.timestamp)
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.dia === dia) ultimo.mensagens.push(m)
    else grupos.push({ dia, mensagens: [m] })
  }
  return grupos
}

export function ConversasWhatsAppCliente({ clienteId }: { clienteId: string }) {
  const [expandido, setExpandido] = useState(false)
  const [carregou, setCarregou] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [semTelefone, setSemTelefone] = useState(false)
  const [conversas, setConversas] = useState<Conversa[]>([])

  // Conversa aberta (histórico completo) + estado do fetch das mensagens.
  const [abertaId, setAbertaId] = useState<number | null>(null)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [carregandoMsgs, setCarregandoMsgs] = useState(false)
  const [erroMsgs, setErroMsgs] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const r = await fetch(`/api/clientes/${clienteId}/conversas`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(mensagemErroRelay(r.status, d))
        return
      }
      const dd = d as RespostaLista
      setSemTelefone(Boolean(dd.semTelefone))
      setConversas(dd.conversas ?? [])
      setCarregou(true)
    } catch {
      setErro('Falha de rede ao carregar as conversas.')
    } finally {
      setLoading(false)
    }
  }, [clienteId])

  function alternar() {
    const abrir = !expandido
    setExpandido(abrir)
    // Lazy: só busca na primeira abertura (ou após um erro, ao reabrir).
    if (abrir && !carregou && !loading) void carregar()
  }

  const abrirConversa = useCallback(async (id: number) => {
    setAbertaId(id)
    setMensagens([])
    setErroMsgs(null)
    setCarregandoMsgs(true)
    try {
      const r = await fetch(`/api/conversas/${id}/mensagens`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErroMsgs(mensagemErroRelay(r.status, d))
        return
      }
      setMensagens((d as RespostaMensagens).mensagens ?? [])
    } catch {
      setErroMsgs('Falha de rede ao carregar as mensagens.')
    } finally {
      setCarregandoMsgs(false)
    }
  }, [])

  const aberta = abertaId !== null ? conversas.find((c) => c.id === abertaId) ?? null : null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4 text-primary" />
          Conversas no WhatsApp
          {carregou && !semTelefone && conversas.length > 0 && (
            <span className="font-normal text-muted-foreground">({conversas.length})</span>
          )}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={alternar} aria-expanded={expandido}>
          {expandido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {expandido ? 'Ocultar' : 'Ver conversas'}
        </Button>
      </CardHeader>

      {expandido && (
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Carregando conversas…
            </div>
          ) : erro ? (
            <div className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-4 py-4 text-sm text-destructive">
              <p>{erro}</p>
              <Button variant="ghost" size="sm" onClick={() => void carregar()} className="mt-2">
                <RotateCcw className="h-4 w-4" /> Tentar de novo
              </Button>
            </div>
          ) : semTelefone ? (
            <p className="py-3 text-sm text-muted-foreground italic">
              Cadastre o telefone (WhatsApp) do cliente para ver o histórico das conversas.{' '}
              <Link href={`/clientes/${clienteId}/editar`} className="text-primary not-italic hover:underline">
                Adicionar telefone
              </Link>
            </p>
          ) : aberta ? (
            <ThreadLeitura
              conversa={aberta}
              mensagens={mensagens}
              carregando={carregandoMsgs}
              erro={erroMsgs}
              onVoltar={() => setAbertaId(null)}
              onTentarDeNovo={() => void abrirConversa(aberta.id)}
            />
          ) : conversas.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground italic">
              Nenhuma conversa de WhatsApp encontrada para este telefone. As conversas aparecem aqui
              quando o cliente fala com o escritório pelo WhatsApp.
            </p>
          ) : (
            <ul className="space-y-2">
              {conversas.map((c) => (
                <li key={c.id}>
                  <LinhaConversa conversa={c} onAbrir={() => void abrirConversa(c.id)} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  )
}

/** Uma conversa na lista: avatar, nome, status, prévia da última mensagem e quando. */
function LinhaConversa({ conversa, onAbrir }: { conversa: Conversa; onAbrir: () => void }) {
  const nome = conversa.contato.nome || conversa.contato.telefone || `Conversa #${conversa.id}`
  const previa = conversa.ultimaMensagem?.trecho || 'Sem prévia'
  const quando = conversa.ultimaMensagem ? dataHoraCurta(conversa.ultimaMensagem.timestamp) : ''
  const resolvida = conversa.status === 'resolved'

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-ring hover:bg-muted/40"
    >
      <AvatarContato nome={nome} avatarUrl={conversa.contato.avatarUrl} className="h-9 w-9" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate font-medium text-foreground">{nome}</span>
          <Badge variant={resolvida ? 'secondary' : 'warning'} className="shrink-0 text-xs px-1.5 py-0">
            {resolvida ? 'Resolvida' : 'Aberta'}
          </Badge>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
            {conversa.inbox}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{previa}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {quando && <span className="text-[11px] text-muted-foreground">{quando}</span>}
        {conversa.naoLidas > 0 && (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
            {conversa.naoLidas}
          </span>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-border" />
    </button>
  )
}

/** Histórico completo de uma conversa em modo LEITURA (sem composer). */
function ThreadLeitura({
  conversa,
  mensagens,
  carregando,
  erro,
  onVoltar,
  onTentarDeNovo,
}: {
  conversa: Conversa
  mensagens: Mensagem[]
  carregando: boolean
  erro: string | null
  onVoltar: () => void
  onTentarDeNovo: () => void
}) {
  const nome = conversa.contato.nome || conversa.contato.telefone || `Conversa #${conversa.id}`
  const grupos = agruparPorDia(mensagens)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onVoltar}
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </button>
        <div className="flex items-center gap-2">
          {conversa.contato.telefone && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <Phone className="h-3 w-3" /> {conversa.contato.telefone}
            </span>
          )}
          <Button asChild variant="secondary" size="sm">
            {/* Deep-link do /conversas: abre a conversa selecionada (funciona para
                conversas abertas — a lista do /conversas começa por elas). */}
            <Link href={`/conversas?conversa=${conversa.id}`}>
              <ExternalLink className="h-4 w-4" /> Abrir no Conversas
            </Link>
          </Button>
        </div>
      </div>

      <p className="mb-2 truncate text-sm font-semibold text-foreground">{nome}</p>

      <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-lg border border-border bg-background/40 px-4 py-4">
        {carregando ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Carregando mensagens…
          </div>
        ) : erro ? (
          <div className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-4 py-6 text-center text-sm text-destructive">
            <p>{erro}</p>
            <Button variant="ghost" size="sm" onClick={onTentarDeNovo} className="mt-2">
              <RotateCcw className="h-4 w-4" /> Tentar de novo
            </Button>
          </div>
        ) : mensagens.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sem mensagens nesta conversa.</p>
        ) : (
          grupos.map((g) => (
            <div key={g.dia} className="space-y-2">
              <div className="flex justify-center">
                <span className="rounded-full border border-border bg-card px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {rotuloDia(g.dia)}
                </span>
              </div>
              {g.mensagens.map((m) => (
                <MensagemBolha key={m.id} mensagem={m} somenteLeitura />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
