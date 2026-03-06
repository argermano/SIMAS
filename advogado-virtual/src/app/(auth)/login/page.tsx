'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Scale, Phone, User, Mail, Loader2, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'

export default function LoginPage() {
  const router = useRouter()
  const { error: toastError } = useToast()

  const [email, setEmail]       = useState('')
  const [senha, setSenha]       = useState('')
  const [loading, setLoading]   = useState(false)

  const [mostrarContato, setMostrarContato]   = useState(false)
  const [contato, setContato]                 = useState({ nome: '', email: '', telefone: '' })
  const [enviandoContato, setEnviandoContato] = useState(false)
  const [contatoEnviado, setContatoEnviado]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !senha) return

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

  async function handleContato() {
    if (!contato.nome.trim() || !contato.email.trim()) return
    setEnviandoContato(true)
    try {
      const res = await fetch('/api/contato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contato),
      })
      if (res.ok) {
        setContatoEnviado(true)
      } else {
        toastError('Erro', 'Não foi possível enviar. Tente novamente.')
      }
    } catch {
      toastError('Erro', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviandoContato(false)
    }
  }

  const inputClass =
    'w-full rounded-full border-2 border-border bg-background px-5 py-3 text-base text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50'

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card px-8 py-10 shadow-lg">
        {/* Logo */}
        <div className="mb-10 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2.5">
            <Scale className="h-10 w-10 text-primary" />
            <span className="font-heading text-4xl font-extrabold tracking-tight text-foreground">
              SIMAS
            </span>
          </div>
        </div>

        {!mostrarContato ? (
          <>
            {/* Login form */}
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Digite seu email"
                autoComplete="email"
                autoFocus
                disabled={loading}
                className={inputClass}
              />

              <input
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                placeholder="Digite sua senha"
                autoComplete="current-password"
                disabled={loading}
                className={inputClass}
              />

              <button
                type="submit"
                disabled={loading || !email.trim() || !senha}
                className="w-full rounded-full bg-primary py-3.5 text-base font-bold uppercase tracking-wide text-primary-foreground shadow-md transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                ENTRAR
              </button>
            </form>

            {/* Links */}
            <div className="mt-6 flex flex-col items-center gap-4">
              <Link
                href="/esqueci-senha"
                className="font-heading text-sm font-bold text-primary hover:underline"
              >
                ESQUECEU SUA SENHA?
              </Link>

              <button
                type="button"
                onClick={() => { setMostrarContato(true); setContatoEnviado(false) }}
                className="font-heading text-sm font-bold text-primary hover:underline"
              >
                ENTRE EM CONTATO
              </button>

              <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
                Acesso somente por convite do administrador.<br />
                Ao entrar você concorda com os Termos de Uso e a Política de Privacidade do SIMAS.
              </p>
            </div>
          </>
        ) : (
          <>
            {!contatoEnviado ? (
              <div className="space-y-4">
                <p className="text-center text-sm text-muted-foreground mb-2">
                  Preencha seus dados e entraremos em contato.
                </p>

                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground/50" />
                  <input
                    type="text"
                    placeholder="Seu nome"
                    value={contato.nome}
                    onChange={e => setContato(p => ({ ...p, nome: e.target.value }))}
                    disabled={enviandoContato}
                    className={`${inputClass} pl-11`}
                    autoFocus
                  />
                </div>

                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground/50" />
                  <input
                    type="email"
                    placeholder="Seu e-mail"
                    value={contato.email}
                    onChange={e => setContato(p => ({ ...p, email: e.target.value }))}
                    disabled={enviandoContato}
                    className={`${inputClass} pl-11`}
                  />
                </div>

                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground/50" />
                  <input
                    type="tel"
                    placeholder="Telefone (opcional)"
                    value={contato.telefone}
                    onChange={e => setContato(p => ({ ...p, telefone: e.target.value }))}
                    disabled={enviandoContato}
                    className={`${inputClass} pl-11`}
                  />
                </div>

                <button
                  type="button"
                  onClick={handleContato}
                  disabled={enviandoContato || !contato.nome.trim() || !contato.email.trim()}
                  className="w-full rounded-full bg-primary py-3.5 text-base font-bold uppercase tracking-wide text-primary-foreground shadow-md transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {enviandoContato && <Loader2 className="h-4 w-4 animate-spin" />}
                  ENVIAR
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setMostrarContato(false)}
                    className="font-heading text-sm font-bold text-primary hover:underline"
                  >
                    Voltar ao login
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
                <p className="text-base font-semibold text-foreground">Mensagem enviada!</p>
                <p className="text-sm text-muted-foreground mt-1">Entraremos em contato em breve.</p>
                <button
                  type="button"
                  onClick={() => { setMostrarContato(false); setContatoEnviado(false) }}
                  className="mt-6 text-sm font-semibold uppercase tracking-wide text-primary hover:underline"
                >
                  Voltar ao login
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
