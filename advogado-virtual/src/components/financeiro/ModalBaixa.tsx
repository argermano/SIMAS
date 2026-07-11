'use client'

import { useEffect, useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { formatarMoedaInput, moedaParaNumero, formatarData } from '@/lib/utils'
import { formatarValor } from '@/lib/financeiro/parcelas'
import { type Parcela, LABELS_MEIO, hojeISO } from './tipos'

const MAX_COMPROVANTE_BYTES = 4 * 1024 * 1024 // 4 MB
// Tipos aceitos pela rota /baixa (jpeg, png, webp, gif ou pdf)
const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']

interface ModalBaixaProps {
  parcela: Parcela | null
  onClose: () => void
  onDone: () => void
}

/**
 * Modal de baixa manual de parcela.
 * Invariante do módulo: a baixa é SEMPRE uma ação humana — este modal é o clique de confirmação.
 */
export function ModalBaixa({ parcela, onClose, onDone }: ModalBaixaProps) {
  const { success, error: toastError } = useToast()
  const [meio, setMeio]       = useState('pix')
  const [pagoEm, setPagoEm]   = useState(hojeISO())
  const [valor, setValor]     = useState('')
  const [obs, setObs]         = useState('')
  const [arquivo, setArquivo] = useState<{ nome: string; base64: string; contentType: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Reinicia o formulário a cada parcela aberta.
  useEffect(() => {
    if (!parcela) return
    setMeio('pix')
    setPagoEm(hojeISO())
    setValor(formatarMoedaInput(String(parcela.valor_centavos)))
    setObs('')
    setArquivo(null)
  }, [parcela])

  function escolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_COMPROVANTE_BYTES) {
      toastError('Arquivo muito grande', 'O comprovante deve ter no máximo 4 MB.')
      return
    }
    if (!TIPOS_ACEITOS.includes(file.type)) {
      toastError('Formato não aceito', 'Envie imagem (JPG, PNG, WebP, GIF) ou PDF.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const resultado = String(reader.result ?? '')
      const base64 = resultado.split(',')[1] ?? ''
      if (!base64) { toastError('Não foi possível ler o arquivo', 'Tente outro formato.'); return }
      setArquivo({ nome: file.name, base64, contentType: file.type || 'application/octet-stream' })
    }
    reader.onerror = () => toastError('Não foi possível ler o arquivo', 'Tente novamente.')
    reader.readAsDataURL(file)
  }

  async function confirmar() {
    if (!parcela) return
    const valorReais = moedaParaNumero(valor)
    if (!valorReais || valorReais <= 0) {
      toastError('Valor inválido', 'Informe o valor efetivamente pago.')
      return
    }
    if (!pagoEm) {
      toastError('Data inválida', 'Informe a data do pagamento.')
      return
    }
    setSalvando(true)
    try {
      const r = await fetch(`/api/financeiro/parcelas/${parcela.id}/baixa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meio,
          pagoEm,
          valorPago: Math.round(valorReais * 100),
          obs: obs.trim() || undefined,
          ...(arquivo ? { comprovanteBase64: arquivo.base64, contentType: arquivo.contentType } : {}),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível dar baixa', d.error ?? 'Tente novamente.')
        return
      }
      success('Pagamento registrado', `${parcela.descricao} — ${formatarValor(Math.round(valorReais * 100))}`)
      onDone()
    } catch {
      toastError('Falha de rede', 'Não foi possível falar com o servidor.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog
      open={Boolean(parcela)}
      onClose={onClose}
      title="Dar baixa na parcela"
      description={parcela ? `${parcela.cliente_nome ?? 'Cliente'} · ${parcela.descricao} · vence ${formatarData(parcela.vencimento)}` : undefined}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={salvando}>Voltar</Button>
          <Button size="md" onClick={confirmar} loading={salvando}>Confirmar baixa</Button>
        </>
      }
    >
      {parcela && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Valor da parcela:</span>{' '}
            <span className="font-semibold tabular-nums text-foreground">{formatarValor(parcela.valor_centavos)}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Meio de pagamento"
              value={meio}
              onChange={(e) => setMeio(e.target.value)}
              options={Object.entries(LABELS_MEIO).map(([value, label]) => ({ value, label }))}
            />
            <Input label="Data do pagamento" type="date" value={pagoEm} max={hojeISO()} onChange={(e) => setPagoEm(e.target.value)} />
          </div>

          <Input
            label="Valor pago"
            inputMode="numeric"
            value={valor}
            onChange={(e) => setValor(formatarMoedaInput(e.target.value))}
            hint="Ajuste se o cliente pagou valor diferente do combinado."
          />

          <Textarea
            label="Observação (opcional)"
            rows={2}
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="ex.: pagamento parcial combinado por telefone"
          />

          {/* Comprovante opcional */}
          <div>
            <input ref={fileRef} type="file" accept={TIPOS_ACEITOS.join(',')} className="hidden" onChange={escolherArquivo} />
            {arquivo ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-foreground">{arquivo.nome}</span>
                <button
                  type="button"
                  onClick={() => setArquivo(null)}
                  className="rounded-md p-1 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Remover comprovante"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                <Paperclip className="h-4 w-4" /> Anexar comprovante (opcional)
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
