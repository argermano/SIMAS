'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { Send } from 'lucide-react'

/**
 * Envia uma mensagem de WhatsApp ao cliente SEM sair da tela do atendimento
 * (pedido do dono): faltou documento ou surgiu um pedido extra → o atendente
 * escreve aqui e dispara pelo canal do escritório. A mensagem enviada vira um
 * registro no diário do atendimento (a rota grava; o refresh mostra na hora).
 */
export function EnviarWhatsAppModal({
  aberto,
  onFechar,
  atendimentoId,
  clienteNome,
  telefoneExibicao,
}: {
  aberto: boolean
  onFechar: () => void
  atendimentoId: string
  clienteNome: string
  telefoneExibicao: string
}) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  const podeEnviar = texto.trim().length >= 5 && !enviando

  async function enviar() {
    if (!podeEnviar) return
    setEnviando(true)
    try {
      const r = await fetch(`/api/atendimentos/${atendimentoId}/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: texto.trim() }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não enviado', (d as { error?: string }).error ?? 'Tente novamente.')
        return
      }
      success('Mensagem enviada!', `WhatsApp enviado para ${clienteNome}.`)
      setTexto('')
      onFechar()
      router.refresh() // o registro novo aparece no diário
    } catch {
      toastError('Não enviado', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={aberto}
      onClose={() => { if (!enviando) onFechar() }}
      title="Enviar WhatsApp ao cliente"
      description={`${clienteNome} · ${telefoneExibicao}`}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button size="md" onClick={enviar} loading={enviando} disabled={!podeEnviar}>
            <Send className="h-4 w-4" />
            Enviar
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Textarea
          label="Mensagem"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void enviar() }
          }}
          maxLength={2000}
          rows={5}
          autoFocus
          placeholder="Ex.: Olá! Para darmos andamento, precisamos da foto do seu RG e do comprovante de residência. Pode enviar por aqui mesmo?"
          disabled={enviando}
        />
        <p className="text-xs text-muted-foreground">
          Enviada pelo número do escritório. A mensagem fica registrada no diário deste atendimento.
        </p>
      </div>
    </Dialog>
  )
}
