'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { Send, Paperclip, Search, X, FileText, ScrollText, Check } from 'lucide-react'

/**
 * Envia uma mensagem de WhatsApp ao cliente SEM sair da tela do atendimento
 * (pedido do dono): faltou documento ou surgiu um pedido extra → o atendente
 * escreve aqui e dispara pelo canal do escritório. A mensagem vira um registro
 * no diário do atendimento (a rota grava; o refresh mostra na hora).
 *
 * Também permite ANEXAR documentos/peças do próprio cliente. Tudo (texto e
 * anexos) sai pelo canal do bot (Evolution) — funciona para qualquer número,
 * mesmo cliente novo sem conversa aberta. O texto vira legenda do 1º documento.
 */

const MAX_ANEXOS = 5

type Origem = 'documento' | 'peca'

// Item normalizado do picker: a GET devolve DUAS formas (documento vs. peça).
interface ItemAnexo {
  id: string
  origem: Origem
  nome: string
  tamanho: number | null
}

// Formas cruas da GET /api/conversas/documentos?incluirPecas=1.
interface DocumentoBruto { id: string; origem?: 'documento'; nome: string | null; tamanho: number | null }
interface PecaBruta { id: string; origem: 'peca'; file_name: string; mime_type: string }

/** bytes -> "1,2 MB" / "340 KB" (pt-BR curto). null quando não informado. */
function tamanhoLegivel(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

function normalizar(raw: DocumentoBruto | PecaBruta): ItemAnexo {
  if (raw.origem === 'peca') {
    return { id: raw.id, origem: 'peca', nome: raw.file_name, tamanho: null }
  }
  return { id: raw.id, origem: 'documento', nome: raw.nome || 'Documento', tamanho: raw.tamanho }
}

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

  // Seletor de anexos (expansível dentro do modal).
  const [mostrarPicker, setMostrarPicker] = useState(false)
  const [q, setQ] = useState('')
  const [itens, setItens] = useState<ItemAnexo[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<ItemAnexo[]>([])
  const buscaSeq = useRef(0)

  const textoTrim = texto.trim()
  const textoValido = textoTrim.length >= 5
  const temAnexos = selecionados.length > 0
  // Com anexos, o texto é OPCIONAL (vira legenda). Se digitado, precisa 5+ (regra
  // da rota) — 1..4 chars bloqueia para não surpreender com erro do servidor.
  const podeEnviar = !enviando && (textoValido || (temAnexos && textoTrim.length === 0))

  // Carrega documentos+peças do cliente ao abrir o picker / a cada busca.
  useEffect(() => {
    if (!aberto || !mostrarPicker) return
    const seq = ++buscaSeq.current
    setCarregando(true)
    setErroLista(null)
    const termo = q.trim()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ clienteId, incluirPecas: '1' })
        if (termo) params.set('q', termo)
        const r = await fetch(`/api/conversas/documentos?${params.toString()}`)
        const d = await r.json().catch(() => ({}))
        if (seq !== buscaSeq.current) return
        if (!r.ok) {
          setErroLista('Não foi possível carregar os documentos.')
          setItens([])
        } else {
          const lista = (d as { documentos?: Array<DocumentoBruto | PecaBruta> }).documentos
          setItens(Array.isArray(lista) ? lista.map(normalizar) : [])
        }
      } catch {
        if (seq === buscaSeq.current) {
          setErroLista('Falha de rede ao carregar os documentos.')
          setItens([])
        }
      } finally {
        if (seq === buscaSeq.current) setCarregando(false)
      }
    }, termo ? 300 : 0)
    return () => clearTimeout(timer)
  }, [aberto, mostrarPicker, q, clienteId])

  function estaSelecionado(item: ItemAnexo): boolean {
    return selecionados.some((s) => s.origem === item.origem && s.id === item.id)
  }

  function alternar(item: ItemAnexo) {
    setSelecionados((atual) => {
      if (atual.some((s) => s.origem === item.origem && s.id === item.id)) {
        return atual.filter((s) => !(s.origem === item.origem && s.id === item.id))
      }
      if (atual.length >= MAX_ANEXOS) {
        toastError('Limite de anexos', `Você pode enviar até ${MAX_ANEXOS} documentos por vez.`)
        return atual
      }
      return [...atual, item]
    })
  }

  function limpar() {
    setTexto('')
    setSelecionados([])
    setMostrarPicker(false)
    setQ('')
    setItens(null)
    setErroLista(null)
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

        {/* Chips dos anexos escolhidos */}
        {temAnexos && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Documentos anexados">
            {selecionados.map((s) => (
              <li
                key={`${s.origem}:${s.id}`}
                className="flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1 text-xs text-primary"
              >
                {s.origem === 'peca' ? <ScrollText className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span className="truncate">{s.nome}</span>
                <button
                  type="button"
                  onClick={() => alternar(s)}
                  disabled={enviando}
                  aria-label={`Remover ${s.nome}`}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-primary/20 disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Anexar documentos do cliente */}
        <div>
          <button
            type="button"
            onClick={() => setMostrarPicker((v) => !v)}
            disabled={enviando}
            aria-expanded={mostrarPicker}
            className="flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Anexar documentos do cliente
          </button>

          {mostrarPicker && (
            <div className="mt-2 space-y-2 rounded-lg border border-border p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar documento ou peça pelo nome…"
                  aria-label="Buscar documento"
                  className="h-9 pl-9 text-sm"
                  disabled={enviando}
                />
              </div>

              {carregando ? (
                <p className="flex items-center gap-2 px-1 py-3 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5" /> Carregando documentos…
                </p>
              ) : erroLista ? (
                <p className="px-1 py-2 text-xs text-destructive">{erroLista}</p>
              ) : itens && itens.length > 0 ? (
                <ul className="max-h-56 overflow-y-auto rounded-lg border border-border" aria-label="Documentos e peças do cliente">
                  {itens.map((item) => {
                    const sel = estaSelecionado(item)
                    const tam = tamanhoLegivel(item.tamanho)
                    const rotuloTipo = item.origem === 'peca' ? 'Peça' : 'Documento'
                    return (
                      <li key={`${item.origem}:${item.id}`}>
                        <button
                          type="button"
                          onClick={() => alternar(item)}
                          disabled={enviando}
                          aria-pressed={sel}
                          className={cn(
                            'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0',
                            'hover:bg-muted disabled:opacity-60',
                            sel && 'bg-primary/5',
                          )}
                        >
                          {item.origem === 'peca' ? (
                            <ScrollText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          ) : (
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-foreground">{item.nome}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[rotuloTipo, tam].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          {sel && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="px-1 py-3 text-xs text-muted-foreground">
                  {q.trim() ? 'Nenhum documento encontrado.' : 'Este cliente ainda não tem documentos ou peças.'}
                </p>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Enviada pelo número do escritório. A mensagem fica registrada no diário deste atendimento.
        </p>
      </div>
    </Dialog>
  )
}
