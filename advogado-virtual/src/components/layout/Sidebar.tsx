'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Users, History, Settings, LogOut,
  Menu, X, ClipboardCheck, UserCog, FileSignature,
  KanbanSquare, Scale, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

const PREFIXOS_HOME = ['/dashboard', '/previdenciario', '/trabalhista', '/civel', '/criminal', '/tributario', '/empresarial']

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
    href:    '/contratos',
    label:   'Contratos',
    icon:    FileSignature,
    ativoSe: (p: string) => p.startsWith('/contratos'),
  },
  {
    href:    '/tarefas',
    label:   'Tarefas',
    icon:    KanbanSquare,
    ativoSe: (p: string) => p.startsWith('/tarefas'),
  },
  {
    href:    '/historico',
    label:   'Histórico',
    icon:    History,
    ativoSe: (p: string) => p.startsWith('/historico') || p.startsWith('/atendimentos'),
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

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved === 'true') setCollapsed(true)
  }, [])

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

  const isConfigAtivo = pathname.startsWith('/configuracoes') && !pathname.startsWith('/configuracoes/equipe')

  const sidebarContent = (isCollapsed: boolean) => (
    <div className="flex h-full flex-col" style={{ background: 'var(--gradient-sidebar)' }}>
      {/* Logo */}
      <div className={cn('flex items-center gap-3 border-b border-sidebar-border px-4 py-5', isCollapsed && 'justify-center px-2')}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--gradient-primary)' }}>
          <Scale className="h-5 w-5 text-white" />
        </div>
        <AnimatePresence>
          {!isCollapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 min-w-0"
            >
              <p className="truncate text-base font-bold text-white font-heading">SIMAS</p>
              <p className="text-[11px] tracking-wider text-sidebar-muted leading-tight">Solução IA feita para Maximizar a Advocacia de forma Simples</p>
              <p className="mt-2 text-[11px] font-medium text-blue-300/80 leading-tight">{nomeEscritorio}</p>
            </motion.div>
          )}
        </AnimatePresence>
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

      {/* Label MENU */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-5 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted"
          >
            Menu
          </motion.p>
        )}
      </AnimatePresence>

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
                    <motion.div
                      layoutId="sidebar-indicator"
                      className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-card"
                      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                    />
                  )}
                  <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <AnimatePresence>
                    {!isCollapsed && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: 'auto' }}
                        exit={{ opacity: 0, width: 0 }}
                        className="overflow-hidden whitespace-nowrap"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Rodapé */}
      <div className="border-t border-sidebar-border p-3">
        {/* Configurações */}
        <Link
          href="/configuracoes"
          onClick={() => setMobileOpen(false)}
          className={cn(
            'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors mb-3',
            isCollapsed && 'justify-center px-2',
            isConfigAtivo
              ? 'bg-sidebar-accent text-white'
              : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-white'
          )}
          title={isCollapsed ? 'Configurações' : undefined}
        >
          {isConfigAtivo && (
            <motion.div
              layoutId="sidebar-indicator"
              className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-card"
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            />
          )}
          <Settings className="h-5 w-5 shrink-0" aria-hidden="true" />
          <AnimatePresence>
            {!isCollapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="overflow-hidden whitespace-nowrap"
              >
                Configurações
              </motion.span>
            )}
          </AnimatePresence>
        </Link>

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

            <AnimatePresence>
              {!isCollapsed && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  className="flex-1 min-w-0 overflow-hidden"
                >
                  <p className="truncate text-sm font-semibold text-white">{nomeUsuario.split(' ')[0]}</p>
                  <p className="text-xs text-sidebar-muted">{roleUsuario}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {!isCollapsed && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={sair}
                  className="shrink-0 rounded-md p-1.5 text-sidebar-muted hover:text-white hover:bg-sidebar-accent transition-colors"
                  aria-label="Sair do sistema"
                  title="Sair do sistema"
                >
                  <LogOut className="h-4 w-4" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {isCollapsed && (
          <button
            onClick={sair}
            className="mt-2 flex w-full items-center justify-center rounded-lg p-2 text-sidebar-muted hover:text-white hover:bg-sidebar-accent transition-colors"
            aria-label="Sair do sistema"
            title="Sair do sistema"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 rounded-lg bg-primary p-2 text-white shadow-lg lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <motion.aside
        className="hidden lg:flex lg:shrink-0 lg:flex-col h-screen overflow-hidden"
        animate={{ width: collapsed ? 68 : 240 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {sidebarContent(collapsed)}
      </motion.aside>

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
