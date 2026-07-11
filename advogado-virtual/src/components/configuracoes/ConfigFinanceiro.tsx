'use client'

import { useEffect, useState } from 'react'
import { QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'

/**
 * Seção "Financeiro" das Configurações — chave Pix do escritório.
 * Grava em tenants.config.financeiro via /api/escritorio/config-financeiro
 * (mesmo padrão da rota config-processos).
 */
export function ConfigFinanceiro() {
  const { success, error: toastError } = useToast()
  const [loading, setLoading]   = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [chave, setChave]   = useState('')
  const [nome, setNome]     = useState('')
  const [cidade, setCidade] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/escritorio/config-financeiro')
        if (!r.ok) return
        const d = await r.json()
        const f = (d.financeiro ?? d) as { pix_chave?: string; pix_nome?: string; pix_cidade?: string }
        setChave(f.pix_chave ?? '')
        setNome(f.pix_nome ?? '')
        setCidade(f.pix_cidade ?? '')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function salvar() {
    if (chave.trim() && (!nome.trim() || !cidade.trim())) {
      toastError('Dados incompletos', 'Com a chave preenchida, informe também o nome do recebedor e a cidade.')
      return
    }
    setSalvando(true)
    try {
      const r = await fetch('/api/escritorio/config-financeiro', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pix_chave:  chave.trim(),
          pix_nome:   nome.trim(),
          pix_cidade: cidade.trim(),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toastError('Não foi possível salvar', d.error ?? 'Tente novamente.'); return }
      success('Pix configurado', 'O botão "Copiar Pix" do Financeiro já usa esses dados.')
    } finally {
      setSalvando(false)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Carregando…</div>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Esses dados geram o <strong>Pix copia-e-cola</strong> enviado nas cobranças e avisos de
        vencimento. Sem chave configurada, o botão &quot;Copiar Pix&quot; fica desativado.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Chave Pix"
          placeholder="CNPJ, e-mail, telefone ou chave aleatória"
          value={chave}
          onChange={(e) => setChave(e.target.value)}
        />
        <Input
          label="Nome do recebedor"
          placeholder="ex.: Simas Advocacia"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          hint="Até 25 caracteres, sem acento (padrão do Banco Central)."
        />
        <Input
          label="Cidade"
          placeholder="ex.: Curitiba"
          value={cidade}
          onChange={(e) => setCidade(e.target.value)}
          hint="Até 15 caracteres, sem acento."
        />
      </div>

      <Button size="sm" onClick={salvar} disabled={salvando}>
        {salvando ? <><Spinner className="h-4 w-4" /> Salvando…</> : <><QrCode className="h-4 w-4" /> Salvar dados do Pix</>}
      </Button>
    </div>
  )
}
