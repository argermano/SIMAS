import { cn } from '@/lib/utils'

/**
 * Marca SIMAS — balança da justiça desenhada sob medida (não o ícone genérico do lucide).
 * Hastes/base em currentColor (branco sobre o quadro gradiente); viga, fiel e pratos em
 * dourado (prestígio). Use dentro do quadro gradiente via <Logo> ou solta como ícone.
 */
export function LogoMark({ className }: { className?: string }) {
  const gold = '#D4A93C'
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn('h-5 w-5', className)} aria-hidden="true">
      {/* viga */}
      <path d="M5.5 8h13" stroke={gold} strokeWidth="1.6" strokeLinecap="round" />
      {/* fiel (poste) + base */}
      <path d="M12 6v13M8.5 19.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {/* nó superior */}
      <circle cx="12" cy="5" r="1.5" fill={gold} />
      {/* cordas */}
      <path d="M6 8l-2.3 3.6M6 8l2.3 3.6M18 8l-2.3 3.6M18 8l2.3 3.6" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" opacity="0.8" />
      {/* pratos */}
      <path d="M3 11.6a3 3 0 0 0 6 0Z" fill={gold} fillOpacity="0.92" />
      <path d="M15 11.6a3 3 0 0 0 6 0Z" fill={gold} fillOpacity="0.92" />
    </svg>
  )
}

/** Logo completo: marca no quadro gradiente + wordmark. */
export function Logo({
  className,
  boxClassName,
  markClassName,
  wordClassName,
  showWord = true,
}: {
  className?: string
  boxClassName?: string
  markClassName?: string
  wordClassName?: string
  showWord?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-glow text-white shadow-md shadow-primary/25',
          boxClassName,
        )}
      >
        <LogoMark className={markClassName} />
      </span>
      {showWord && (
        <span className={cn('font-heading text-xl font-extrabold tracking-tight', wordClassName)}>
          SIMAS
        </span>
      )}
    </span>
  )
}
