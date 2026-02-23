'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Scale, Lock, Eye, EyeOff, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

export default function DefinirSenhaPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { error: toastError } = useToast()

  const [verificando, setVerificando] = useState(true)
  const [temSessao,   setTemSessao]   = useState(false)
  const [senha,       setSenha]       = useState('')
  const [confirmar,   setConfirmar]   = useState('')
  const [verSenha,    setVerSenha]    = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [concluido,   setConcluido]   = useState(false)
  const [erros, setErros] = useState<{ senha?: string; confirmar?: string }>({})

  const linkInvalido = searchParams.get('erro') === 'link_invalido'

  useEffect(() => {
    async function checarSessao() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      setTemSessao(!!session)
      setVerificando(false)
    }
    checarSessao()
  }, [])

  function validar(): boolean {
    const novos: typeof erros = {}
    if (senha.length < 8) novos.senha = 'A senha deve ter pelo menos 8 caracteres'
    if (senha !== confirmar) novos.confirmar = 'As senhas não coincidem'
    setErros(novos)
    return Object.keys(novos).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) return

    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: senha })
      if (error) {
        toastError('Erro ao definir senha', error.message)
        return
      }
      setConcluido(true)
      setTimeout(() => router.push('/dashboard'), 2000)
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

        <div className="rounded-2xl bg-white p-8 shadow-xl">
          {verificando && (
            <div className="text-center py-6">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary-800 border-t-transparent" />
              <p className="text-sm text-gray-500">Verificando link…</p>
            </div>
          )}

          {!verificando && (linkInvalido || !temSessao) && (
            <div className="text-center py-4">
              <p className="text-base font-semibold text-gray-800 mb-2">Link inválido ou expirado</p>
              <p className="text-sm text-gray-500 mb-5">
                O link pode ter expirado. Solicite um novo link de acesso.
              </p>
              <Link
                href="/esqueci-senha"
                className="rounded-lg bg-primary-800 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Solicitar novo link
              </Link>
            </div>
          )}

          {!verificando && temSessao && !concluido && (
            <>
              <h2 className="mb-2 text-2xl font-semibold text-gray-900">Definir senha</h2>
              <p className="mb-6 text-sm text-gray-500">
                Crie uma senha segura para acessar o sistema.
              </p>
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div>
                  <Input
                    label="Nova senha"
                    type={verSenha ? 'text' : 'password'}
                    value={senha}
                    onChange={e => setSenha(e.target.value)}
                    error={erros.senha}
                    placeholder="Mínimo 8 caracteres"
                    autoComplete="new-password"
                    autoFocus
                    leftIcon={<Lock className="h-5 w-5" />}
                    disabled={loading}
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
                <Input
                  label="Confirmar senha"
                  type={verSenha ? 'text' : 'password'}
                  value={confirmar}
                  onChange={e => setConfirmar(e.target.value)}
                  error={erros.confirmar}
                  placeholder="Repita a senha"
                  autoComplete="new-password"
                  leftIcon={<Lock className="h-5 w-5" />}
                  disabled={loading}
                />
                <Button type="submit" size="lg" loading={loading} className="w-full mt-2">
                  Salvar senha e entrar
                </Button>
              </form>
            </>
          )}

          {concluido && (
            <div className="text-center py-6">
              <CheckCircle className="mx-auto mb-3 h-12 w-12 text-green-500" />
              <p className="text-base font-semibold text-gray-800">Senha definida com sucesso!</p>
              <p className="mt-1 text-sm text-gray-500">Redirecionando…</p>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-primary-300">
          © {new Date().getFullYear()} Advogado Virtual · Dados protegidos pela LGPD
        </p>
      </div>
    </main>
  )
}
