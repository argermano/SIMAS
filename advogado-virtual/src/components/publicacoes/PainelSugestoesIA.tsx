'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AlertTriangle, CalendarClock, CheckCheck, RefreshCw, Sparkles, ThumbsDown, Trash2 } from 'lucide-react'
import { PRIORIDADE_OPCOES, type Prioridade, type TeamMember } from './tipos'
import type { TratamentoPayload, TarefaTratamento } from './PainelTratamento'
import type { MotivoTrecho, SugestoesIA, TrechoImportante } from '@/lib/publicacoes/sugestoes-prompt'

/* ── Cores de destaque por MOTIVO (tokens semânticos; nada de urgência-por-prazo
 * fora do "prazo" em rosa/vermelho suave). Usadas no <mark> do inteiro teor e nos
 * chips da legenda. ───────────────────────────────────────────────────────── */
const COR_MARK: Record<MotivoTrecho, string> = {
  prazo:     'bg-destructive/15 text-destructive',
  decisao:   'bg-primary/15 text-primary',
  intimacao: 'bg-warning/20 text-warning',
  valor:     'bg-success/15 text-success',
  outro:     'bg-muted text-foreground',
}
const ROTULO_MOTIVO: Record<MotivoTrecho, string> = {
  prazo: 'Prazo', decisao: 'Decisão', intimacao: 'Intimação', valor: 'Valor', outro: 'Trecho',
}

/* ── Inteiro teor com DESTAQUES seguros ──────────────────────────────────────
 * O texto é PLANO (nunca innerHTML); marcamos as citações da IA envolvendo os
 * matches por substring em <mark> — sem risco de quebrar tags. Primeira ocorrência
 * de cada trecho, sem sobreposição. */
interface Segmento { text: string; motivo?: MotivoTrecho }

function segmentar(texto: string, trechos: TrechoImportante[]): Segmento[] {
  const ranges: Array<{ start: number; end: number; motivo: MotivoTrecho }> = []
  for (const t of trechos) {
    if (!t.texto) continue
    const start = texto.indexOf(t.texto)
    if (start === -1) continue
    ranges.push({ start, end: start + t.texto.length, motivo: t.motivo })
  }
  ranges.sort((a, b) => a.start - b.start)

  const segs: Segmento[] = []
  let pos = 0
  let ultimoFim = -1
  for (const r of ranges) {
    if (r.start < ultimoFim) continue // ignora sobreposição
    if (r.start > pos) segs.push({ text: texto.slice(pos, r.start) })
    segs.push({ text: texto.slice(r.start, r.end), motivo: r.motivo })
    pos = r.end
    ultimoFim = r.end
  }
  if (pos < texto.length) segs.push({ text: texto.slice(pos) })
  return segs
}

/** Inteiro teor plano com os trechos da IA realçados. Sem destaques ⇒ texto puro. */
export function TeorDestacado({ texto, trechos }: { texto: string; trechos: TrechoImportante[] }) {
  const segs = trechos.length > 0 ? segmentar(texto, trechos) : [{ text: texto } as Segmento]
  return (
    <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/20 p-3.5 text-sm font-sans leading-relaxed text-foreground">
      {segs.map((s, i) =>
        s.motivo ? (
          <mark
            key={i}
            className={cn('rounded px-0.5', COR_MARK[s.motivo])}
            title={`${ROTULO_MOTIVO[s.motivo]} (destacado pela IA)`}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </pre>
  )
}

/* ── Painel de tratamento SUGERIDO pela IA ──────────────────────────────────── */
interface CardSugestao {
  key: string
  titulo: string
  prioridade: Prioridade
  assigneeId: string
  dueDate: string // SEMPRE '' inicial — prazo é decisão humana, nunca pré-preenchido
  temPrazoNoTexto: boolean
  trechoDoPrazo?: string
}

let seq = 0
function cardsIniciais(sugestoes: SugestoesIA, assigneePadrao: string): CardSugestao[] {
  return sugestoes.tarefas.map((t) => ({
    key: `sug-${seq++}`,
    titulo: t.titulo,
    prioridade: t.prioridade, // 'alta' | 'media' | 'baixa' ⊂ Prioridade
    assigneeId: assigneePadrao,
    dueDate: '',
    temPrazoNoTexto: t.temPrazoNoTexto,
    trechoDoPrazo: t.trechoDoPrazo,
  }))
}

interface Props {
  sugestoes: SugestoesIA
  teamMembers: TeamMember[]
  /** Default do responsável nos cartões (usuário logado). */
  currentUserId: string
  ocupado: boolean
  /** Cria as tarefas restantes pelo MESMO fluxo de triagem (acao 'tratar'). */
  onConcluir: (payload: TratamentoPayload) => void
  /** 'Excluir sugestões' — limpa o painel (não mexe no cache). */
  onExcluir: () => void
  /** Força UMA re-geração no servidor. */
  onRegerar: () => void
  regenerando?: boolean
}

/**
 * Estação de tratamento SUGERIDO pela IA (paridade com o Astrea): cards de tarefa
 * editáveis (título/prioridade/responsável), descartáveis (👎). Tarefa com prazo no
 * texto mostra a CITAÇÃO + um campo de data VAZIO ('Prazo (defina manualmente)') —
 * obrigatório digitar OU deixar sem data, NUNCA pré-preenchido. 'Confirmar
 * tratamento' cria as tarefas restantes; a nota ganha o resumo da IA (editável).
 */
export function PainelSugestoesIA({
  sugestoes,
  teamMembers,
  currentUserId,
  ocupado,
  onConcluir,
  onExcluir,
  onRegerar,
  regenerando = false,
}: Props) {
  const [nota, setNota] = useState(sugestoes.resumo)
  const [cards, setCards] = useState<CardSugestao[]>(() => cardsIniciais(sugestoes, currentUserId))

  const membroOpcoes = teamMembers.map((m) => ({ value: m.id, label: m.nome ?? 'Sem nome' }))
  const faltaResponsavel = cards.some((c) => !c.assigneeId)
  const nTarefas = cards.length

  function atualizar(key: string, patch: Partial<CardSugestao>) {
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  }
  function descartar(key: string) {
    setCards((prev) => prev.filter((c) => c.key !== key))
  }

  function confirmar() {
    if (ocupado || faltaResponsavel) return
    const tarefas: TarefaTratamento[] = cards.map((c) => ({
      assignee_id: c.assigneeId,
      description: c.titulo.trim() || undefined,
      due_date: c.dueDate || null, // '' → null: nunca envia data não confirmada
      priority: c.prioridade,
    }))
    onConcluir({ nota: nota.trim() || undefined, tarefas })
  }

  return (
    <section className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Tratamento sugerido (IA)
        </h3>
        <Button variant="ghost" size="sm" onClick={onRegerar} loading={regenerando} disabled={ocupado}>
          <RefreshCw className="h-4 w-4" /> Regenerar
        </Button>
      </div>

      {/* Disclaimer (paridade com o Astrea) */}
      <p className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        A IA erra. Revise antes de confirmar.
      </p>

      {/* Resumo da IA vira a nota de tratamento (editável) */}
      <div className="w-full space-y-1.5">
        <label htmlFor="sugestao-nota" className="block text-sm font-medium text-foreground">
          Nota de tratamento <span className="text-muted-foreground">(resumo da IA — edite se quiser)</span>
        </label>
        <Textarea
          id="sugestao-nota"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Resumo do que a publicação comunica (não vira tarefa)."
        />
      </div>

      {/* Cards de tarefa sugerida */}
      <div className="space-y-3">
        {cards.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
            Nenhuma tarefa sugerida. Confirmar assim marca a publicação como{' '}
            <span className="font-medium text-foreground">Tratada</span> (sem tarefa).
          </p>
        ) : (
          cards.map((c, i) => (
            <div key={c.key} className="space-y-3 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Tarefa {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => descartar(c.key)}
                  disabled={ocupado}
                  className="inline-flex items-center gap-1 rounded-md p-1 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                  aria-label={`Descartar tarefa ${i + 1}`}
                  title="Descartar sugestão"
                >
                  <ThumbsDown className="h-4 w-4" />
                </button>
              </div>

              <div className="w-full space-y-1.5">
                <label className="block text-sm font-medium text-foreground">Título</label>
                <Textarea
                  value={c.titulo}
                  onChange={(e) => atualizar(c.key, { titulo: e.target.value })}
                  rows={2}
                  maxLength={2000}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select
                  label="Prioridade"
                  value={c.prioridade}
                  onChange={(e) => atualizar(c.key, { prioridade: e.target.value as Prioridade })}
                  options={PRIORIDADE_OPCOES.map((p) => ({ value: p.value, label: p.label }))}
                />
                <Select
                  label="Responsável"
                  required
                  placeholder="Selecione um responsável"
                  value={c.assigneeId}
                  onChange={(e) => atualizar(c.key, { assigneeId: e.target.value })}
                  options={membroOpcoes}
                  error={!c.assigneeId ? 'Escolha um responsável' : undefined}
                />
              </div>

              {/* Prazo mencionado no texto: mostra a CITAÇÃO + data VAZIA (manual) */}
              {c.temPrazoNoTexto && (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
                  {c.trechoDoPrazo && (
                    <p className="text-xs text-muted-foreground">
                      A publicação menciona prazo:{' '}
                      <span className="font-medium text-foreground">“{c.trechoDoPrazo}”</span>
                    </p>
                  )}
                  <Input
                    label="Prazo (defina manualmente)"
                    type="date"
                    value={c.dueDate}
                    onChange={(e) => atualizar(c.key, { dueDate: e.target.value })}
                    leftIcon={<CalendarClock className="h-4 w-4" />}
                    hint="A IA nunca calcula a data — digite o prazo ou deixe em branco."
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Ações */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button onClick={confirmar} loading={ocupado} disabled={faltaResponsavel}>
          <CheckCheck className="h-4 w-4" />
          Confirmar tratamento{nTarefas > 0 ? ` (${nTarefas} tarefa${nTarefas > 1 ? 's' : ''})` : ''}
        </Button>
        <Button variant="ghost" onClick={onExcluir} disabled={ocupado}>
          <Trash2 className="h-4 w-4" /> Excluir sugestões
        </Button>
      </div>
    </section>
  )
}
