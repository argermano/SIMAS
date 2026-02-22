'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Scale, Mail, Lock, User, Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

interface FormData {
  nome:         string
  email:        string
  senha:        string
  confirmar:    string
  escritorio:   string
}

export default function RegistroPage() {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [form, setForm]         = useState<FormData>({
    nome: '', email: '', senha: '', confirmar: '', escritorio: ''
  })
  const [loading, setLoading]   = useState(false)
  const [erros, setErros]       = useState<Partial<FormData>>({})

  function set(field: keyof FormData) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  function validar(): boolean {
    const novos: Partial<FormData> = {}

    if (!form.nome.trim())
      novos.nome = 'Informe seu nome completo'

    if (!form.escritorio.trim())
      novos.escritorio = 'Informe o nome do escritório'

    if (!form.email.trim())
      novos.email = 'Informe seu e-mail'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      novos.email = 'E-mail inválido'

    if (!form.senha)
      novos.senha = 'Informe uma senha'
    else if (form.senha.length < 6)
      novos.senha = 'A senha deve ter pelo menos 6 caracteres'

    if (!form.confirmar)
      novos.confirmar = 'Confirme sua senha'
    else if (form.senha !== form.confirmar)
      novos.confirmar = 'As senhas não coincidem'

    setErros(novos)
    return Object.keys(novos).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) return

    setLoading(true)
    try {
      const supabase = createClient()

      // 1. Cria o usuário no Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email:    form.email,
        password: form.senha,
        options: {
          data: {
            nome:       form.nome,
            escritorio: form.escritorio,
          },
        },
      })

      if (error) {
        if (error.message.includes('already registered')) {
          toastError('E-mail já cadastrado', 'Utilize a opção "Entrar" para acessar sua conta.')
        } else {
          toastError('Erro ao criar conta', error.message)
        }
        return
      }

      if (data.user) {
        success('Conta criada com sucesso!', 'Bem-vindo ao Advogado Virtual.')
        // Chama API para criar tenant + user no banco
        await fetch('/api/auth/setup-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auth_user_id: data.user.id,
            nome:         form.nome,
            email:        form.email,
            escritorio:   form.escritorio,
          }),
        })
        router.push('/dashboard')
        router.refresh()
      }
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
          <p className="mt-1 text-primary-200">Crie sua conta gratuitamente</p>
        </div>

        {/* Card de registro */}
        <div className="rounded-2xl bg-white p-8 shadow-xl">
          <h2 className="mb-6 text-2xl font-semibold text-gray-900">Criar conta</h2>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Input
              label="Nome completo"
              type="text"
              value={form.nome}
              onChange={set('nome')}
              error={erros.nome}
              placeholder="Dr. João da Silva"
              autoComplete="name"
              autoFocus
              leftIcon={<User className="h-5 w-5" />}
              disabled={loading}
            />

            <Input
              label="Nome do escritório"
              type="text"
              value={form.escritorio}
              onChange={set('escritorio')}
              error={erros.escritorio}
              placeholder="Escritório Silva & Advogados"
              autoComplete="organization"
              leftIcon={<Building2 className="h-5 w-5" />}
              disabled={loading}
            />

            <Input
              label="E-mail"
              type="email"
              value={form.email}
              onChange={set('email')}
              error={erros.email}
              placeholder="seu@email.com.br"
              autoComplete="email"
              leftIcon={<Mail className="h-5 w-5" />}
              disabled={loading}
            />

            <Input
              label="Senha"
              type="password"
              value={form.senha}
              onChange={set('senha')}
              error={erros.senha}
              placeholder="Mínimo 6 caracteres"
              autoComplete="new-password"
              leftIcon={<Lock className="h-5 w-5" />}
              hint="Use pelo menos 6 caracteres"
              disabled={loading}
            />

            <Input
              label="Confirmar senha"
              type="password"
              value={form.confirmar}
              onChange={set('confirmar')}
              error={erros.confirmar}
              placeholder="Repita a senha"
              autoComplete="new-password"
              leftIcon={<Lock className="h-5 w-5" />}
              disabled={loading}
            />

            <Button
              type="submit"
              size="lg"
              loading={loading}
              className="w-full mt-2"
            >
              Criar minha conta
            </Button>
          </form>

          <div className="mt-5 border-t border-gray-100 pt-4 text-center text-sm text-gray-600">
            Já tem conta?{' '}
            <Link href="/login" className="font-semibold text-primary-800 hover:underline">
              Entrar
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-primary-300">
          Ao criar sua conta você concorda com nossa Política de Privacidade e os Termos de Uso.
          Seus dados são protegidos pela LGPD.
        </p>
      </div>
    </main>
  )
}
