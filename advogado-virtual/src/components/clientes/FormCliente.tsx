'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import type { Cliente } from '@/types'

interface FormClienteProps {
  cliente?: Cliente        // se fornecido, modo edição
  onSucesso?: (id: string) => void
}

interface FormData {
  nome:     string
  cpf:      string
  telefone: string
  email:    string
  endereco: string
  notas:    string
}

interface Erros {
  nome?:     string
  email?:    string
  cpf?:      string
}

function formatarCPFInput(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

function formatarTelInput(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
}

export function FormCliente({ cliente, onSucesso }: FormClienteProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const modoEdicao = !!cliente

  const [form, setForm] = useState<FormData>({
    nome:     cliente?.nome     ?? '',
    cpf:      cliente?.cpf      ?? '',
    telefone: cliente?.telefone ?? '',
    email:    cliente?.email    ?? '',
    endereco: cliente?.endereco ?? '',
    notas:    cliente?.notas    ?? '',
  })

  const [erros, setErros] = useState<Erros>({})
  const [loading, setLoading] = useState(false)

  function set(campo: keyof FormData) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      let valor = e.target.value
      if (campo === 'cpf')      valor = formatarCPFInput(valor)
      if (campo === 'telefone') valor = formatarTelInput(valor)
      setForm(prev => ({ ...prev, [campo]: valor }))
      setErros(prev => ({ ...prev, [campo]: undefined }))
    }
  }

  function validar(): boolean {
    const novos: Erros = {}
    if (!form.nome.trim()) novos.nome = 'Nome é obrigatório'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      novos.email = 'E-mail inválido'
    const cpfNums = form.cpf.replace(/\D/g, '')
    if (cpfNums && cpfNums.length !== 11)
      novos.cpf = 'CPF deve ter 11 dígitos'
    setErros(novos)
    return Object.keys(novos).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) return

    setLoading(true)
    try {
      const payload = {
        nome:     form.nome.trim(),
        cpf:      form.cpf      || null,
        telefone: form.telefone || null,
        email:    form.email    || null,
        endereco: form.endereco || null,
        notas:    form.notas    || null,
      }

      const url    = modoEdicao ? `/api/clientes/${cliente.id}` : '/api/clientes'
      const method = modoEdicao ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json()

      if (!res.ok) {
        toastError('Erro ao salvar', json.error ?? 'Tente novamente.')
        return
      }

      const id = modoEdicao ? cliente.id : json.cliente.id
      success(
        modoEdicao ? 'Cliente atualizado!' : 'Cliente cadastrado!',
        `${form.nome} foi ${modoEdicao ? 'atualizado' : 'cadastrado'} com sucesso.`
      )

      if (onSucesso) {
        onSucesso(id)
      } else {
        router.push(`/clientes/${id}`)
        router.refresh()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Dados principais */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-2">
          Dados pessoais
        </h3>

        <Input
          label="Nome completo"
          value={form.nome}
          onChange={set('nome')}
          error={erros.nome}
          placeholder="Ex: Maria da Silva"
          required
          autoFocus={!modoEdicao}
          disabled={loading}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="CPF"
            value={form.cpf}
            onChange={set('cpf')}
            error={erros.cpf}
            placeholder="000.000.000-00"
            inputMode="numeric"
            disabled={loading}
            hint="Opcional — armazenado com segurança"
          />
          <Input
            label="Telefone / WhatsApp"
            value={form.telefone}
            onChange={set('telefone')}
            placeholder="(00) 00000-0000"
            inputMode="numeric"
            disabled={loading}
          />
        </div>

        <Input
          label="E-mail"
          type="email"
          value={form.email}
          onChange={set('email')}
          error={erros.email}
          placeholder="cliente@email.com.br"
          disabled={loading}
        />

        <Input
          label="Endereço"
          value={form.endereco}
          onChange={set('endereco')}
          placeholder="Rua, número, bairro, cidade — UF"
          disabled={loading}
        />
      </div>

      {/* Observações */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-2">
          Observações internas
        </h3>
        <Textarea
          label="Notas sobre o cliente"
          value={form.notas}
          onChange={set('notas')}
          placeholder="Informações relevantes, histórico de contatos, preferências..."
          rows={4}
          disabled={loading}
          hint="Visível apenas para o escritório"
        />
      </div>

      {/* Botões */}
      <div className="flex flex-col-reverse gap-3 border-t border-gray-100 pt-5 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={() => router.back()}
          disabled={loading}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          size="lg"
          loading={loading}
        >
          {modoEdicao ? 'Salvar alterações' : 'Cadastrar cliente'}
        </Button>
      </div>
    </form>
  )
}
