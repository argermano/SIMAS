'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Scale, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

export default function LoginPage() {
  const router = useRouter()
  const { error: toastError } = useToast()

  const [email, setEmail]         = useState('')
  const [senha, setSenha]         = useState('')
  const [verSenha, setVerSenha]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [erros, setErros]         = useState<{ email?: string; senha?: string }>({})

  function validar(): boolean {
    const novos: typeof erros = {}
    if (!email.trim())   novos.email = 'Informe seu e-mail'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) novos.email = 'E-mail inválido'
    if (!senha)          novos.senha = 'Informe sua senha'
    setErros(novos)
    return Object.keys(novos).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) return

    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha })

      if (error) {
        if (error.message.includes('Invalid login')) {
          toastError('E-mail ou senha incorretos', 'Verifique seus dados e tente novamente.')
        } else {
          toastError('Erro ao entrar', error.message)
        }
        return
      }

      router.push('/dashboard')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-primary-800 to-primary-900 p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg">
            <Scale className="h-9 w-9 text-primary-800" />
          </div>
          <h1 className="text-3xl font-bold text-white">Advogado Virtual</h1>
          <p className="mt-1 text-primary-200">Sistema jurídico inteligente</p>
        </div>

        {/* Card de login */}
        <div className="rounded-2xl bg-white p-8 shadow-xl">
          <h2 className="mb-6 text-2xl font-semibold text-gray-900">Entrar no sistema</h2>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <Input
              label="E-mail"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              error={erros.email}
              placeholder="seu@email.com.br"
              autoComplete="email"
              autoFocus
              leftIcon={<Mail className="h-5 w-5" />}
              disabled={loading}
            />

            <div>
              <Input
                label="Senha"
                type={verSenha ? 'text' : 'password'}
                value={senha}
                onChange={e => setSenha(e.target.value)}
                error={erros.senha}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={loading}
                leftIcon={<Lock className="h-5 w-5" />}
              />
              <button
                type="button"
                onClick={() => setVerSenha(v => !v)}
                className="mt-1.5 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
                tabIndex={-1}
              >
                {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {verSenha ? 'Ocultar' : 'Mostrar'} senha
              </button>
            </div>

            <Button
              type="submit"
              size="lg"
              loading={loading}
              className="w-full mt-2"
            >
              Entrar
            </Button>
          </form>

          <div className="mt-6 flex flex-col items-center gap-3 border-t border-gray-100 pt-5 text-sm">
            <p className="text-gray-600">
              Ainda não tem conta?{' '}
              <Link
                href="/registro"
                className="font-semibold text-primary-800 hover:underline"
              >
                Criar conta
              </Link>
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-primary-300">
          © {new Date().getFullYear()} Advogado Virtual · Dados protegidos pela LGPD
        </p>
      </div>
    </main>
  )
}
