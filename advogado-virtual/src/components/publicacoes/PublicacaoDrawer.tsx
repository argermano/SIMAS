'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatarData } from '@/lib/utils'
import {
  Ban,
  CalendarClock,
  CalendarPlus,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  ExternalLink,
  FilePlus2,
  Gavel,
  User,
} from 'lucide-react'
import { PainelTratamento, type ModoTratamento, type TratamentoPayload } from './PainelTratamento'
import {
  STATUS_META,
  type DestinatarioAdvogado,
  type PublicacaoDetalhe,
  type TeamMember,
} from './tipos'

interface Props {
  id: string
  teamMembers: TeamMember[]
  onClose: () => void
  /** Chamado após tratar/descartar com sucesso. O pai avança para a próxima
   * publicação não tratada da fila (ou fecha) e recarrega lista + contadores. */
  onConcluido: (id: string) => void
}

/** Uma sessão de tratamento aberta pelo dropdown TRATAMENTOS. */
interface Tratamento {
  modo: ModoTratamento
  tarefas: number
  foco: boolean
}

function normalizarDestinatarios(raw: unknown): DestinatarioAdvogado[] {
  if (!Array.isArray(raw)) return []
  const out: DestinatarioAdvogado[] = []
  for (const d of raw) {
    const adv = (d as { advogado?: DestinatarioAdvogado })?.advogado ?? (d as DestinatarioAdvogado)
    if (!adv || typeof adv !== 'object') continue
    if (!adv.nome && !adv.numero_oab) continue
    out.push({ nome: adv.nome, numero_oab: adv.numero_oab, uf_oab: adv.uf_oab })
  }
  return out
}

export function PublicacaoDrawer({ id, teamMembers, onClose, onConcluido }: Props) {
  const { success, error: toastError } = useToast()
  const [pub, setPub] = useState<PublicacaoDetalhe | null>(null)
  const [loading, setLoading] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [modalDescarte, setModalDescarte] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [tratamento, setTratamento] = useState<Tratamento | null>(null)

  useEffect(() => {
    // Ao trocar de publicação (fila), zera o estado de descarte e de tratamento.
    setModalDescarte(false)
    setMotivo('')
    setTratamento(null)
    let vivo = true
    ;(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/publicacoes/${id}`)
        if (!vivo) return
        if (r.ok) {
          const d = await r.json()
          setPub(d.publicacao ?? null)
        }
      } finally {
        if (vivo) setLoading(false)
      }
    })()
    return () => { vivo = false }
  }, [id])

  useEffect(() => {
    // Escape: o Dialog de descarte trata o dele; um painel de tratamento aberto
    // fecha primeiro; só então o Escape fecha o drawer.
    if (modalDescarte) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (tratamento) setTratamento(null)
      else onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, modalDescarte, tratamento])

  /** Conclui o tratamento: nota opcional + 0..10 tarefas (acao 'tratar'). */
  async function tratar(payload: TratamentoPayload) {
    setOcupado(true)
    try {
      const r = await fetch(`/api/publicacoes/${id}/triar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'tratar', ...payload }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível concluir o tratamento', d.error ?? 'Tente novamente.')
        return
      }
      const n = Array.isArray(d.taskIds) ? d.taskIds.length : 0
      if (n > 0) {
        success(`Publicação tratada — ${n} tarefa${n > 1 ? 's' : ''} criada${n > 1 ? 's' : ''}`, 'Acompanhe em Tarefas (/tarefas).')
      } else {
        success('Publicação tratada', 'Marcada como tratada, sem tarefa.')
      }
      onConcluido(id)
    } finally {
      setOcupado(false)
    }
  }

  async function descartar() {
    const motivoLimpo = motivo.trim()
    if (!motivoLimpo) return
    setOcupado(true)
    try {
      const r = await fetch(`/api/publicacoes/${id}/triar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'descartar', motivo: motivoLimpo }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível descartar', d.error ?? 'Tente novamente.')
        return
      }
      success('Publicação descartada', '')
      setModalDescarte(false)
      onConcluido(id)
    } finally {
      setOcupado(false)
    }
  }

  const destinatarios = pub ? normalizarDestinatarios(pub.destinatarios) : []
  const podeTratar = pub?.status === 'nova'
  const meta = pub ? STATUS_META[pub.status] : null

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Detalhe da publicação">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <aside className="relative flex h-full w-full max-w-5xl flex-col bg-background shadow-xl animate-in slide-in-from-right-full duration-200">
        {/* ── Barra de topo: título + status | VOLTAR · TRATAMENTOS ▾ · DESCARTAR · CONCLUIR ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">Publicação</h2>
            {meta && <Badge variant={meta.variant}>{meta.label}</Badge>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              <ChevronLeft className="h-4 w-4" /> Voltar
            </Button>

            {podeTratar && !tratamento && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" aria-label="Abrir menu de tratamentos">
                      Tratamentos <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[220px]">
                    <DropdownMenuItem onSelect={() => setTratamento({ modo: 'completo', tarefas: 1, foco: false })}>
                      <ClipboardList className="h-4 w-4 text-muted-foreground" /> Adicionar tarefa
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setTratamento({ modo: 'completo', tarefas: 1, foco: true })}>
                      <CalendarClock className="h-4 w-4 text-muted-foreground" /> Adicionar prazo
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setTratamento({ modo: 'nota', tarefas: 0, foco: false })}>
                      <FilePlus2 className="h-4 w-4 text-muted-foreground" /> Adicionar histórico manual
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled
                      title="Em breve — ainda não há módulo de agenda no SIMAS"
                      onSelect={(e) => e.preventDefault()}
                    >
                      <Gavel className="h-4 w-4 text-muted-foreground" /> Adicionar audiência
                      <span className="ml-auto text-xs text-muted-foreground">em breve</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled
                      title="Em breve — ainda não há módulo de agenda no SIMAS"
                      onSelect={(e) => e.preventDefault()}
                    >
                      <CalendarPlus className="h-4 w-4 text-muted-foreground" /> Adicionar evento
                      <span className="ml-auto text-xs text-muted-foreground">em breve</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  variant="ghost"
                  size="sm"
                  className="border border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={() => { setMotivo(''); setModalDescarte(true) }}
                  disabled={ocupado}
                >
                  <Ban className="h-4 w-4" /> Descartar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="border border-primary/50 text-primary hover:bg-primary/10"
                  onClick={() => tratar({})}
                  loading={ocupado}
                >
                  <CheckCheck className="h-4 w-4" /> Concluir
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ── Corpo ── */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Carregando publicação…
            </div>
          ) : !pub ? (
            <p className="py-8 text-sm text-muted-foreground">Não foi possível carregar esta publicação.</p>
          ) : (
            <div className="space-y-5">
              {/* Estação de tratamento aberta pelo dropdown */}
              {podeTratar && tratamento && (
                <PainelTratamento
                  key={`${pub.id}-${tratamento.modo}-${tratamento.foco}`}
                  publicacao={pub}
                  teamMembers={teamMembers}
                  ocupado={ocupado}
                  modo={tratamento.modo}
                  tarefasIniciais={tratamento.tarefas}
                  focoPrazoInicial={tratamento.foco}
                  onConcluir={tratar}
                  onCancelar={() => setTratamento(null)}
                  onDescartar={() => { setMotivo(''); setModalDescarte(true) }}
                />
              )}

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
                {/* ── ESQUERDA: diário / publicação ── */}
                <CardDiario pub={pub} destinatarios={destinatarios} />

                {/* ── DIREITA: processo vinculado ── */}
                <CardProcesso pub={pub} />
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Modal descartar (motivo obrigatório) */}
      <Dialog
        open={modalDescarte}
        onClose={ocupado ? () => {} : () => setModalDescarte(false)}
        title="Descartar publicação"
        description="A publicação some da fila de tratamento, mas permanece na trilha de auditoria."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalDescarte(false)} disabled={ocupado}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={ocupado}
              disabled={!motivo.trim()}
              onClick={descartar}
            >
              Descartar
            </Button>
          </>
        }
      >
        <div className="w-full space-y-1.5">
          <label htmlFor="descarte-motivo" className="block text-base font-medium text-foreground">
            Motivo <span className="text-destructive">*</span>
          </label>
          <Textarea
            id="descarte-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            placeholder="Ex.: não é do nosso cliente / duplicada / sem ação necessária"
          />
        </div>
      </Dialog>
    </div>
  )
}

/** Coluna esquerda: card do Diário/publicação (dados + inteiro teor seguro). */
function CardDiario({
  pub,
  destinatarios,
}: {
  pub: PublicacaoDetalhe
  destinatarios: DestinatarioAdvogado[]
}) {
  const numero = pub.numero_mascara || pub.numero_processo || 'Sem número'
  const oab = pub.oab_consultada ? `OAB ${pub.oab_consultada}${pub.uf_oab ? '/' + pub.uf_oab : ''}` : '—'
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      {/* Cabeçalho do diário */}
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Diário oficial eletrônico
      </p>
      <h3 className="mt-0.5 text-base font-semibold text-foreground">
        {pub.sigla_tribunal ?? 'Diário'}
      </h3>
      {pub.orgao_julgador && (
        <p className="mt-0.5 text-sm text-muted-foreground">{pub.orgao_julgador}</p>
      )}

      {/* Datas em destaque */}
      <p className="mt-3 text-sm font-semibold text-foreground">
        Divulgado em: {formatarData(pub.data_disponibilizacao)}
        {pub.data_publicacao_sugerida && (
          <>
            {' '}— Publicado em: {formatarData(pub.data_publicacao_sugerida)}{' '}
            <span className="font-normal text-muted-foreground">(presumida)</span>
          </>
        )}
      </p>

      {/* Metadados */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Campo rotulo="Processo" valor={numero} />
        <Campo rotulo="OAB consultada" valor={oab} />
        <Campo rotulo="Diário (sigla)" valor={pub.sigla_tribunal ?? '—'} />
        <Campo rotulo="Classe" valor={pub.nome_classe ?? '—'} />
        <Campo rotulo="Tipo de comunicação" valor={pub.tipo_comunicacao ?? '—'} />
        <Campo rotulo="Tipo de documento" valor={pub.tipo_documento ?? '—'} />
        {pub.status === 'descartada' && pub.descarte_motivo && (
          <Campo rotulo="Motivo do descarte" valor={pub.descarte_motivo} className="col-span-2" />
        )}
      </dl>

      {destinatarios.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Destinatários
          </p>
          <ul className="space-y-1">
            {destinatarios.map((d, i) => (
              <li key={i} className="text-sm text-foreground">
                {d.nome ?? 'Advogado(a)'}
                {d.numero_oab && (
                  <span className="text-muted-foreground"> — OAB {d.numero_oab}{d.uf_oab ? '/' + d.uf_oab : ''}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pub.link && (
        <a
          href={pub.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ExternalLink className="h-4 w-4" /> Inteiro teor no tribunal
        </a>
      )}

      {/* Inteiro teor (texto plano seguro — NUNCA innerHTML) */}
      <div className="mt-4">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Inteiro teor
        </p>
        <pre className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-sm font-sans leading-relaxed text-foreground">
          {pub.textoPlano || 'Sem texto disponível.'}
        </pre>
      </div>
    </section>
  )
}

/** Coluna direita: card PROCESSO. Degrada por `processo_id` quando o join
 * `processoVinculado` ainda não vier no payload. */
function CardProcesso({ pub }: { pub: PublicacaoDetalhe }) {
  const pv = pub.processoVinculado
  const numero = pv?.numeroMascara || pub.numero_mascara || pub.numero_processo || '—'

  return (
    <section className="h-fit rounded-lg border border-border bg-card p-5 lg:sticky lg:top-0">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Gavel className="h-3.5 w-3.5" aria-hidden /> Processo
      </p>

      {pv ? (
        <div className="mt-2 space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{pv.titulo || pub.nome_classe || 'Processo'}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{numero}</p>
          </div>

          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Cliente</dt>
              <dd className="mt-0.5">
                {pv.clienteId ? (
                  <Link href={`/clientes/${pv.clienteId}`} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                    <User className="h-3.5 w-3.5" aria-hidden /> {pv.clienteNome ?? 'Ver cliente'}
                  </Link>
                ) : (
                  <span className="text-foreground">{pv.clienteNome ?? '—'}</span>
                )}
              </dd>
            </div>
            {pv.situacao && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
                <dd className="mt-0.5">
                  <Badge variant={pv.situacao === 'ativo' ? 'success' : 'secondary'}>
                    {pv.situacao === 'ativo' ? 'Ativo' : pv.situacao === 'encerrado' ? 'Encerrado' : pv.situacao}
                  </Badge>
                </dd>
              </div>
            )}
          </dl>

          {pub.movimento_id && (
            <p className="rounded-md bg-success/10 px-3 py-2 text-xs text-success">
              Aviso ao cliente já gerado pela Fase 5 (acompanhamento processual).
            </p>
          )}
        </div>
      ) : pub.processo_id ? (
        // Vínculo conhecido (processo_id), mas sem o detalhe do join no payload.
        <div className="mt-2 space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Processo vinculado</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{numero}</p>
          </div>
          {pub.movimento_id && (
            <p className="rounded-md bg-success/10 px-3 py-2 text-xs text-success">
              Aviso ao cliente já gerado pela Fase 5 (acompanhamento processual).
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Processo não cadastrado no SIMAS.</p>
      )}
    </section>
  )
}

function Campo({ rotulo, valor, className }: { rotulo: string; valor: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 break-words text-foreground">{valor}</dd>
    </div>
  )
}
