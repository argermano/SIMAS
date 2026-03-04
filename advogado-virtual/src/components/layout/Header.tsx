import { cn, iniciais } from '@/lib/utils'

interface HeaderProps {
  titulo:       string
  subtitulo?:   string
  acoes?:       React.ReactNode
  nomeUsuario:  string
}

export function Header({ titulo, subtitulo, acoes, nomeUsuario }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-foreground font-heading">{titulo}</h1>
          {subtitulo && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitulo}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {acoes}
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              'bg-primary text-sm font-bold text-primary-foreground',
              'lg:hidden'
            )}
            aria-label={`Usuário: ${nomeUsuario}`}
            title={nomeUsuario}
          >
            {iniciais(nomeUsuario)}
          </div>
        </div>
      </div>
    </header>
  )
}
