'use client'

import { useState } from 'react'
import {
  Check,
  FileText,
  Image as ImageIcon,
  MapPin,
  Mic,
  ScanLine,
  StickyNote,
  User,
  Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { horaCurta } from '@/lib/conversas/formato'
import type { Anexo, Mensagem } from '@/lib/conversas/tipos'
import { ComprovanteModal } from './ComprovanteModal'

/** Ícone + rótulo pt-BR por tipo de anexo (file_type do Chatwoot normalizado pelo relay). */
function infoAnexo(tipo: string): { Icone: typeof FileText; rotulo: string } {
  switch (tipo) {
    case 'image':
      return { Icone: ImageIcon, rotulo: 'Imagem' }
    case 'audio':
      return { Icone: Mic, rotulo: 'Áudio' }
    case 'video':
      return { Icone: Video, rotulo: 'Vídeo' }
    case 'location':
      return { Icone: MapPin, rotulo: 'Localização' }
    case 'contact':
      return { Icone: User, rotulo: 'Contato' }
    default:
      return { Icone: FileText, rotulo: tipo || 'Arquivo' }
  }
}

/** Card de anexo (fallback dos tipos sem preview e das imagens que falham). */
function AnexoCard({ anexo, escuro }: { anexo: Anexo; escuro: boolean }) {
  const { Icone, rotulo } = infoAnexo(anexo.tipo)
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
        escuro
          ? 'border-background/25 bg-background/10 text-background/90 dark:border-primary-foreground/25 dark:bg-primary-foreground/10 dark:text-primary-foreground/90'
          : 'border-border bg-background/60 text-muted-foreground',
      )}
    >
      <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate font-medium">{rotulo}</span>
    </div>
  )
}

/** Imagem inline via GET /api/conversas/anexos (proxy do relay). Se o proxy
 * estiver desligado/falhar (onError), degrada para o card de anexo atual. */
function AnexoImagem({ anexo, escuro }: { anexo: Anexo; escuro: boolean }) {
  const [falhou, setFalhou] = useState(false)
  if (falhou) return <AnexoCard anexo={anexo} escuro={escuro} />

  const src = `/api/conversas/anexos?url=${encodeURIComponent(anexo.url)}`
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Abrir a imagem em nova aba">
      {/* eslint-disable-next-line @next/next/no-img-element -- bytes vêm do proxy autenticado, sem otimização do Next */}
      <img
        src={src}
        alt="Imagem recebida na conversa"
        loading="lazy"
        onError={() => setFalhou(true)}
        className="max-h-64 w-auto max-w-full rounded-lg border border-border/50 object-contain"
      />
    </a>
  )
}

export function MensagemBolha({
  mensagem,
  conversaId,
  telefone,
}: {
  mensagem: Mensagem
  /** Id da conversa — habilita "Ler comprovante (IA)" nas imagens de entrada. */
  conversaId?: number
  /** Telefone do contato (para casar o cliente na leitura do comprovante). */
  telefone?: string | null
}) {
  const { direcao, privada, conteudo, anexos, sender, timestamp } = mensagem
  const hora = horaCurta(timestamp)

  // Comprovante (IA): modal aberto para a URL da imagem clicada.
  const [comprovanteUrl, setComprovanteUrl] = useState<string | null>(null)

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
  const saidaEscura = alinhaDireita && !privada

  // Estilos por natureza da bolha (mock: entrada em muted; saída escura).
  const estilo = privada
    ? 'bg-warning/10 border border-warning/30 text-foreground'
    : cliente
      ? 'bg-muted text-foreground'
      : 'bg-foreground text-background dark:bg-primary/90'

  const primeiraImagem =
    cliente && conversaId !== undefined ? (anexos ?? []).find((a) => a.tipo === 'image') : undefined

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

        <div className={cn('rounded-2xl px-3.5 py-2 text-sm shadow-card', estilo)}>
          {conteudo && <p className="whitespace-pre-wrap break-words">{conteudo}</p>}
          {anexos && anexos.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {anexos.map((a, i) =>
                a.tipo === 'image' ? (
                  <AnexoImagem key={i} anexo={a} escuro={saidaEscura} />
                ) : (
                  <AnexoCard key={i} anexo={a} escuro={saidaEscura} />
                ),
              )}
            </div>
          )}
          {/* Imagem de ENTRADA: leitura de comprovante pela IA (só sugere;
              a baixa é sempre confirmada por um humano no modal). */}
          {primeiraImagem && (
            <button
              type="button"
              onClick={() => setComprovanteUrl(primeiraImagem.url)}
              className={cn(
                'mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 py-1',
                'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors',
                'hover:border-ring hover:text-foreground',
              )}
              title="Extrair os dados do comprovante com IA e sugerir a parcela"
            >
              <ScanLine className="h-3.5 w-3.5" aria-hidden /> Ler comprovante (IA)
            </button>
          )}
          {hora && (
            <div
              className={cn(
                'mt-0.5 flex items-center justify-end gap-1 text-[10px]',
                saidaEscura ? 'text-background/70 dark:text-primary-foreground/70' : 'text-muted-foreground',
              )}
            >
              <span>{hora}</span>
              {saidaEscura && <Check className="h-3 w-3 opacity-80" aria-hidden />}
            </div>
          )}
        </div>
      </div>

      {conversaId !== undefined && comprovanteUrl && (
        <ComprovanteModal
          aberto
          conversaId={conversaId}
          anexoUrl={comprovanteUrl}
          telefone={telefone ?? null}
          onFechar={() => setComprovanteUrl(null)}
        />
      )}
    </div>
  )
}
