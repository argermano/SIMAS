'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  History,
  Settings,
  Scale,
  LogOut,
  Menu,
  X,
  ClipboardCheck,
  UserCog,
  FileSignature,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

// Prefixos que contam como "Início" ativo (áreas do direito)
const PREFIXOS_HOME = ['/dashboard', '/previdenciario', '/trabalhista', '/civel', '/criminal', '/tributario', '/empresarial']

const MENU_ITEMS = [
  {
    href:    '/dashboard',
    label:   'Início',
    icon:    LayoutDashboard,
    exact:   false,
    ativoSe: (pathname: string) => PREFIXOS_HOME.some(p => pathname === p || pathname.startsWith(p + '/')),
  },
  {
    href:    '/clientes',
    label:   'Clientes',
    icon:    Users,
    exact:   false,
    ativoSe: (pathname: string) => pathname.startsWith('/clientes'),
  },
  {
    href:    '/contratos',
    label:   'Contratos',
    icon:    FileSignature,
    exact:   false,
    ativoSe: (pathname: string) => pathname.startsWith('/contratos'),
  },
  {
    href:    '/historico',
    label:   'Histórico',
    icon:    History,
    exact:   false,
    ativoSe: (pathname: string) => pathname.startsWith('/historico') || pathname.startsWith('/atendimentos'),
  },
  {
    href:    '/configuracoes',
    label:   'Configurações',
    icon:    Settings,
    exact:   false,
    ativoSe: (pathname: string) => pathname.startsWith('/configuracoes'),
  },
]

interface SidebarProps {
  nomeUsuario: string
  nomeEscritorio: string
  roleUsuario: string
  roleRaw?: string
}

const ROLES_COM_REVISAO = ['admin', 'advogado']

export function Sidebar({ nomeUsuario, nomeEscritorio, roleUsuario, roleRaw }: SidebarProps) {
  const pathname  = usePathname()
  const router    = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function sair() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function isAtivo(item: typeof MENU_ITEMS[number]) {
    return item.ativoSe(pathname)
  }

  const conteudo = (
    <div className="flex h-full flex-col">
      {/* Logo / Nome do escritório */}
      <div className="flex items-center gap-3 border-b border-primary-700 px-5 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent">
          <Scale className="h-6 w-6 text-primary-800" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-white">Advogado Virtual</p>
          <p className="truncate text-xs text-primary-300">{nomeEscritorio}</p>
        </div>
      </div>

      {/* Navegação */}
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Menu principal">
        <ul className="space-y-1">
          {MENU_ITEMS.map(item => {
            const ativo = isAtivo(item)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-4 py-3 text-base font-medium transition-colors',
                    ativo
                      ? 'bg-white/15 text-white'
                      : 'text-primary-200 hover:bg-white/10 hover:text-white'
                  )}
                  aria-current={ativo ? 'page' : undefined}
                >
                  <item.icon
                    className={cn('h-5 w-5 shrink-0', ativo ? 'text-accent' : '')}
                    aria-hidden="true"
                  />
                  {item.label}
                </Link>
              </li>
            )
          })}

          {/* Fila de revisão — visível apenas para revisores/advogados/admins */}
          {roleRaw && ROLES_COM_REVISAO.includes(roleRaw) && (() => {
            const ativo = pathname.startsWith('/revisao')
            return (
              <li>
                <Link
                  href="/revisao"
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-4 py-3 text-base font-medium transition-colors',
                    ativo
                      ? 'bg-white/15 text-white'
                      : 'text-primary-200 hover:bg-white/10 hover:text-white'
                  )}
                  aria-current={ativo ? 'page' : undefined}
                >
                  <ClipboardCheck
                    className={cn('h-5 w-5 shrink-0', ativo ? 'text-accent' : '')}
                    aria-hidden="true"
                  />
                  Revisão
                </Link>
              </li>
            )
          })()}

          {/* Gestão de equipe — visível apenas para admin */}
          {roleRaw === 'admin' && (() => {
            const ativo = pathname.startsWith('/configuracoes/equipe')
            return (
              <li>
                <Link
                  href="/configuracoes/equipe"
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-4 py-3 text-base font-medium transition-colors',
                    ativo
                      ? 'bg-white/15 text-white'
                      : 'text-primary-200 hover:bg-white/10 hover:text-white'
                  )}
                  aria-current={ativo ? 'page' : undefined}
                >
                  <UserCog
                    className={cn('h-5 w-5 shrink-0', ativo ? 'text-accent' : '')}
                    aria-hidden="true"
                  />
                  Equipe
                </Link>
              </li>
            )
          })()}
        </ul>
      </nav>

      {/* Perfil + Sair */}
      <div className="border-t border-primary-700 p-4">
        <div className="mb-3 rounded-lg bg-primary-700/50 px-3 py-2.5">
          <p className="truncate text-sm font-semibold text-white">{nomeUsuario}</p>
          <p className="text-xs text-primary-300">{roleUsuario}</p>
        </div>
        <button
          onClick={sair}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-primary-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          Sair do sistema
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Botão hambúrguer mobile */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 rounded-lg bg-primary-800 p-2 text-white shadow-lg lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Sidebar desktop */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col bg-primary-800 min-h-screen">
        {conteudo}
      </aside>

      {/* Sidebar mobile (drawer) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 bg-primary-800 shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-4 top-4 rounded-md p-1 text-primary-300 hover:text-white"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            {conteudo}
          </aside>
        </div>
      )}
    </>
  )
}
