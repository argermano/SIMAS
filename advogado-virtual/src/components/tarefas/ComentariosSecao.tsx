'use client'

import { useState, useRef, useEffect, useId, useCallback, type ReactNode } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { formatarDataHora, cn } from '@/lib/utils'
import { MessageSquare, Send } from 'lucide-react'

interface Pessoa { id: string; nome: string | null }

export interface Comentario {
  id:          string
  conteudo:    string
  created_at:  string
  autor?:      Pessoa | null
  autor_nome?: string | null
  mencionados?: Pessoa[]
}

interface TeamMember { id: string; nome: string }

interface Props {
  taskId:       string
  comentarios:  Comentario[] | null
  loading:      boolean
  teamMembers?: TeamMember[]
  /** Chamado após criar um comentário — o pai anexa à lista (mantém o badge). */
  onCreated:    (novo: Comentario) => void
}

// Normaliza para busca sem acento e case-insensitive.
function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function nomeAutor(c: Comentario): string {
  return c.autor?.nome ?? c.autor_nome ?? 'Usuário'
}

function iniciais(nome: string): string {
  return nome.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// "@nome" presente como token: sem letra/dígito colado após (o lookahead evita
// que "@Ana" case dentro de "@Anabela"). Usado para reconciliar as menções no
// envio por posição no texto, não por substring frágil.
function mencaoPresente(texto: string, nome: string): boolean {
  return new RegExp(`@${escapeRegExp(nome)}(?![\\p{L}\\p{N}])`, 'u').test(texto)
}

// Destaca "@Nome" no texto para cada colega mencionado conhecido.
function renderConteudo(c: Comentario): ReactNode {
  const nomes = (c.mencionados ?? [])
    .map(m => m.nome)
    .filter((n): n is string => !!n)
    .sort((a, b) => b.length - a.length) // casa o nome mais específico primeiro
  if (nomes.length === 0) return c.conteudo

  // Lookahead de limite de token: não pinta "@Ana" dentro de "@Anabela".
  const re = new RegExp(`@(?:${nomes.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
  const partes: ReactNode[] = []
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(c.conteudo)) !== null) {
    if (m.index > last) partes.push(c.conteudo.slice(last, m.index))
    partes.push(
      <span key={k++} className="rounded bg-primary/10 px-0.5 font-medium text-primary">{m[0]}</span>,
    )
    last = m.index + m[0].length
  }
  if (last < c.conteudo.length) partes.push(c.conteudo.slice(last))
  return partes
}

/**
 * Seção "Comentários" do modal de tarefa. Lista os comentários (carregados pelo
 * pai, que mantém a contagem do badge) e permite adicionar novos com menções (@)
 * a colegas via POST /api/tasks/[id]/comentarios. O composer abre um autocomplete
 * de menções ao digitar '@' (navegável por teclado). Zero cálculo de prazo.
 */
export function ComentariosSecao({ taskId, comentarios, loading, teamMembers, onCreated }: Props) {
  const { error: toastError } = useToast()
  const membros = teamMembers ?? []

  const [texto,       setTexto]       = useState('')
  const [enviando,    setEnviando]    = useState(false)
  const [mencionados, setMencionados] = useState<Pessoa[]>([])
  // Menu de menção ativo: âncora ('@'), texto digitado e item destacado.
  const [menu, setMenu] = useState<{ start: number; query: string; index: number } | null>(null)

  const areaRef  = useRef<HTMLTextAreaElement | null>(null)
  const caretRef = useRef<number | null>(null) // caret a reaplicar após inserir menção
  const listId   = useId()

  const candidatos = useCallback(
    (query: string) => {
      const q = norm(query)
      return membros.filter(m => norm(m.nome).includes(q)).slice(0, 6)
    },
    [membros],
  )

  // Detecta o token de menção ativo: último '@' antes do caret que inicia palavra.
  function detectar(text: string, caret: number): { start: number; query: string } | null {
    let i = caret - 1
    while (i >= 0 && text[i] !== '@' && text[i] !== '\n') i--
    if (i < 0 || text[i] !== '@') return null
    const antes = i === 0 ? '' : text[i - 1]
    if (antes && !/\s/.test(antes)) return null // e-mail (a@b) não abre menção
    const query = text.slice(i + 1, caret)
    if (query.includes('\n')) return null
    return { start: i, query }
  }

  const atualizarMenu = useCallback(
    (text: string, caret: number) => {
      const d = detectar(text, caret)
      if (!d || candidatos(d.query).length === 0) { setMenu(null); return }
      setMenu({ start: d.start, query: d.query, index: 0 })
    },
    [candidatos],
  )

  // Reaplica o caret após inserir uma menção (o valor mudou fora do teclado).
  useEffect(() => {
    if (caretRef.current != null && areaRef.current) {
      const pos = caretRef.current
      areaRef.current.focus()
      areaRef.current.setSelectionRange(pos, pos)
      caretRef.current = null
    }
  }, [texto])

  function selecionar(m: TeamMember) {
    if (!menu || !areaRef.current) return
    const caret  = areaRef.current.selectionStart ?? texto.length
    const before = texto.slice(0, menu.start)
    const after  = texto.slice(caret)
    const inserido = `@${m.nome} `
    setTexto(before + inserido + after)
    setMencionados(prev => (prev.some(p => p.id === m.id) ? prev : [...prev, { id: m.id, nome: m.nome }]))
    setMenu(null)
    caretRef.current = before.length + inserido.length
  }

  function sincronizarCaret(el: HTMLTextAreaElement) {
    atualizarMenu(el.value, el.selectionStart ?? el.value.length)
  }

  async function enviar() {
    const conteudo = texto.trim()
    if (!conteudo || enviando) return
    // Só envia menções cujo "@nome" ainda está no texto como token (evita menção
    // órfã e o falso-positivo de prefixo: "@Ana" ⊄ "@Anabela").
    const ids = [...new Set(
      mencionados.filter(m => m.nome && mencaoPresente(texto, m.nome)).map(m => m.id),
    )]
    setEnviando(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/comentarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: conteudo, mencionados: ids }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Erro', d.error ?? 'Não foi possível comentar')
        return
      }
      const novo = (d.comentario ?? d) as Comentario
      onCreated(novo)
      setTexto('')
      setMencionados([])
      setMenu(null)
    } finally {
      setEnviando(false)
    }
  }

  const cands = menu ? candidatos(menu.query) : []

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menu && cands.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...menu, index: (menu.index + 1) % cands.length }); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMenu({ ...menu, index: (menu.index - 1 + cands.length) % cands.length }); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selecionar(cands[menu.index]); return }
      if (e.key === 'Escape')    { e.preventDefault(); setMenu(null); return }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); enviar() }
  }

  return (
    <div className="space-y-3">
      {/* Composer */}
      <div className="space-y-2">
        <div className="relative">
          <Textarea
            ref={areaRef}
            rows={2}
            value={texto}
            onChange={e => { setTexto(e.target.value); sincronizarCaret(e.target) }}
            onKeyDown={onKeyDown}
            onKeyUp={e => { if (!menu) sincronizarCaret(e.currentTarget) }}
            onClick={e => sincronizarCaret(e.currentTarget)}
            placeholder="Escreva um comentário… use @ para mencionar"
            role="combobox"
            aria-expanded={!!menu}
            aria-controls={menu ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={menu ? `${listId}-opt-${menu.index}` : undefined}
          />
          {menu && cands.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-md border border-border bg-card py-1 shadow-lg"
            >
              {cands.map((m, i) => (
                <li
                  key={m.id}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={i === menu.index}
                  // mousedown (não click) para não tirar o foco do textarea antes de inserir
                  onMouseDown={e => { e.preventDefault(); selecionar(m) }}
                  onMouseEnter={() => setMenu(prev => (prev ? { ...prev, index: i } : prev))}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                    i === menu.index ? 'bg-primary/10 text-primary' : 'text-foreground',
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/80 text-[10px] font-bold text-white">
                    {iniciais(m.nome)}
                  </span>
                  <span className="truncate">{m.nome}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={enviar} loading={enviando} disabled={!texto.trim()}>
            <Send className="h-4 w-4" /> Comentar
          </Button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner size="sm" /> Carregando comentários…
        </div>
      ) : !comentarios || comentarios.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center text-sm text-muted-foreground">
          <MessageSquare className="h-5 w-5 opacity-60" />
          Nenhum comentário ainda.
        </div>
      ) : (
        <ul className="space-y-3">
          {comentarios.map(c => {
            const nome = nomeAutor(c)
            return (
              <li key={c.id} className="flex gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/80 text-[10px] font-bold text-white">
                  {iniciais(nome)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-foreground">{nome}</span>
                    <span className="text-xs text-muted-foreground">{formatarDataHora(c.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">{renderConteudo(c)}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
