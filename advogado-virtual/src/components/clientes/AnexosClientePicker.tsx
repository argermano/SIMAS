'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { Paperclip, Search, X, FileText, ScrollText, Check } from 'lucide-react'

/**
 * Seletor de anexos do CLIENTE (documentos + peças), controlado. Extraído do
 * EnviarWhatsAppModal para ser reusado pelo envio de mensagem em qualquer tela com
 * cliente selecionado (dossiê, Estudo de Caso, caso). Lista GET
 * /api/conversas/documentos?clienteId=&incluirPecas=1 — pós-063 o filtro por
 * cliente já traz documentos gerais + de casos + de processos + peças do cliente.
 * Só o servidor valida a posse no envio; aqui é conveniência de escolha.
 */

export const MAX_ANEXOS = 5

export type Origem = 'documento' | 'peca'

// Item normalizado do picker: a GET devolve DUAS formas (documento vs. peça).
export interface ItemAnexo {
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

export function AnexosClientePicker({
  clienteId,
  selecionados,
  onChange,
  disabled,
}: {
  clienteId: string
  selecionados: ItemAnexo[]
  onChange: (itens: ItemAnexo[]) => void
  disabled?: boolean
}) {
  const { error: toastError } = useToast()
  const [mostrarPicker, setMostrarPicker] = useState(false)
  const [q, setQ] = useState('')
  const [itens, setItens] = useState<ItemAnexo[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const buscaSeq = useRef(0)

  const temAnexos = selecionados.length > 0

  // Carrega documentos+peças do cliente ao abrir o picker / a cada busca.
  useEffect(() => {
    if (!mostrarPicker) return
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
  }, [mostrarPicker, q, clienteId])

  function estaSelecionado(item: ItemAnexo): boolean {
    return selecionados.some((s) => s.origem === item.origem && s.id === item.id)
  }

  function alternar(item: ItemAnexo) {
    if (selecionados.some((s) => s.origem === item.origem && s.id === item.id)) {
      onChange(selecionados.filter((s) => !(s.origem === item.origem && s.id === item.id)))
      return
    }
    if (selecionados.length >= MAX_ANEXOS) {
      toastError('Limite de anexos', `Você pode enviar até ${MAX_ANEXOS} documentos por vez.`)
      return
    }
    onChange([...selecionados, item])
  }

  return (
    <>
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
                disabled={disabled}
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
          disabled={disabled}
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
                disabled={disabled}
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
                        disabled={disabled}
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
    </>
  )
}
