'use client'

import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Search, Plus, Check, X } from 'lucide-react'

const ESTADOS_BR = [
  { value: 'AC', label: 'AC' }, { value: 'AL', label: 'AL' }, { value: 'AP', label: 'AP' },
  { value: 'AM', label: 'AM' }, { value: 'BA', label: 'BA' }, { value: 'CE', label: 'CE' },
  { value: 'DF', label: 'DF' }, { value: 'ES', label: 'ES' }, { value: 'GO', label: 'GO' },
  { value: 'MA', label: 'MA' }, { value: 'MT', label: 'MT' }, { value: 'MS', label: 'MS' },
  { value: 'MG', label: 'MG' }, { value: 'PA', label: 'PA' }, { value: 'PB', label: 'PB' },
  { value: 'PR', label: 'PR' }, { value: 'PE', label: 'PE' }, { value: 'PI', label: 'PI' },
  { value: 'RJ', label: 'RJ' }, { value: 'RN', label: 'RN' }, { value: 'RS', label: 'RS' },
  { value: 'RO', label: 'RO' }, { value: 'RR', label: 'RR' }, { value: 'SC', label: 'SC' },
  { value: 'SP', label: 'SP' }, { value: 'SE', label: 'SE' }, { value: 'TO', label: 'TO' },
]

interface Cliente {
  id: string
  nome: string
  cpf?: string
  email?: string
}

interface SeletorClienteProps {
  onSelecionado: (cliente: { id: string; nome: string }) => void
  clienteSelecionado?: { id: string; nome: string } | null
}

export function SeletorCliente({ onSelecionado, clienteSelecionado }: SeletorClienteProps) {
  const [busca, setBusca]             = useState('')
  const [resultados, setResultados]   = useState<Cliente[]>([])
  const [carregando, setCarregando]   = useState(false)
  const [aberto, setAberto]           = useState(false)
  const [modoNovo, setModoNovo]       = useState(false)
  const [novoNome, setNovoNome]       = useState('')
  const [novaCidade, setNovaCidade]   = useState('')
  const [novoEstado, setNovoEstado]   = useState('')
  const [criando, setCriando]         = useState(false)
  const containerRef                  = useRef<HTMLDivElement>(null)
  const debounceRef                   = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Busca clientes com debounce
  useEffect(() => {
    if (busca.length < 2) {
      setResultados([])
      return
    }

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setCarregando(true)
      try {
        const res = await fetch(`/api/clientes?q=${encodeURIComponent(busca)}`)
        const data = await res.json()
        setResultados(data.clientes ?? [])
        setAberto(true)
      } finally {
        setCarregando(false)
      }
    }, 300)

    return () => clearTimeout(debounceRef.current)
  }, [busca])

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selecionar(cliente: Cliente) {
    onSelecionado({ id: cliente.id, nome: cliente.nome })
    setBusca('')
    setAberto(false)
  }

  async function criarCliente() {
    if (!novoNome.trim()) return
    setCriando(true)
    try {
      const body: Record<string, string> = { nome: novoNome.trim() }
      if (novaCidade.trim()) body.cidade = novaCidade.trim()
      if (novoEstado)        body.estado = novoEstado

      const res = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.cliente) {
        onSelecionado({ id: data.cliente.id, nome: data.cliente.nome })
        setModoNovo(false)
        setNovoNome('')
        setNovaCidade('')
        setNovoEstado('')
      }
    } finally {
      setCriando(false)
    }
  }

  // Se já tem cliente selecionado, mostra chip
  if (clienteSelecionado) {
    return (
      <div className="flex items-center gap-2 rounded-lg border-2 border-green-200 bg-green-50 px-4 py-3">
        <Check className="h-4 w-4 text-green-600" />
        <span className="font-semibold text-green-800">{clienteSelecionado.nome}</span>
        <button
          onClick={() => onSelecionado(null as unknown as { id: string; nome: string })}
          className="ml-auto rounded p-1 text-green-600 hover:bg-green-100"
          title="Trocar cliente"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  // Formulário de novo cliente inline
  if (modoNovo) {
    return (
      <div className="space-y-3 rounded-lg border-2 border-dashed border-primary-200 bg-primary-50 p-4">
        <p className="text-sm font-semibold text-primary-800">Cadastrar novo cliente</p>
        <Input
          label="Nome completo"
          value={novoNome}
          onChange={(e) => setNovoNome(e.target.value)}
          placeholder="Nome do cliente"
          autoFocus
          disabled={criando}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Cidade"
            value={novaCidade}
            onChange={(e) => setNovaCidade(e.target.value)}
            placeholder="Ex.: São Paulo"
            disabled={criando}
          />
          <Select
            label="Estado"
            value={novoEstado}
            onChange={(e) => setNovoEstado(e.target.value)}
            options={ESTADOS_BR}
            placeholder="UF"
            disabled={criando}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={criarCliente} loading={criando} size="sm">
            Cadastrar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setModoNovo(false)} disabled={criando}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  // Campo de busca
  return (
    <div ref={containerRef} className="relative">
      <Input
        label="Cliente"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Busque pelo nome do cliente..."
        leftIcon={<Search className="h-5 w-5" />}
        hint="Digite pelo menos 2 caracteres"
      />

      {/* Dropdown de resultados */}
      {aberto && (busca.length >= 2) && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-lg border bg-white shadow-lg">
          {carregando ? (
            <div className="px-4 py-3 text-sm text-gray-400">Buscando...</div>
          ) : resultados.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500">
              Nenhum cliente encontrado.
            </div>
          ) : (
            resultados.map((c) => (
              <button
                key={c.id}
                onClick={() => selecionar(c)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary-50 transition-colors"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-800">
                  {c.nome.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{c.nome}</p>
                  {c.email && <p className="truncate text-xs text-gray-400">{c.email}</p>}
                </div>
              </button>
            ))
          )}

          {/* Botão criar novo */}
          <button
            onClick={() => { setAberto(false); setModoNovo(true); setNovoNome(busca) }}
            className="flex w-full items-center gap-2 border-t px-4 py-3 text-left text-sm font-medium text-primary-800 hover:bg-primary-50"
          >
            <Plus className="h-4 w-4" />
            Cadastrar &ldquo;{busca}&rdquo; como novo cliente
          </button>
        </div>
      )}
    </div>
  )
}
