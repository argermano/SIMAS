'use client'

// A conversa da sessão de lapidação: instruções do advogado, respostas do
// agente e as linhas de sistema (anexos, decisões, compactação, erros).
//
// O turno de SISTEMA é deliberadamente discreto: ele existe para o advogado
// entender por que o agente "esqueceu" o começo da conversa ou o que foi aceito
// na proposta anterior — não para disputar atenção com o texto da peça.

import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { SeloCitacoes, type ResumoCitacoes } from '@/components/pecas/SeloCitacoes'
import type { TurnoPeca } from '@/lib/ia/sessao/sessoes'
import { AlertTriangle, Loader2, Paperclip, Scissors, Sparkles, SquareCheck } from 'lucide-react'

function hora(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Markdown enxuto — o texto do agente é conversa, não a peça. */
export function MarkdownTurno({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <p className="mb-1 mt-2 text-sm font-semibold text-foreground">{children}</p>,
        h2: ({ children }) => <p className="mb-1 mt-2 text-sm font-semibold text-foreground">{children}</p>,
        h3: ({ children }) => <p className="mb-1 mt-2 text-sm font-semibold text-foreground">{children}</p>,
        p: ({ children }) => <p className="mb-2 text-sm leading-relaxed text-foreground last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="text-sm leading-relaxed text-foreground">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        code: ({ children }) => (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">{children}</blockquote>
        ),
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

function IconeSistema({ turno }: { turno: TurnoPeca }) {
  const classe = 'h-3.5 w-3.5 shrink-0'
  if (turno.tipo === 'erro') return <AlertTriangle className={`${classe} text-destructive`} />
  if (turno.tipo === 'anexo') return <Paperclip className={classe} />
  if (turno.tipo === 'proposta') return <SquareCheck className={classe} />
  if (turno.payload?.compactacao) return <Scissors className={classe} />
  return <Sparkles className={classe} />
}

function TurnoSistema({ turno }: { turno: TurnoPeca }) {
  const erro = turno.tipo === 'erro'
  return (
    <div
      className={`flex items-start gap-1.5 px-1 py-1 text-[11px] leading-snug ${
        erro ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      <IconeSistema turno={turno} />
      <span className="whitespace-pre-wrap">{turno.conteudo}</span>
    </div>
  )
}

function TurnoAdvogado({ turno }: { turno: TurnoPeca }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary/10 px-3 py-2">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{turno.conteudo}</p>
        <p className="mt-1 text-right text-[10px] text-muted-foreground">{hora(turno.criado_em)}</p>
      </div>
    </div>
  )
}

function TurnoAgente({ turno }: { turno: TurnoPeca }) {
  const citacoes = turno.payload?.citacoes as ResumoCitacoes | undefined
  const degradado = Boolean(turno.payload?.degradado)
  const cortado = turno.payload?.stop_reason === 'max_tokens'

  return (
    <div className="rounded-2xl rounded-bl-md border border-border bg-card px-3 py-2">
      <MarkdownTurno>{turno.conteudo ?? ''}</MarkdownTurno>

      {(degradado || cortado) && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {cortado
            ? 'A resposta atingiu o limite de tamanho e pode ter sido cortada.'
            : 'A resposta veio fora do formato esperado — a proposta desta rodada pode estar incompleta.'}
        </p>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        {citacoes && citacoes.total > 0 ? (
          <span className="inline-block origin-left scale-90">
            <SeloCitacoes citacoes={citacoes} />
          </span>
        ) : (
          <span />
        )}
        <span className="text-[10px] text-muted-foreground">{hora(turno.criado_em)}</span>
      </div>
    </div>
  )
}

export function ListaTurnos({
  turnos,
  parcial,
  instrucaoEmVoo,
  pensando,
  reconectando,
}: {
  turnos: TurnoPeca[]
  /** Resposta em construção (SSE). */
  parcial: string
  /** Instrução enviada e ainda não persistida. */
  instrucaoEmVoo: string | null
  pensando: boolean
  reconectando: boolean
}) {
  const fim = useRef<HTMLDivElement>(null)

  // A conversa acompanha a resposta nascendo; sem isso o advogado teria de
  // rolar a cada delta do stream.
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
  }, [turnos.length, parcial, instrucaoEmVoo])

  // A abertura da sessão já está no turno 0; a instrução em voo pode duplicar
  // com o turno recém-persistido no instante do recarregamento — comparar o
  // texto do último turno do advogado evita a bolha repetida.
  const ultimaInstrucao = [...turnos].reverse().find((t) => t.papel === 'advogado')?.conteudo ?? null
  const mostrarEmVoo = instrucaoEmVoo !== null && instrucaoEmVoo !== ultimaInstrucao

  const conversaVazia = !turnos.some((t) => t.papel !== 'sistema')

  return (
    <div className="flex flex-col gap-2.5">
      {turnos.map((t) =>
        t.papel === 'advogado' ? (
          <TurnoAdvogado key={t.id} turno={t} />
        ) : t.papel === 'agente' ? (
          <TurnoAgente key={t.id} turno={t} />
        ) : (
          <TurnoSistema key={t.id} turno={t} />
        ),
      )}

      {conversaVazia && !instrucaoEmVoo && !parcial && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs leading-relaxed text-muted-foreground">
          Peça o ajuste em uma frase — o agente lê a peça e o dossiê do caso e volta com uma proposta por seção.
        </p>
      )}

      {mostrarEmVoo && (
        <div className="flex justify-end">
          <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary/10 px-3 py-2 opacity-70">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{instrucaoEmVoo}</p>
          </div>
        </div>
      )}

      {parcial && (
        <div className="rounded-2xl rounded-bl-md border border-border bg-card px-3 py-2">
          <MarkdownTurno>{parcial}</MarkdownTurno>
        </div>
      )}

      {pensando && !parcial && (
        <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Lendo o caso e escrevendo a resposta...
        </div>
      )}

      {reconectando && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
          A conexão caiu, mas a rodada continua no servidor. Buscando o resultado...
        </div>
      )}

      <div ref={fim} />
    </div>
  )
}
