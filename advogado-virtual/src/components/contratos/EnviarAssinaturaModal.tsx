'use client'

import { useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { Plus, Trash2, FileSignature, Loader2 } from 'lucide-react'

interface Signer {
  name:        string
  email:       string
  cpf_cnpj:    string
  phone:       string
  act:         '1' | '2' | '5'
  auth_method: 'email' | 'sms' | 'whatsapp' | 'pix'
}

interface EnviarAssinaturaModalProps {
  contratoId:       string
  tituloContrato:   string
  clienteNome?:     string
  clienteEmail?:    string
  clienteCpf?:      string
  clienteTelefone?: string
  tenantNome?:      string | null
  tenantEmail?:     string | null
  tenantCpf?:       string | null
  tenantTelefone?:  string | null
  open:             boolean
  onClose:          () => void
  onSent:           () => void
}

const ACT_OPTIONS = [
  { value: '1', label: 'Assinar' },
  { value: '2', label: 'Aprovar' },
  { value: '5', label: 'Testemunha' },
]

const AUTH_OPTIONS = [
  { value: 'email',    label: 'E-mail' },
  { value: 'sms',      label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'pix',      label: 'Pix' },
]

const STEP_LABELS = ['Gerando documento…', 'Cadastrando signatários…', 'Enviando para assinatura…']

function makeSigner(
  nome?: string | null,
  email?: string | null,
  cpf?: string | null,
  telefone?: string | null,
): Signer {
  return {
    name:        nome     ?? '',
    email:       email    ?? '',
    cpf_cnpj:    cpf      ?? '',
    phone:       telefone ?? '',
    act:         '1',
    auth_method: 'email',
  }
}

export function EnviarAssinaturaModal({
  contratoId, tituloContrato,
  clienteNome, clienteEmail, clienteCpf, clienteTelefone,
  tenantNome, tenantEmail, tenantCpf, tenantTelefone,
  open, onClose, onSent,
}: EnviarAssinaturaModalProps) {
  const { success, error: toastError } = useToast()

  const [signers,   setSigners]   = useState<Signer[]>([
    makeSigner(clienteNome, clienteEmail, clienteCpf, clienteTelefone),
    makeSigner(tenantNome, tenantEmail, tenantCpf, tenantTelefone),
  ])
  const [workflow,  setWorkflow]  = useState(false)
  const [message,   setMessage]   = useState('')
  const [enviando,  setEnviando]  = useState(false)
  const [step,      setStep]      = useState(0)

  function addSigner() {
    setSigners(prev => [...prev, { name: '', email: '', cpf_cnpj: '', phone: '', act: '1', auth_method: 'email' }])
  }

  function removeSigner(idx: number) {
    setSigners(prev => prev.filter((_, i) => i !== idx))
  }

  function updateSigner(idx: number, field: keyof Signer, value: string) {
    setSigners(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  async function handleSubmit() {
    if (signers.some(s => !s.name.trim() || !s.email.trim())) {
      toastError('Campos obrigatórios', 'Preencha nome e email de todos os signatários')
      return
    }

    setEnviando(true)
    setStep(0)

    // Simular progresso de steps (o backend faz tudo em 1 chamada)
    const stepTimer1 = setTimeout(() => setStep(1), 1500)
    const stepTimer2 = setTimeout(() => setStep(2), 3000)

    try {
      const res = await fetch(`/api/contratos/${contratoId}/assinar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signers: signers.map((s, idx) => ({
            name:        s.name.trim(),
            email:       s.email.trim().toLowerCase(),
            cpf_cnpj:    s.cpf_cnpj.trim() || undefined,
            phone:       s.phone.trim()    || undefined,
            act:         s.act,
            auth_method: s.auth_method,
            sign_order:  workflow ? idx + 1 : undefined,
          })),
          message: message.trim() || undefined,
          workflow,
        }),
      })

      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)

      if (!res.ok) {
        const d = await res.json()
        toastError('Erro ao enviar', d.error ?? 'Tente novamente')
        return
      }

      success('Enviado para assinatura!', 'Os signatários receberão o link por email.')
      onSent()
      onClose()
    } catch {
      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)
      toastError('Erro', 'Falha de rede ao enviar para assinatura')
    } finally {
      setEnviando(false)
      setStep(0)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Enviar para Assinatura Digital"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={enviando} className="gap-2 min-w-[200px]">
            {enviando
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {STEP_LABELS[step]}</>
              : <><FileSignature className="h-4 w-4" /> Enviar para Assinatura</>
            }
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Documento */}
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
          <FileSignature className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Documento:</span>
          <span className="font-medium text-foreground truncate">{tituloContrato}</span>
        </div>

        {/* Signatários */}
        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Signatários</p>
          <div className="space-y-3">
            {signers.map((s, idx) => (
              <div key={idx} className="rounded-lg border border-border bg-muted/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Signatário {idx + 1}{idx === 0 ? ' (Cliente)' : idx === 1 ? ' (Advogado)' : ''}
                  </span>
                  {signers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSigner(idx)}
                      className="text-border hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Nome completo *"
                    value={s.name}
                    onChange={e => updateSigner(idx, 'name', e.target.value)}
                  />
                  <Input
                    placeholder="Email *"
                    type="email"
                    value={s.email}
                    onChange={e => updateSigner(idx, 'email', e.target.value)}
                  />
                  <Input
                    placeholder="CPF/CNPJ (opcional)"
                    value={s.cpf_cnpj}
                    onChange={e => updateSigner(idx, 'cpf_cnpj', e.target.value)}
                  />
                  <Input
                    placeholder="WhatsApp (opcional)"
                    value={s.phone}
                    onChange={e => updateSigner(idx, 'phone', e.target.value)}
                  />
                  <Select
                    value={s.act}
                    onChange={e => updateSigner(idx, 'act', e.target.value)}
                    options={ACT_OPTIONS}
                    label=""
                  />
                  <Select
                    value={s.auth_method}
                    onChange={e => updateSigner(idx, 'auth_method', e.target.value)}
                    options={AUTH_OPTIONS}
                    label=""
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addSigner}
            className="mt-2 flex items-center gap-1.5 text-sm text-primary hover:text-primary font-medium"
          >
            <Plus className="h-4 w-4" />
            Adicionar signatário
          </button>
        </div>

        {/* Workflow */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={workflow}
            onChange={e => setWorkflow(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary"
          />
          <span className="text-sm text-foreground">Exigir assinatura em ordem sequencial</span>
        </label>

        {/* Mensagem */}
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Mensagem para os signatários <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            placeholder="Prezado(a), segue contrato de honorários advocatícios para assinatura..."
            className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>
      </div>
    </Dialog>
  )
}
