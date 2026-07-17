'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { NotificadorConversas } from '@/components/conversas/NotificadorConversas'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Users, Settings, LogOut,
  Menu, X, ClipboardCheck, UserCog, FileSignature,
  KanbanSquare, ChevronLeft, ChevronRight, BookMarked, Filter, BellRing, Newspaper, MessagesSquare,
  CalendarDays, Wallet, Briefcase,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { AREAS } from '@/lib/constants/areas'

// "Início" fica ativo no dashboard e em qualquer área jurídica (derivado de areas.ts)
const PREFIXOS_HOME = ['/dashboard', ...Object.values(AREAS).map((a) => `/${a.id}`)]

const MENU_ITEMS = [
  {
    href:    '/dashboard',
    label:   'Início',
    icon:    LayoutDashboard,
    ativoSe: (p: string) => PREFIXOS_HOME.some(x => p === x || p.startsWith(x + '/')),
  },
  {
    href:    '/clientes',
    label:   'Clientes',
    icon:    Users,
    ativoSe: (p: string) => p.startsWith('/clientes'),
  },
  {
    href:    '/atendimentos',
    label:   'Atendimentos',
    icon:    Briefcase,
    ativoSe: (p: string) => p.startsWith('/atendimentos'),
  },
  {
    href:    '/funil',
    label:   'Funil',
    icon:    Filter,
    ativoSe: (p: string) => p.startsWith('/funil'),
  },
  {
    href:    '/tarefas',
    label:   'Tarefas',
    icon:    KanbanSquare,
    ativoSe: (p: string) => p.startsWith('/tarefas'),
  },
  {
    href:    '/agenda',
    label:   'Agenda',
    icon:    CalendarDays,
    ativoSe: (p: string) => p.startsWith('/agenda'),
  },
  {
    href:    '/contratos',
    label:   'Contratos a assinar',
    icon:    FileSignature,
    ativoSe: (p: string) => p.startsWith('/contratos'),
  },
  {
    href:    '/financeiro',
    label:   'Financeiro',
    icon:    Wallet,
    ativoSe: (p: string) => p.startsWith('/financeiro'),
  },
  {
    href:    '/biblioteca',
    label:   'Biblioteca',
    icon:    BookMarked,
    ativoSe: (p: string) => p.startsWith('/biblioteca'),
  },
]

interface SidebarProps {
  nomeUsuario: string
  nomeEscritorio: string
  roleUsuario: string
  roleRaw?: string
}

const ROLES_COM_REVISAO = ['admin', 'advogado']

function initials(nome: string) {
  return nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

export function Sidebar({ nomeUsuario, nomeEscritorio, roleUsuario, roleRaw }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed,  setCollapsed]  = useState(false)
  const [novasPub,   setNovasPub]   = useState(0)
  const [novasConv,  setNovasConv]  = useState(0)

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved === 'true') setCollapsed(true)
  }, [])

  // Badge de publicações novas — 1 fetch leve no mount (sem polling)
  useEffect(() => {
    if (roleRaw !== 'admin' && roleRaw !== 'advogado') return
    let vivo = true
    fetch('/api/publicacoes/saude')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d) setNovasPub(d.novas ?? 0) })
      .catch(() => {})
    return () => { vivo = false }
  }, [roleRaw])

  function toggleCollapse() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebar-collapsed', String(next))
  }

  async function sair() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const allItems = [
    ...MENU_ITEMS,
    ...(roleRaw === 'admin' || roleRaw === 'advogado' ? [{
      href:    '/publicacoes',
      label:   'Publicações',
      icon:    Newspaper,
      ativoSe: (p: string) => p.startsWith('/publicacoes'),
    }] : []),
    ...(roleRaw === 'admin' || roleRaw === 'advogado' || roleRaw === 'colaborador' ? [{
      href:    '/conversas',
      label:   'Conversas',
      icon:    MessagesSquare,
      ativoSe: (p: string) => p.startsWith('/conversas'),
    }] : []),
    ...(roleRaw === 'admin' || roleRaw === 'advogado' ? [{
      href:    '/processos/notificacoes',
      label:   'Movimentações',
      icon:    BellRing,
      ativoSe: (p: string) => p.startsWith('/processos'),
    }] : []),
    ...(roleRaw && ROLES_COM_REVISAO.includes(roleRaw) ? [{
      href:    '/revisao',
      label:   'Revisão',
      icon:    ClipboardCheck,
      ativoSe: (p: string) => p.startsWith('/revisao'),
    }] : []),
    ...(roleRaw === 'admin' ? [{
      href:    '/configuracoes/equipe',
      label:   'Equipe',
      icon:    UserCog,
      ativoSe: (p: string) => p.startsWith('/configuracoes/equipe'),
    }] : []),
  ]
    // Funil é ferramenta de gestão comercial: SÓ o administrador vê
    // (decisão do dono, 2026-07-16 — a equipe trabalha pelos Atendimentos).
    .filter(item => item.href !== '/funil' || roleRaw === 'admin')

  const isConfigAtivo = pathname.startsWith('/configuracoes') && !pathname.startsWith('/configuracoes/equipe')

  const sidebarContent = (isCollapsed: boolean) => (
    <div className="flex h-full flex-col" style={{ background: 'var(--gradient-sidebar)' }}>
      {/* Logo */}
      <div className={cn('flex items-center justify-center border-b border-sidebar-border px-4 py-5', isCollapsed && 'px-2')}>
        {/* Marca oficial no lugar dos textos (dono, 2026-07-16). Recolhida: só o símbolo. */}
        {isCollapsed ? (
          // eslint-disable-next-line @next/next/no-img-element -- asset estático de public/
          <img src="/marca-s-branca.png" alt="SIMAS" className="h-10 w-auto" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- asset estático de public/
          <img
            src="/logo-simas-branca.png"
            alt="SIMAS — Sistema Inteligente para Modernizar a Advocacia com Segurança"
            className="h-auto w-full max-w-[216px] animate-in fade-in-0 duration-300"
          />
        )}
      </div>

      {/* Toggle colapso (desktop only) */}
      <div className="hidden lg:flex justify-end px-3 pt-3">
        <button
          onClick={toggleCollapse}
          className="rounded-md p-1.5 text-sidebar-muted hover:text-white hover:bg-sidebar-accent transition-colors"
          aria-label={isCollapsed ? 'Expandir menu' : 'Colapsar menu'}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Espaçamento antes da navegação */}
      {!isCollapsed && <div className="pt-4" />}

      {/* Navegação */}
      <nav className="flex-1 overflow-y-auto px-3 py-1" aria-label="Menu principal">
        <ul className="space-y-1">
          {allItems.map(item => {
            const ativo = item.ativoSe(pathname)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isCollapsed && 'justify-center px-2',
                    ativo
                      ? 'bg-sidebar-accent text-white'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-white'
                  )}
                  aria-current={ativo ? 'page' : undefined}
                  title={isCollapsed ? item.label : undefined}
                >
                  {ativo && (
                    <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-card animate-in fade-in-0 duration-200" />
                  )}
                  <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {item.href === '/publicacoes' && novasPub > 0 && isCollapsed && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-warning" aria-hidden="true" />
                  )}
                  {item.href === '/conversas' && novasConv > 0 && isCollapsed && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-success" aria-hidden="true" />
                  )}
                  {!isCollapsed && (
                    <span className="overflow-hidden whitespace-nowrap animate-in fade-in-0 duration-300">
                      {item.label}
                    </span>
                  )}
                  {item.href === '/publicacoes' && novasPub > 0 && !isCollapsed && (
                    <span
                      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white"
                      aria-label={`${novasPub} publicações novas`}
                    >
                      {novasPub > 99 ? '99+' : novasPub}
                    </span>
                  )}
                  {item.href === '/conversas' && novasConv > 0 && !isCollapsed && (
                    <span
                      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-success px-1.5 text-[11px] font-semibold text-white"
                      aria-label={`${novasConv} conversas com mensagens novas`}
                    >
                      {novasConv > 99 ? '99+' : novasConv}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Rodapé — Configurações virou só a engrenagem, ao lado e ANTES do Sair (dono, 2026-07-16). */}
      <div className="border-t border-sidebar-border p-3">
        {/* Avatar / Perfil */}
        <div className={cn('rounded-lg bg-sidebar-accent/40 px-3 py-2.5', isCollapsed && 'px-2')}>
          <div className={cn('flex items-center gap-3', isCollapsed && 'justify-center')}>
            <div className="relative shrink-0">
              <div className="rounded-full p-[2px]" style={{ background: 'var(--gradient-primary)' }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar text-xs font-bold text-white">
                  {initials(nomeUsuario)}
                </div>
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar bg-success/50" />
            </div>

            {!isCollapsed && (
              <div className="flex-1 min-w-0 overflow-hidden animate-in fade-in-0 duration-300">
                <p className="truncate text-sm font-semibold text-white">{nomeUsuario.split(' ')[0]}</p>
                <p className="text-xs text-sidebar-muted">{roleUsuario}</p>
              </div>
            )}

            {!isCollapsed && (
              <>
                <Link
                  href="/configuracoes"
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'shrink-0 rounded-md p-1.5 transition-colors animate-in fade-in-0 duration-300',
                    isConfigAtivo ? 'bg-sidebar-accent text-white' : 'text-sidebar-muted hover:text-white hover:bg-sidebar-accent'
                  )}
                  aria-label="Configurações"
                  title="Configurações"
                >
                  <Settings className="h-4 w-4" />
                </Link>
                <button
                  onClick={sair}
                  className="shrink-0 rounded-md p-1.5 text-sidebar-muted hover:text-white hover:bg-sidebar-accent transition-colors animate-in fade-in-0 duration-300"
                  aria-label="Sair do sistema"
                  title="Sair do sistema"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {isCollapsed && (
          <div className="mt-2 flex flex-col items-center gap-1">
            <Link
              href="/configuracoes"
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex w-full items-center justify-center rounded-lg p-2 transition-colors',
                isConfigAtivo ? 'bg-sidebar-accent text-white' : 'text-sidebar-muted hover:text-white hover:bg-sidebar-accent'
              )}
              aria-label="Configurações"
              title="Configurações"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <button
              onClick={sair}
              className="flex w-full items-center justify-center rounded-lg p-2 text-sidebar-muted hover:text-white hover:bg-sidebar-accent transition-colors"
              aria-label="Sair do sistema"
              title="Sair do sistema"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Notificador global de mensagens novas do WhatsApp (toast + badge). */}
      <NotificadorConversas pathname={pathname} onBadge={setNovasConv} />
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 rounded-lg bg-primary p-2 text-white shadow-lg lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <aside
        className={cn(
          'hidden lg:flex lg:shrink-0 lg:flex-col h-screen overflow-hidden transition-[width] duration-300 ease-in-out',
          collapsed ? 'lg:w-[68px]' : 'lg:w-60'
        )}
      >
        {sidebarContent(collapsed)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 z-10 rounded-md p-1 text-sidebar-muted hover:text-white transition-colors"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarContent(false)}
          </aside>
        </div>
      )}
    </>
  )
}
