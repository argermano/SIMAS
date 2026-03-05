'use client'

import { useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Check, SkipForward, User, Building2 } from 'lucide-react'
import type { DadosExtraidosAutor, DadosExtraidosReu } from '@/lib/prompts/extracao/dados-cliente'

interface ConfirmarDadosModalProps {
  open: boolean
  onClose: () => void
  dadosExtraidos: { autor: DadosExtraidosAutor; reu?: DadosExtraidosReu }
  dadosAtuaisCliente?: Partial<DadosExtraidosAutor>
  onConfirmar: (dados: { autor: DadosExtraidosAutor; reu?: DadosExtraidosReu }) => void
  onPular: () => void
  loading?: boolean
}

const LABELS_AUTOR: Record<keyof DadosExtraidosAutor, string> = {
  nome:            'Nome completo',
  cpf:             'CPF',
  rg:              'RG',
  orgao_expedidor: 'Órgão expedidor',
  estado_civil:    'Estado civil',
  nacionalidade:   'Nacionalidade',
  profissao:       'Profissão',
  endereco:        'Endereço',
  bairro:          'Bairro',
  cidade:          'Cidade',
  estado:          'Estado',
  cep:             'CEP',
  telefone:        'Telefone',
  email:           'E-mail',
}

const LABELS_REU: Record<keyof DadosExtraidosReu, string> = {
  nome:      'Nome / Razão social',
  cnpj_cpf:  'CNPJ / CPF',
  endereco:  'Endereço',
  cidade:    'Cidade',
  estado:    'Estado',
}

export function ConfirmarDadosModal({
  open,
  onClose,
  dadosExtraidos,
  dadosAtuaisCliente,
  onConfirmar,
  onPular,
  loading,
}: ConfirmarDadosModalProps) {
  // Merge: dados extraídos sobrescrevem dados atuais do cliente
  const mergedAutor: DadosExtraidosAutor = {
    ...(dadosAtuaisCliente ?? {}),
    ...Object.fromEntries(
      Object.entries(dadosExtraidos.autor).filter(([, v]) => !!v)
    ),
  }

  const [autor, setAutor] = useState<DadosExtraidosAutor>(mergedAutor)
  const [reu,   setReu]   = useState<DadosExtraidosReu | undefined>(dadosExtraidos.reu)

  function updateAutor(key: keyof DadosExtraidosAutor, value: string) {
    setAutor(prev => ({ ...prev, [key]: value || undefined }))
  }

  function updateReu(key: keyof DadosExtraidosReu, value: string) {
    setReu(prev => ({ ...(prev ?? {}), [key]: value || undefined }))
  }

  function isChanged(key: keyof DadosExtraidosAutor): boolean {
    if (!dadosAtuaisCliente) return !!autor[key]
    return !!autor[key] && autor[key] !== dadosAtuaisCliente[key]
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Confirmar dados extraídos"
      description="Os dados abaixo foram extraídos dos documentos. Revise e confirme antes de continuar."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onPular} disabled={loading}>
            <SkipForward className="h-4 w-4 mr-1" />
            Pular
          </Button>
          <Button
            size="md"
            onClick={() => onConfirmar({ autor, reu })}
            disabled={loading}
            className="gap-1.5"
          >
            <Check className="h-4 w-4" />
            Confirmar e continuar
          </Button>
        </>
      }
    >
      <div className="space-y-6 max-h-[60vh] overflow-y-auto">
        {/* Autor */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
            <User className="h-4 w-4 text-primary" />
            Autor (Cliente)
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(LABELS_AUTOR) as (keyof DadosExtraidosAutor)[]).map(key => {
              const valorAtual = autor[key]
              const valorAnterior = dadosAtuaisCliente?.[key]
              return (
                <div key={key} className={key === 'endereco' ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    {LABELS_AUTOR[key]}
                    {isChanged(key) && valorAnterior && (
                      <span className="ml-1 text-warning text-[10px]">(era: {valorAnterior})</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={valorAtual ?? ''}
                    onChange={e => updateAutor(key, e.target.value)}
                    placeholder={`Preencher ${LABELS_AUTOR[key].toLowerCase()}`}
                    className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/40"
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* Réu */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
            <Building2 className="h-4 w-4 text-destructive" />
            Réu (Parte contrária)
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(LABELS_REU) as (keyof DadosExtraidosReu)[]).map(key => {
              const value = reu?.[key]
              return (
                <div key={key} className={key === 'endereco' ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    {LABELS_REU[key]}
                  </label>
                  <input
                    type="text"
                    value={value ?? ''}
                    onChange={e => updateReu(key, e.target.value)}
                    placeholder={`Preencher ${LABELS_REU[key].toLowerCase()}`}
                    className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/40"
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
