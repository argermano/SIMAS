'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { UserPlus, Save, UserX } from 'lucide-react'

const OPCOES_ROLE = [
  { value: 'admin',       label: 'Administrador'  },
  { value: 'advogado',    label: 'Advogado(a)'    },
  { value: 'colaborador', label: 'Colaborador(a)' },
]

// ─── Alterar role de um usuário ───────────────────────────────────────────────

interface AlterarRoleProps {
  usuarioId: string
  roleAtual: string
}

export function AlterarRole({ usuarioId, roleAtual }: AlterarRoleProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [role, setRole]         = useState(roleAtual)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    if (role === roleAtual) return
    setSalvando(true)
    try {
      const res = await fetch(`/api/usuarios/${usuarioId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro', data.error ?? 'Falha ao atualizar perfil')
        setRole(roleAtual)
        return
      }
      success('Perfil atualizado', `Perfil alterado para ${OPCOES_ROLE.find(o => o.value === role)?.label}.`)
      router.refresh()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-800"
        disabled={salvando}
      >
        {OPCOES_ROLE.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {role !== roleAtual && (
        <button
          onClick={salvar}
          disabled={salvando}
          className="flex items-center gap-1 rounded-md bg-primary-800 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          <Save className="h-3 w-3" />
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      )}
    </div>
  )
}

// ─── Desativar usuário ────────────────────────────────────────────────────────

interface DesativarUsuarioProps {
  usuarioId: string
  nomeUsuario: string
}

export function DesativarUsuario({ usuarioId, nomeUsuario }: DesativarUsuarioProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [removendo, setRemovendo] = useState(false)

  async function remover() {
    if (!confirm(`Desativar ${nomeUsuario}? O usuário perderá acesso ao sistema.`)) return
    setRemovendo(true)
    try {
      const res = await fetch(`/api/usuarios/${usuarioId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro', data.error ?? 'Falha ao remover usuário')
        return
      }
      success('Usuário desativado', `${nomeUsuario} foi removido do escritório.`)
      router.refresh()
    } finally {
      setRemovendo(false)
    }
  }

  return (
    <button
      onClick={remover}
      disabled={removendo}
      className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
      title="Desativar usuário"
    >
      <UserX className="h-4 w-4" />
    </button>
  )
}

// ─── Formulário de convite ────────────────────────────────────────────────────

export function FormConvite() {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [nome,      setNome]      = useState('')
  const [email,     setEmail]     = useState('')
  const [role,      setRole]      = useState('advogado')
  const [enviando,  setEnviando]  = useState(false)
  const [erros,     setErros]     = useState<{ nome?: string; email?: string }>({})

  function validar() {
    const novos: { nome?: string; email?: string } = {}
    if (!nome.trim())  novos.nome  = 'Informe o nome'
    if (!email.trim()) novos.email = 'Informe o e-mail'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) novos.email = 'E-mail inválido'
    setErros(novos)
    return Object.keys(novos).length === 0
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) return
    setEnviando(true)
    try {
      const res = await fetch('/api/usuarios/convite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ nome: nome.trim(), email: email.trim(), role }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro ao convidar', data.error ?? 'Tente novamente')
        return
      }
      success('Convite enviado!', `${nome} receberá um e-mail para acessar o sistema.`)
      setNome('')
      setEmail('')
      setRole('advogado')
      router.refresh()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nome completo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Dr. João da Silva"
          error={erros.nome}
          disabled={enviando}
        />
        <Input
          label="E-mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="joao@escritorio.com.br"
          error={erros.email}
          disabled={enviando}
        />
      </div>
      <Select
        label="Perfil de acesso"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        options={OPCOES_ROLE}
        disabled={enviando}
      />
      <Button type="submit" loading={enviando} className="gap-2">
        <UserPlus className="h-4 w-4" />
        Enviar convite
      </Button>
    </form>
  )
}
