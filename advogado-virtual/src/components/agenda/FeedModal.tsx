'use client'

// Modal "Conectar ao meu calendário" (Peça 1 — Agenda Conectada):
// mostra a URL do feed ICS pessoal (GET /api/agenda/feed), com botão de copiar,
// instruções curtas para Google Agenda/Outlook e "Gerar novo link" (rotação de
// token via POST /api/agenda/feed, com confirmação — o link antigo é invalidado).

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react'
import { Dialog, ConfirmDialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface FeedModalProps {
  aberto: boolean
  onFechar: () => void
}

export function FeedModal({ aberto, onFechar }: FeedModalProps) {
  const { success: toastOk, error: toastErro } = useToast()

  const [url, setUrl] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [confirmarRotacao, setConfirmarRotacao] = useState(false)
  const [rotacionando, setRotacionando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(false)
    try {
      const res = await fetch('/api/agenda/feed')
      if (!res.ok) throw new Error('Falha ao obter o link do feed')
      const dados = (await res.json()) as { url?: string }
      if (!dados.url) throw new Error('Resposta sem URL')
      setUrl(dados.url)
    } catch {
      setErro(true)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    if (aberto) {
      setCopiado(false)
      void carregar()
    }
  }, [aberto, carregar])

  async function copiar() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toastErro('Não foi possível copiar', 'Selecione o link e copie manualmente.')
    }
  }

  async function rotacionar() {
    setRotacionando(true)
    try {
      const res = await fetch('/api/agenda/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'rotacionar' }),
      })
      if (!res.ok) throw new Error('Falha ao gerar novo link')
      const dados = (await res.json()) as { url?: string }
      if (!dados.url) throw new Error('Resposta sem URL')
      setUrl(dados.url)
      setCopiado(false)
      setConfirmarRotacao(false)
      toastOk('Novo link gerado', 'O link anterior deixou de funcionar.')
    } catch {
      toastErro('Não foi possível gerar um novo link')
    } finally {
      setRotacionando(false)
    }
  }

  return (
    <>
      <Dialog
        open={aberto}
        onClose={onFechar}
        title="Conectar ao meu calendário"
        description="Assine este link no seu calendário para ver seus compromissos do SIMAS."
        size="md"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmarRotacao(true)}
              disabled={carregando || !url}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Gerar novo link
            </Button>
            <Button variant="ghost" size="sm" onClick={onFechar}>
              Fechar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {carregando ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Gerando seu link pessoal...
            </div>
          ) : erro ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
              Não foi possível obter o link do feed.
              <Button variant="secondary" size="sm" onClick={() => void carregar()}>
                Tentar de novo
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={url ?? ''}
                aria-label="URL do feed do calendário"
                onFocus={e => e.currentTarget.select()}
                className="h-10 w-full rounded-md border border-input bg-muted/40 px-3 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={() => void copiar()}
                aria-label={copiado ? 'Link copiado' : 'Copiar link'}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {copiado ? (
                  <Check className="h-4 w-4 text-success" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
          )}

          {/* 1 clique: o deep-link cid= abre o "Adicionar agenda?" direto no Google —
              contorna o formulário "Do URL", que falha com erro genérico em navegador
              com várias contas Google logadas (caso real do dono). */}
          {url && (
            <a
              href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Adicionar ao Google Agenda (1 clique)
            </a>
          )}

          <div className="space-y-3 text-sm text-muted-foreground">
            <div>
              <p className="font-semibold text-foreground">Google Agenda</p>
              <p>
                Prefira o botão acima. Manualmente: em{' '}
                <span className="font-medium text-foreground">Outros calendários</span>,
                clique em <span className="font-medium text-foreground">+</span> →{' '}
                <span className="font-medium text-foreground">Do URL</span> e cole o link acima
                — de preferência numa janela com só uma conta Google logada.
              </p>
            </div>
            <div>
              <p className="font-semibold text-foreground">Outlook</p>
              <p>
                Em <span className="font-medium text-foreground">Adicionar calendário</span> →{' '}
                <span className="font-medium text-foreground">Assinar da Web</span>, cole o link acima.
              </p>
            </div>
            <p className="text-xs">
              O link é pessoal e inclui seus compromissos (inclusive os particulares) — não o
              compartilhe. O calendário externo atualiza sozinho, em geral em algumas horas.
            </p>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmarRotacao}
        onClose={() => setConfirmarRotacao(false)}
        onConfirm={() => void rotacionar()}
        title="Gerar novo link?"
        description="O link atual deixará de funcionar em todos os calendários onde foi adicionado. Você precisará assinar o novo link novamente."
        confirmLabel="Gerar novo link"
        variant="danger"
        loading={rotacionando}
      />
    </>
  )
}
