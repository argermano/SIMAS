import Link from 'next/link'
import { Settings } from 'lucide-react'
import { cn, iniciais } from '@/lib/utils'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { AtalhosRapidos } from '@/components/layout/AtalhosRapidos'
import { SinoComentarios } from '@/components/tarefas/SinoComentarios'

interface HeaderProps {
  titulo:       string
  subtitulo?:   string
  acoes?:       React.ReactNode
  nomeUsuario:  string
}

export function Header({ titulo, subtitulo, acoes, nomeUsuario }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      {/* max-lg:pl-16 reserva espaço para o botão de menu (fixed left-4) no mobile */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 max-lg:pl-16">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-foreground font-heading">{titulo}</h1>
          {subtitulo && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitulo}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {acoes}
          <AtalhosRapidos />
          <SinoComentarios />
          <ThemeToggle />
          {/* Engrenagem ao lado do tema (dono, 2026-07-23) — antes vivia só no
              rodapé da sidebar; movida para cá. Mesmo estilo do ThemeToggle. */}
          <Link
            href="/configuracoes"
            aria-label="Configurações"
            title="Configurações"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Settings className="h-[18px] w-[18px]" />
          </Link>
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
