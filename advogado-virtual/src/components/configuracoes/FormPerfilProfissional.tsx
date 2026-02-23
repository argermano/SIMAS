'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import type { Usuario } from '@/types'

const ESTADOS_BR = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
  'SP','SE','TO',
]

interface FormPerfilProfissionalProps {
  usuario: Pick<Usuario,
    | 'oab_numero' | 'oab_estado'
    | 'telefone_profissional' | 'email_profissional'
    | 'endereco_profissional' | 'cidade_profissional'
    | 'estado_profissional' | 'cep_profissional'
  >
}

function formatarTelInput(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
}

function formatarCEPInput(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0,5)}-${d.slice(5)}`
}

export function FormPerfilProfissional({ usuario }: FormPerfilProfissionalProps) {
  const { success, error: toastError } = useToast()

  const [form, setForm] = useState({
    oab_numero:            usuario.oab_numero            ?? '',
    oab_estado:            usuario.oab_estado            ?? '',
    telefone_profissional: usuario.telefone_profissional ?? '',
    email_profissional:    usuario.email_profissional    ?? '',
    endereco_profissional: usuario.endereco_profissional ?? '',
    cidade_profissional:   usuario.cidade_profissional   ?? '',
    estado_profissional:   usuario.estado_profissional   ?? '',
    cep_profissional:      usuario.cep_profissional      ?? '',
  })
  const [loading, setLoading] = useState(false)

  function set(campo: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      let valor = e.target.value
      if (campo === 'telefone_profissional') valor = formatarTelInput(valor)
      if (campo === 'cep_profissional')      valor = formatarCEPInput(valor)
      setForm(prev => ({ ...prev, [campo]: valor }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        oab_numero:            form.oab_numero            || null,
        oab_estado:            form.oab_estado            || null,
        telefone_profissional: form.telefone_profissional || null,
        email_profissional:    form.email_profissional    || null,
        endereco_profissional: form.endereco_profissional || null,
        cidade_profissional:   form.cidade_profissional   || null,
        estado_profissional:   form.estado_profissional   || null,
        cep_profissional:      form.cep_profissional      || null,
      }
      const res = await fetch('/api/usuarios/perfil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        toastError('Erro ao salvar', json.error ?? 'Tente novamente.')
        return
      }
      success('Perfil atualizado!', 'Seus dados profissionais foram salvos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="OAB nº"
          value={form.oab_numero}
          onChange={set('oab_numero')}
          placeholder="Ex.: 12345"
          disabled={loading}
        />
        <Select
          label="Estado da OAB"
          value={form.oab_estado}
          onChange={e => setForm(prev => ({ ...prev, oab_estado: e.target.value }))}
          options={ESTADOS_BR.map(uf => ({ value: uf, label: uf }))}
          placeholder="Selecione..."
          disabled={loading}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Telefone profissional"
          value={form.telefone_profissional}
          onChange={set('telefone_profissional')}
          placeholder="(00) 00000-0000"
          inputMode="numeric"
          disabled={loading}
        />
        <Input
          label="E-mail profissional"
          type="email"
          value={form.email_profissional}
          onChange={set('email_profissional')}
          placeholder="advogado@escritorio.com.br"
          disabled={loading}
        />
      </div>
      <Input
        label="Endereço profissional"
        value={form.endereco_profissional}
        onChange={set('endereco_profissional')}
        placeholder="Rua, número, complemento"
        disabled={loading}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          label="Cidade"
          value={form.cidade_profissional}
          onChange={set('cidade_profissional')}
          placeholder="Ex.: Blumenau"
          disabled={loading}
        />
        <Select
          label="Estado (UF)"
          value={form.estado_profissional}
          onChange={e => setForm(prev => ({ ...prev, estado_profissional: e.target.value }))}
          options={ESTADOS_BR.map(uf => ({ value: uf, label: uf }))}
          placeholder="UF..."
          disabled={loading}
        />
        <Input
          label="CEP"
          value={form.cep_profissional}
          onChange={set('cep_profissional')}
          placeholder="00000-000"
          inputMode="numeric"
          disabled={loading}
        />
      </div>
      <div className="flex justify-end pt-2">
        <Button type="submit" loading={loading}>
          Salvar perfil profissional
        </Button>
      </div>
    </form>
  )
}
