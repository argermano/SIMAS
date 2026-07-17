'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { AnexosClientePicker, type ItemAnexo } from '@/components/clientes/AnexosClientePicker'
import { Send } from 'lucide-react'

/**
 * Envia uma mensagem de WhatsApp ao cliente SEM sair da tela do atendimento
 * (pedido do dono): faltou documento ou surgiu um pedido extra → o atendente
 * escreve aqui e dispara pelo canal do escritório. A mensagem vira um registro
 * no diário do atendimento (a rota grava; o refresh mostra na hora).
 *
 * Também permite ANEXAR documentos/peças do próprio cliente (AnexosClientePicker).
 * Tudo (texto e anexos) sai pelo canal do bot (Evolution) — funciona para qualquer
 * número, mesmo cliente novo sem conversa aberta. O texto vira a legenda do 1º doc.
 */
export function EnviarWhatsAppModal({
  aberto,
  onFechar,
  atendimentoId,
  clienteId,
  clienteNome,
  telefoneExibicao,
}: {
  aberto: boolean
  onFechar: () => void
  atendimentoId: string
  clienteId: string
  clienteNome: string
  telefoneExibicao: string
}) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [selecionados, setSelecionados] = useState<ItemAnexo[]>([])

  const textoTrim = texto.trim()
  const textoValido = textoTrim.length >= 5
  const temAnexos = selecionados.length > 0
  // Com anexos, o texto é OPCIONAL (vira legenda). Se digitado, precisa 5+ (regra
  // da rota) — 1..4 chars bloqueia para não surpreender com erro do servidor.
  const podeEnviar = !enviando && (textoValido || (temAnexos && textoTrim.length === 0))

  function limpar() {
    setTexto('')
    setSelecionados([])
  }

  function fechar() {
    if (enviando) return
    limpar()
    onFechar()
  }

  async function enviar() {
    if (!podeEnviar) return
    setEnviando(true)
    try {
      const body: { texto?: string; anexos?: Array<{ documentoId?: string; pecaId?: string }> } = {}
      if (textoValido) body.texto = textoTrim
      if (temAnexos) {
        body.anexos = selecionados.map((s) => (s.origem === 'peca' ? { pecaId: s.id } : { documentoId: s.id }))
      }

      const r = await fetch(`/api/atendimentos/${atendimentoId}/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!r.ok) {
        // Anexos saem pelo canal do bot (qualquer número) — sem exigência de
        // conversa aberta nem conta conectada; erro aqui é falha real de envio.
        toastError('Não enviado', d.error ?? 'Tente novamente.')
        return
      }
      success(
        'Mensagem enviada!',
        temAnexos
          ? `WhatsApp com ${selecionados.length} documento${selecionados.length > 1 ? 's' : ''} enviado para ${clienteNome}.`
          : `WhatsApp enviado para ${clienteNome}.`,
      )
      limpar()
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
      onClose={fechar}
      title="Enviar WhatsApp ao cliente"
      description={`${clienteNome} · ${telefoneExibicao}`}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={fechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button size="md" onClick={enviar} loading={enviando} disabled={!podeEnviar}>
            <Send className="h-4 w-4" />
            Enviar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Textarea
          label="Mensagem"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void enviar() }
          }}
          maxLength={2000}
          rows={4}
          autoFocus
          placeholder={
            temAnexos
              ? 'Opcional: esta mensagem vira a legenda do primeiro documento.'
              : 'Ex.: Olá! Para darmos andamento, precisamos da foto do seu RG e do comprovante de residência. Pode enviar por aqui mesmo?'
          }
          disabled={enviando}
        />

        <AnexosClientePicker
          clienteId={clienteId}
          selecionados={selecionados}
          onChange={setSelecionados}
          disabled={enviando}
        />

        <p className="text-xs text-muted-foreground">
          Enviada pelo número do escritório. A mensagem fica registrada no diário deste atendimento.
        </p>
      </div>
    </Dialog>
  )
}
