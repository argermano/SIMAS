'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { Plus, X, User } from 'lucide-react'

// Nascimento leve do atendimento (056): registrar a conversa inicial ANTES de
// existir peça. Simples e leve — só Assunto, Etiquetas e o 1º Registro.
const MAX_ETIQUETAS = 8
const MAX_TAG_LEN = 30

interface NovoAtendimentoModalProps {
  open: boolean
  onClose: () => void
  clienteId: string
  clienteNome: string
}

export function NovoAtendimentoModal({ open, onClose, clienteId, clienteNome }: NovoAtendimentoModalProps) {
  const router = useRouter()
  const { error: toastError } = useToast()

  const [titulo, setTitulo] = useState('')
  const [etiquetas, setEtiquetas] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [registro, setRegistro] = useState('')
  const [salvando, setSalvando] = useState(false)

  const podeSalvar = titulo.trim().length > 0 && registro.trim().length > 0 && !salvando

  function adicionarEtiqueta() {
    const t = tagInput.trim().slice(0, MAX_TAG_LEN)
    if (!t) return
    setEtiquetas(prev => (prev.length >= MAX_ETIQUETAS || prev.includes(t) ? prev : [...prev, t]))
    setTagInput('')
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      adicionarEtiqueta()
    } else if (e.key === 'Backspace' && !tagInput && etiquetas.length > 0) {
      setEtiquetas(prev => prev.slice(0, -1))
    }
  }

  function fechar() {
    if (salvando) return
    setTitulo('')
    setEtiquetas([])
    setTagInput('')
    setRegistro('')
    onClose()
  }

  async function salvar() {
    if (!podeSalvar) return
    setSalvando(true)
    try {
      const res = await fetch('/api/atendimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: clienteId,
          titulo: titulo.trim(),
          etiquetas,
          estagio: 'atendimento',
          primeiro_registro: registro.trim(),
          // Atendimento leve não exige área: 'geral' = análise multi-área (sem peça definida).
          area: 'geral',
          modo_input: 'texto',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toastError('Não foi possível criar o atendimento', j?.error)
        setSalvando(false)
        return
      }
      const { id } = await res.json()
      // Vai direto para a Casa do caso recém-criada (navega, não reseta o form).
      router.push(`/clientes/${clienteId}/casos/${id}`)
    } catch {
      toastError('Não foi possível criar o atendimento', 'Verifique a conexão e tente de novo.')
      setSalvando(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={fechar}
      title="Novo atendimento"
      description="Registre a conversa inicial com o cliente. Vira caso quando você quiser."
      footer={
        <>
          <Button variant="secondary" size="md" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button size="md" onClick={salvar} loading={salvando} disabled={!podeSalvar}>
            <Plus className="h-4 w-4" />
            Criar atendimento
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Cliente pré-fixado — nascimento sempre a partir do dossiê do cliente */}
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Cliente:</span>
          <span className="font-medium text-foreground">{clienteNome}</span>
        </div>

        <Input
          label="Assunto"
          required
          value={titulo}
          onChange={e => setTitulo(e.target.value)}
          maxLength={200}
          placeholder="Ex.: Aposentadoria por idade — dúvidas iniciais"
          autoFocus
        />

        {/* Etiquetas: chips digitáveis (Enter adiciona, X remove) */}
        <div>
          <label className="block text-base font-medium text-foreground mb-1.5">Etiquetas</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-2 focus-within:ring-2 focus-within:ring-ring">
            {etiquetas.map(t => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-sm text-muted-foreground"
              >
                {t}
                <button
                  type="button"
                  onClick={() => setEtiquetas(prev => prev.filter(x => x !== t))}
                  className="rounded-full text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Remover etiqueta ${t}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {etiquetas.length < MAX_ETIQUETAS && (
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={onTagKeyDown}
                onBlur={adicionarEtiqueta}
                maxLength={MAX_TAG_LEN}
                placeholder={etiquetas.length ? 'Adicionar…' : 'Digite e tecle Enter (ex.: aposentadoria)'}
                className="flex-1 min-w-[8rem] bg-transparent px-1 py-0.5 text-base outline-none placeholder:text-muted-foreground"
              />
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Enter adiciona · até {MAX_ETIQUETAS} etiquetas</p>
        </div>

        <Textarea
          label="Primeiro registro"
          required
          value={registro}
          onChange={e => setRegistro(e.target.value)}
          maxLength={8000}
          rows={5}
          placeholder="Anotações da conversa com o cliente..."
        />
      </div>
    </Dialog>
  )
}

// Botão + modal auto-contidos: permite acionar o nascimento leve a partir de
// um Server Component (a página do cliente) sem torná-la client.
export function NovoAtendimentoButton({ clienteId, clienteNome }: { clienteId: string; clienteNome: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="md" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Novo Atendimento
      </Button>
      {open && (
        <NovoAtendimentoModal
          open={open}
          onClose={() => setOpen(false)}
          clienteId={clienteId}
          clienteNome={clienteNome}
        />
      )}
    </>
  )
}
