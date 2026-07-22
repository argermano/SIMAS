'use client'

// Player de áudio via ogv.js (decodificador WASM de Ogg/Opus da Wikimedia), para
// navegadores que NÃO tocam o contêiner Ogg nativamente (caso do Safari com as
// notas de voz do WhatsApp). É importado DINAMICAMENTE (next/dynamic, ssr:false)
// lá no MensagemBolha, então o bundle do ogv só é baixado quando este componente
// realmente entra em tela — o Chrome, que usa o <audio> nativo, nunca o carrega.
//
// Os assets WASM/worker são servidos same-origin de /ogv (copiados por
// scripts/copiar-ogv.mjs), apontados por OGVLoader.base. O `src` é a MESMA URL do
// proxy autenticado do anexo usada pelo <audio> nativo.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { classificarFalhaAudio, formatarTempoAudio } from '@/lib/conversas/audio'

type Fase = 'carregando' | 'pronto'

export default function AudioOgvPlayer({
  src,
  escuro,
  aoFalharCarregamento,
  aoFalharDecodificacao,
}: {
  /** URL do proxy autenticado do anexo (mesma do <audio> nativo). */
  src: string
  /** Bolha de saída (fundo escuro): ajusta as cores dos controles. */
  escuro: boolean
  /** Falha de TRANSPORTE (proxy/HTTP fora, ou o próprio bundle do ogv não carregou):
   *  o pai mostra "tentar de novo". */
  aoFalharCarregamento: () => void
  /** Falha de DECODIFICAÇÃO (bytes chegam, mas o ogv não decodificou — arquivo
   *  corrompido/codec exótico): o pai cai no card de download. */
  aoFalharDecodificacao: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<import('ogv').OGVPlayer | null>(null)
  const [fase, setFase] = useState<Fase>('carregando')
  const [tocando, setTocando] = useState(false)
  const [tempoAtual, setTempoAtual] = useState(0)
  const [duracao, setDuracao] = useState(0)

  useEffect(() => {
    let cancelado = false
    let player: import('ogv').OGVPlayer | null = null

    async function iniciar() {
      let mod: typeof import('ogv')
      try {
        mod = await import('ogv')
      } catch {
        // Bundle do ogv não carregou (rede): é falha de transporte, não de codec.
        if (!cancelado) aoFalharCarregamento()
        return
      }
      if (cancelado) return

      const { OGVLoader, OGVPlayer } = mod
      OGVLoader.base = '/ogv' // assets copiados em public/ogv (sem barra final)
      player = new OGVPlayer()
      player.muted = false

      const aoAtualizarTempo = () => {
        if (!cancelado && player) setTempoAtual(player.currentTime || 0)
      }
      const aoTerDuracao = () => {
        if (cancelado || !player) return
        const d = player.duration
        if (Number.isFinite(d)) setDuracao(d)
      }
      const marcarPronto = () => {
        aoTerDuracao()
        if (!cancelado) setFase('pronto')
      }
      const aoErro = async () => {
        if (cancelado) return
        // Distingue transporte × decodificação lendo 1 byte do MESMO proxy.
        const causa = await classificarFalhaAudio(src)
        if (cancelado) return
        if (causa === 'transporte') aoFalharCarregamento()
        else aoFalharDecodificacao()
      }

      player.addEventListener('loadedmetadata', marcarPronto)
      player.addEventListener('loadeddata', marcarPronto)
      player.addEventListener('durationchange', aoTerDuracao)
      player.addEventListener('timeupdate', aoAtualizarTempo)
      player.addEventListener('play', () => !cancelado && setTocando(true))
      player.addEventListener('playing', () => !cancelado && setTocando(true))
      player.addEventListener('pause', () => !cancelado && setTocando(false))
      player.addEventListener('ended', () => {
        if (cancelado) return
        setTocando(false)
        setTempoAtual(0)
      })
      player.addEventListener('error', aoErro)

      // Áudio não tem visual próprio: mantém o elemento no DOM (o Web Audio do ogv
      // funciona melhor anexado), mas oculto — os controles são os nossos.
      player.style.display = 'none'
      containerRef.current?.appendChild(player)
      playerRef.current = player

      player.src = src
      player.load()
    }

    void iniciar()

    return () => {
      cancelado = true
      try {
        player?.pause()
      } catch {
        // ignora: player pode nem ter inicializado
      }
      try {
        player?.remove()
      } catch {
        // ignora
      }
      playerRef.current = null
    }
    // Reinicia do zero quando a URL muda (ou quando o pai re-monta via key no retry).
  }, [src, aoFalharCarregamento, aoFalharDecodificacao])

  const alternar = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    if (player.paused) {
      // play() pode devolver Promise que rejeita (autoplay); aqui é gesto do
      // usuário, então só protegemos contra rejeição não tratada.
      void Promise.resolve(player.play()).catch(() => {})
    } else {
      player.pause()
    }
  }, [])

  const buscar = useCallback(
    (fracao: number) => {
      const player = playerRef.current
      if (!player || !Number.isFinite(duracao) || duracao <= 0) return
      const alvo = Math.min(Math.max(fracao, 0), 1) * duracao
      player.currentTime = alvo
      setTempoAtual(alvo)
    },
    [duracao],
  )

  const aoClicarBarra = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      if (r.width <= 0) return
      buscar((e.clientX - r.left) / r.width)
    },
    [buscar],
  )

  const aoTeclaBarra = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (duracao <= 0) return
      const passo = 5 // segundos por seta
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        buscar((tempoAtual + passo) / duracao)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        buscar((tempoAtual - passo) / duracao)
      }
    },
    [buscar, duracao, tempoAtual],
  )

  const progresso = duracao > 0 ? Math.min(tempoAtual / duracao, 1) : 0
  const corTexto = escuro
    ? 'text-background/90 dark:text-primary-foreground/90'
    : 'text-muted-foreground'
  const corTrilha = escuro
    ? 'bg-background/25 dark:bg-primary-foreground/25'
    : 'bg-muted-foreground/25'
  const corPreenchida = escuro
    ? 'bg-background dark:bg-primary-foreground'
    : 'bg-foreground'

  return (
    <div
      className={cn(
        'inline-flex h-10 w-64 max-w-full items-center gap-2 rounded-lg border px-2.5',
        escuro
          ? 'border-background/25 dark:border-primary-foreground/25'
          : 'border-border bg-background/60',
        corTexto,
      )}
    >
      {/* Container oculto do elemento OGVPlayer. */}
      <div ref={containerRef} className="hidden" aria-hidden />

      {fase === 'carregando' ? (
        <span className="inline-flex items-center gap-2 text-xs">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando áudio…
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={alternar}
            aria-label={tocando ? 'Pausar áudio' : 'Reproduzir áudio'}
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
              escuro
                ? 'hover:bg-background/15 dark:hover:bg-primary-foreground/15'
                : 'hover:bg-muted',
            )}
          >
            {tocando ? (
              <Pause className="h-4 w-4" aria-hidden />
            ) : (
              <Play className="h-4 w-4" aria-hidden />
            )}
          </button>

          <div
            role="slider"
            tabIndex={0}
            aria-label="Posição do áudio"
            aria-valuemin={0}
            aria-valuemax={Math.round(duracao)}
            aria-valuenow={Math.round(tempoAtual)}
            aria-valuetext={`${formatarTempoAudio(tempoAtual)} de ${formatarTempoAudio(duracao)}`}
            onClick={aoClicarBarra}
            onKeyDown={aoTeclaBarra}
            className="group relative h-6 flex-1 cursor-pointer"
          >
            <div className={cn('absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full', corTrilha)}>
              <div
                className={cn('h-full rounded-full', corPreenchida)}
                style={{ width: `${progresso * 100}%` }}
              />
            </div>
          </div>

          <span className="shrink-0 text-[11px] tabular-nums">
            {formatarTempoAudio(tempoAtual)}
            {duracao > 0 && ` / ${formatarTempoAudio(duracao)}`}
          </span>
        </>
      )}
    </div>
  )
}
