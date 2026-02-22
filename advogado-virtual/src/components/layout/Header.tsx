import { cn, iniciais } from '@/lib/utils'

interface HeaderProps {
  titulo:       string
  subtitulo?:   string
  acoes?:       React.ReactNode
  nomeUsuario:  string
}

export function Header({ titulo, subtitulo, acoes, nomeUsuario }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        {/* Título */}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-gray-900">{titulo}</h1>
          {subtitulo && (
            <p className="mt-0.5 truncate text-sm text-gray-500">{subtitulo}</p>
          )}
        </div>

        {/* Ações + avatar */}
        <div className="flex shrink-0 items-center gap-3">
          {acoes}
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              'bg-primary-800 text-sm font-bold text-white',
              'lg:hidden' // esconde no desktop pois já aparece na sidebar
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
