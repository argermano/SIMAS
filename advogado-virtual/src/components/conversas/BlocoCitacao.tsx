'use client'

import { FileText, Image as ImageIcon, MapPin, Mic, User, Video, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MidiaCitada } from '@/lib/conversas/citacao'

/** Ícone da mídia citada (mesmo vocabulário visual dos cards de anexo). */
function IconeMidia({ midia, className }: { midia: MidiaCitada; className?: string }) {
  const Icone =
    midia === 'imagem'
      ? ImageIcon
      : midia === 'video'
        ? Video
        : midia === 'audio'
          ? Mic
          : midia === 'localizacao'
            ? MapPin
            : midia === 'contato'
              ? User
              : FileText
  return <Icone className={className} aria-hidden />
}

/**
 * Faixa de CITAÇÃO no padrão WhatsApp — a mesma peça em dois lugares, de
 * propósito: acima do campo de texto (modo resposta) e dentro da bolha de uma
 * mensagem que responde outra. Borda lateral colorida, autor e trecho.
 *
 * Variantes:
 *  • `aoCancelar` → mostra o X (uso no composer).
 *  • `aoClicar`   → vira botão (uso na bolha: rola até a mensagem citada).
 *  • sem `autor`  → linha única, para o bloco genérico "Mensagem anterior"
 *    (citada fora da página carregada — nunca buscamos ela no servidor).
 *  • `escuro`     → dentro da bolha de SAÍDA, que tem fundo escuro.
 */
export function BlocoCitacao({
  autor,
  trecho,
  midia = null,
  escuro = false,
  aoClicar,
  aoCancelar,
  titulo,
  className,
}: {
  autor?: string
  trecho: string
  midia?: MidiaCitada | null
  escuro?: boolean
  aoClicar?: () => void
  aoCancelar?: () => void
  /** title/aria do bloco clicável. */
  titulo?: string
  className?: string
}) {
  const conteudo = (
    <>
      {autor && (
        <span
          className={cn(
            'block truncate text-[11px] font-semibold',
            escuro ? 'text-background dark:text-primary-foreground' : 'text-primary',
          )}
        >
          {autor}
        </span>
      )}
      <span
        className={cn(
          'flex min-w-0 items-center gap-1 text-xs',
          escuro ? 'text-background/75 dark:text-primary-foreground/75' : 'text-muted-foreground',
        )}
      >
        {midia && <IconeMidia midia={midia} className="h-3 w-3 shrink-0" />}
        <span className="truncate">{trecho}</span>
      </span>
    </>
  )

  return (
    <div
      className={cn(
        'flex items-stretch overflow-hidden rounded-lg border',
        escuro
          ? 'border-background/20 bg-background/10 dark:border-primary-foreground/20 dark:bg-primary-foreground/10'
          : 'border-border bg-muted/50',
        className,
      )}
    >
      {/* Borda lateral colorida — a assinatura visual da citação. */}
      <span
        aria-hidden
        className={cn(
          'w-1 shrink-0',
          escuro ? 'bg-background/70 dark:bg-primary-foreground/70' : 'bg-primary',
        )}
      />
      {aoClicar ? (
        <button
          type="button"
          onClick={aoClicar}
          title={titulo ?? 'Ir para a mensagem citada'}
          className={cn(
            'min-w-0 flex-1 px-2.5 py-1.5 text-left transition-colors',
            escuro
              ? 'hover:bg-background/10 dark:hover:bg-primary-foreground/10'
              : 'hover:bg-muted',
          )}
        >
          {conteudo}
        </button>
      ) : (
        <div className="min-w-0 flex-1 px-2.5 py-1.5">{conteudo}</div>
      )}
      {aoCancelar && (
        <button
          type="button"
          onClick={aoCancelar}
          aria-label="Cancelar resposta"
          title="Cancelar resposta (Esc)"
          className="shrink-0 self-start rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
