'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Scale, Mail, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

export default function EsqueciSenhaPage() {
  const { error: toastError } = useToast()

  const [email,    setEmail]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [enviado,  setEnviado]  = useState(false)
  const [erroEmail, setErroEmail] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErroEmail('')

    if (!email.trim()) {
      setErroEmail('Informe seu e-mail')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErroEmail('E-mail inválido')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/definir-senha`,
      })
      if (error) {
        toastError('Erro', error.message)
        return
      }
      setEnviado(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-primary to-primary/90 p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-card shadow-lg">
            <Scale className="h-9 w-9 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-white">SIMAS</h1>
          <p className="mt-1 text-primary/20">Sistema jurídico inteligente</p>
        </div>

        <div className="rounded-2xl bg-card p-8 shadow-xl">
          {!enviado ? (
            <>
              <h2 className="mb-2 text-2xl font-semibold text-foreground">Esqueci minha senha</h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Informe seu e-mail e enviaremos um link para você criar uma nova senha.
              </p>
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <Input
                  label="E-mail"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  error={erroEmail}
                  placeholder="seu@email.com.br"
                  autoComplete="email"
                  autoFocus
                  leftIcon={<Mail className="h-5 w-5" />}
                  disabled={loading}
                />
                <Button type="submit" size="lg" loading={loading} className="w-full mt-2">
                  Enviar link de redefinição
                </Button>
              </form>
            </>
          ) : (
            <div className="text-center py-4">
              <CheckCircle className="mx-auto mb-3 h-12 w-12 text-success" />
              <p className="text-base font-semibold text-foreground">Verifique seu e-mail</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Enviamos um link de redefinição para <strong>{email}</strong>.
                Clique no link para criar uma nova senha.
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Não recebeu? Verifique a pasta de spam.
              </p>
            </div>
          )}

          <div className="mt-6 border-t border-border pt-5 text-center">
            <Link
              href="/login"
              className="text-sm font-medium text-primary hover:underline"
            >
              ← Voltar para o login
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-primary/30">
          © {new Date().getFullYear()} SIMAS · Dados protegidos pela LGPD
        </p>
      </div>
    </main>
  )
}
