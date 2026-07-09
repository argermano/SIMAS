'use client'

import { FileText, StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'
import { horaCurta } from '@/lib/conversas/formato'
import type { Anexo, Mensagem } from '@/lib/conversas/tipos'

/** Placeholder de anexo — o proxy /attachments do relay está desligado, então
 * NÃO baixamos bytes: mostramos só ícone + tipo. */
function AnexoPlaceholder({ anexo }: { anexo: Anexo }) {
  return (
    <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs text-muted-foreground">
      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{anexo.tipo || 'anexo'}</span>
    </div>
  )
}

export function MensagemBolha({ mensagem }: { mensagem: Mensagem }) {
  const { direcao, privada, conteudo, anexos, sender, timestamp } = mensagem
  const hora = horaCurta(timestamp)

  // Atividade do sistema: linha central discreta.
  if (direcao === 'atividade') {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
          {conteudo || sender.nome} {hora && <span className="opacity-70">· {hora}</span>}
        </span>
      </div>
    )
  }

  const cliente = direcao === 'entrada'
  const alinhaDireita = !cliente // saída (agente/bot) vai à direita

  // Estilos por natureza da bolha.
  const estilo = privada
    ? 'bg-warning/10 border border-warning/30 text-foreground'
    : cliente
      ? 'bg-muted text-foreground'
      : 'bg-primary text-primary-foreground'

  return (
    <div className={cn('flex w-full', alinhaDireita ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[85%] sm:max-w-[75%]', alinhaDireita ? 'items-end' : 'items-start')}>
        {/* Rótulo do remetente + nota interna */}
        <div
          className={cn(
            'mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground',
            alinhaDireita && 'justify-end',
          )}
        >
          {privada && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-1.5 py-0.5 font-medium text-warning">
              <StickyNote className="h-3 w-3" aria-hidden /> Nota interna
            </span>
          )}
          {sender.nome && <span className="truncate">{sender.nome}</span>}
        </div>

        <div className={cn('rounded-2xl px-3 py-2 text-sm shadow-card', estilo)}>
          {conteudo && <p className="whitespace-pre-wrap break-words">{conteudo}</p>}
          {anexos && anexos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {anexos.map((a, i) => (
                <AnexoPlaceholder key={i} anexo={a} />
              ))}
            </div>
          )}
          {hora && (
            <div
              className={cn(
                'mt-0.5 text-right text-[10px]',
                privada ? 'text-muted-foreground' : cliente ? 'text-muted-foreground' : 'text-primary-foreground/70',
              )}
            >
              {hora}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
