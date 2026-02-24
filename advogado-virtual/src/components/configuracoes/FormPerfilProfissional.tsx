'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import type { Tenant } from '@/types'

const ESTADOS_BR = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
  'SP','SE','TO',
]

const OPCOES_ESTADO_CIVIL = [
  { value: 'Solteiro(a)',     label: 'Solteiro(a)'     },
  { value: 'Casado(a)',       label: 'Casado(a)'       },
  { value: 'Divorciado(a)',   label: 'Divorciado(a)'   },
  { value: 'Viúvo(a)',        label: 'Viúvo(a)'        },
  { value: 'União Estável',   label: 'União Estável'   },
  { value: 'Separado(a)',     label: 'Separado(a)'     },
]

interface FormPerfilProfissionalProps {
  escritorio: Pick<Tenant,
    | 'oab_numero' | 'oab_estado'
    | 'cpf_responsavel' | 'rg_responsavel'
    | 'orgao_expedidor' | 'estado_civil' | 'nacionalidade'
    | 'nome_responsavel' | 'telefone' | 'email_profissional'
    | 'endereco' | 'bairro' | 'cidade' | 'estado' | 'cep'
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

function formatarCPFInput(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

export function FormPerfilProfissional({ escritorio }: FormPerfilProfissionalProps) {
  const { success, error: toastError } = useToast()

  const [form, setForm] = useState({
    nome_responsavel:   escritorio.nome_responsavel   ?? '',
    oab_numero:         escritorio.oab_numero         ?? '',
    oab_estado:         escritorio.oab_estado         ?? '',
    cpf_responsavel:    escritorio.cpf_responsavel    ?? '',
    rg_responsavel:     escritorio.rg_responsavel     ?? '',
    orgao_expedidor:    escritorio.orgao_expedidor    ?? '',
    estado_civil:       escritorio.estado_civil       ?? '',
    nacionalidade:      escritorio.nacionalidade      ?? '',
    telefone:           escritorio.telefone           ?? '',
    email_profissional: escritorio.email_profissional ?? '',
    endereco:           escritorio.endereco           ?? '',
    bairro:             escritorio.bairro             ?? '',
    cidade:             escritorio.cidade             ?? '',
    estado:             escritorio.estado             ?? '',
    cep:                escritorio.cep                ?? '',
  })
  const [loading, setLoading] = useState(false)

  function set(campo: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      let valor = e.target.value
      if (campo === 'telefone')        valor = formatarTelInput(valor)
      if (campo === 'cep')             valor = formatarCEPInput(valor)
      if (campo === 'cpf_responsavel') valor = formatarCPFInput(valor)
      setForm(prev => ({ ...prev, [campo]: valor }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(form)) {
        payload[k] = v || null
      }
      const res = await fetch('/api/escritorio/perfil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        toastError('Erro ao salvar', json.error ?? 'Tente novamente.')
        return
      }
      success('Dados atualizados!', 'Os dados profissionais do escritório foram salvos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Nome do advogado responsável"
        value={form.nome_responsavel}
        onChange={set('nome_responsavel')}
        placeholder="Ex.: Dr. João da Silva"
        disabled={loading}
      />
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          label="CPF"
          value={form.cpf_responsavel}
          onChange={set('cpf_responsavel')}
          placeholder="000.000.000-00"
          inputMode="numeric"
          disabled={loading}
        />
        <Input
          label="RG"
          value={form.rg_responsavel}
          onChange={set('rg_responsavel')}
          placeholder="00.000.000-0"
          disabled={loading}
        />
        <Input
          label="Órgão expedidor"
          value={form.orgao_expedidor}
          onChange={set('orgao_expedidor')}
          placeholder="Ex.: SSP/SC"
          disabled={loading}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Estado civil"
          value={form.estado_civil}
          onChange={e => setForm(prev => ({ ...prev, estado_civil: e.target.value }))}
          options={OPCOES_ESTADO_CIVIL}
          placeholder="Selecione..."
          disabled={loading}
        />
        <Input
          label="Nacionalidade"
          value={form.nacionalidade}
          onChange={set('nacionalidade')}
          placeholder="Ex.: brasileiro(a)"
          disabled={loading}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Telefone"
          value={form.telefone}
          onChange={set('telefone')}
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
        label="Endereço"
        value={form.endereco}
        onChange={set('endereco')}
        placeholder="Rua, número, complemento"
        disabled={loading}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Input
          label="Bairro"
          value={form.bairro}
          onChange={set('bairro')}
          placeholder="Ex.: Centro"
          disabled={loading}
        />
        <Input
          label="Cidade"
          value={form.cidade}
          onChange={set('cidade')}
          placeholder="Ex.: Brasília"
          disabled={loading}
        />
        <Select
          label="Estado (UF)"
          value={form.estado}
          onChange={e => setForm(prev => ({ ...prev, estado: e.target.value }))}
          options={ESTADOS_BR.map(uf => ({ value: uf, label: uf }))}
          placeholder="UF..."
          disabled={loading}
        />
        <Input
          label="CEP"
          value={form.cep}
          onChange={set('cep')}
          placeholder="00000-000"
          inputMode="numeric"
          disabled={loading}
        />
      </div>
      <div className="flex justify-end pt-2">
        <Button type="submit" loading={loading}>
          Salvar dados do escritório
        </Button>
      </div>
    </form>
  )
}
