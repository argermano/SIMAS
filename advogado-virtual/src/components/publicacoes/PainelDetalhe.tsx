'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { cn, formatarData } from '@/lib/utils'
import {
  Ban,
  CheckCheck,
  ChevronLeft,
  ClipboardPlus,
  ExternalLink,
  Gavel,
  Info,
  RotateCcw,
  User,
} from 'lucide-react'
import { PainelTratamento, type TratamentoPayload } from './PainelTratamento'
import { PrioridadeBadge, StatusPill } from './Pills'
import {
  prioridadeDaPublicacao,
  type DestinatarioAdvogado,
  type PublicacaoDetalhe,
  type TeamMember,
} from './tipos'

interface Props {
  id: string
  teamMembers: TeamMember[]
  /** "Autor × Réu" vindo do item de LISTA (o detalhe não devolve `partes`, que é
   * derivado de `meta.destinatarios` só na rota de lista). Fallback do título. */
  partesFallback?: string | null
  /** 'inline' = coluna direita (lg+); 'overlay' = tela cheia no mobile. */
  modo: 'inline' | 'overlay'
  /** Fechar o overlay (só no mobile). */
  onFechar?: () => void
  /** Após tratar/descartar: o pai avança para a próxima não tratada e recarrega. */
  onConcluido: (id: string) => void
  /** Após reabrir: o pai recarrega lista + contadores (mantém a seleção). */
  onReaberto: () => void
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

/** Advogado "pesquisado": destinatário cuja OAB casa com a consultada; fallback
 * ao 1º destinatário; por fim a própria inscrição consultada. */
function nomePesquisado(pub: PublicacaoDetalhe, destinatarios: DestinatarioAdvogado[]): string {
  const alvo = (pub.oab_consultada || '').replace(/\D/g, '')
  const match = destinatarios.find((d) => (d.numero_oab || '').replace(/\D/g, '') === alvo)
  const nome = (match?.nome || destinatarios[0]?.nome || '').trim()
  if (nome) return nome
  if (pub.oab_consultada) return `OAB ${pub.oab_consultada}${pub.uf_oab ? '/' + pub.uf_oab : ''}`
  return '—'
}

/**
 * Painel de DETALHE da publicação (lado direito do master-detail, ou tela cheia
 * no mobile). Reusa o fluxo de tratamento existente (POST /triar): "Marcar como
 * tratada" (sem tarefa), "Criar tarefa" (PainelTratamento), "Descartar" (motivo)
 * e "Reabrir". Invariantes: nenhum countdown de prazo — só a data de publicação
 * PRESUMIDA como referência; inteiro teor sempre via textoPlano (nunca innerHTML).
 */
export function PainelDetalhe({ id, teamMembers, partesFallback, modo, onFechar, onConcluido, onReaberto }: Props) {
  const { success, error: toastError } = useToast()
  const [pub, setPub] = useState<PublicacaoDetalhe | null>(null)
  const [loading, setLoading] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [modalDescarte, setModalDescarte] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [criandoTarefa, setCriandoTarefa] = useState(false)

  useEffect(() => {
    // Ao trocar de publicação (fila), zera o estado de descarte/tarefa.
    setModalDescarte(false)
    setMotivo('')
    setCriandoTarefa(false)
    let vivo = true
    ;(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/publicacoes/${id}`)
        if (!vivo) return
        if (r.ok) {
          const d = await r.json()
          setPub((d.publicacao ?? null) as PublicacaoDetalhe | null)
        } else {
          setPub(null)
        }
      } finally {
        if (vivo) setLoading(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [id])

  // Escape fecha o overlay (mobile). No inline não há o que fechar.
  useEffect(() => {
    if (modo !== 'overlay' || !onFechar) return
    if (modalDescarte || criandoTarefa) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [modo, onFechar, modalDescarte, criandoTarefa])

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
        success(
          `Publicação tratada — ${n} tarefa${n > 1 ? 's' : ''} criada${n > 1 ? 's' : ''}`,
          'Acompanhe em Tarefas (/tarefas).',
        )
      } else {
        success('Publicação tratada', 'Marcada como tratada, sem tarefa.')
      }
      onConcluido(id)
    } finally {
      setOcupado(false)
    }
  }

  function marcarTratada() {
    if (!confirm('Marcar esta publicação como TRATADA (sem tarefa)? Ela sai da fila de não tratadas.')) return
    void tratar({})
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

  async function reabrir() {
    if (!confirm('Reabrir esta publicação? Ela volta para NÃO TRATADA. Uma tarefa já criada no Kanban permanece.'))
      return
    setOcupado(true)
    try {
      const r = await fetch(`/api/publicacoes/${id}/triar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'reabrir' }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível reabrir', d.error ?? 'Tente novamente.')
        return
      }
      success('Publicação reaberta', 'Voltou para não tratada.')
      // Otimista: reflete o novo status sem refetch; o pai recarrega a lista.
      setPub((p) => (p ? { ...p, status: 'nova', descarte_motivo: null } : p))
      onReaberto()
    } finally {
      setOcupado(false)
    }
  }

  const destinatarios = pub ? normalizarDestinatarios(pub.destinatarios) : []
  const podeTratar = pub?.status === 'nova'
  const numero = pub?.numero_mascara || pub?.numero_processo || 'Sem número'
  const tipo = pub ? pub.tipo_documento || pub.tipo_comunicacao || 'Publicação' : ''
  const prioridade = pub
    ? prioridadeDaPublicacao({
        tipo_documento: pub.tipo_documento,
        tipo_comunicacao: pub.tipo_comunicacao,
        texto: pub.textoPlano,
      })
    : 'baixa'
  const pv = pub?.processoVinculado
  const titulo = pub?.partes || partesFallback || 'Publicação sem partes identificadas'

  const corpo = (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabeçalho do painel */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {modo === 'overlay' && onFechar && (
              <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2" onClick={onFechar}>
                <ChevronLeft className="h-4 w-4" /> Voltar
              </Button>
            )}
            {pub && <PrioridadeBadge nivel={prioridade} />}
            {pub && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {tipo}
              </span>
            )}
            {pub?.sigla_tribunal && (
              <span className="rounded bg-muted/60 px-1.5 py-0.5 text-xs font-medium text-foreground">
                {pub.sigla_tribunal}
              </span>
            )}
          </div>
          <h2 className="mt-2 truncate text-lg font-semibold leading-tight text-foreground" title={titulo}>
            {titulo}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{numero}</span>
            {pub?.link && (
              <a
                href={pub.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Ver no tribunal
              </a>
            )}
          </div>
        </div>
        {pub && <StatusPill status={pub.status} className="shrink-0" />}
      </div>

      {/* Corpo rolável */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loading && !pub ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Carregando publicação…
          </div>
        ) : !pub ? (
          <p className="py-8 text-sm text-muted-foreground">Não foi possível carregar esta publicação.</p>
        ) : (
          <div className="space-y-5">
            {/* Referência de publicação — NUNCA countdown de prazo */}
            {pub.data_publicacao_sugerida && (
              <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3.5 py-3 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-muted-foreground">
                  Publicação presumida em{' '}
                  <span className="font-semibold text-foreground">
                    {formatarData(pub.data_publicacao_sugerida)}
                  </span>{' '}
                  — referência apenas; <span className="font-medium text-foreground">o prazo é definido por você</span>.
                </p>
              </div>
            )}

            {/* Grid de campos */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-sm">
              <Campo rotulo="Órgão" valor={pub.orgao_julgador || '—'} className="col-span-2" />
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Cliente</dt>
                <dd className="mt-0.5">
                  {pv?.clienteId ? (
                    <Link
                      href={`/clientes/${pv.clienteId}`}
                      className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                    >
                      <User className="h-3.5 w-3.5" aria-hidden /> {pv.clienteNome ?? 'Ver cliente'}
                    </Link>
                  ) : pv?.clienteNome ? (
                    <span className="text-foreground">{pv.clienteNome}</span>
                  ) : (
                    <span className="text-muted-foreground">Não vinculado</span>
                  )}
                </dd>
              </div>
              <Campo
                rotulo="OAB"
                valor={pub.oab_consultada ? `${pub.oab_consultada}${pub.uf_oab ? '/' + pub.uf_oab : ''}` : '—'}
              />
              <Campo rotulo="Divulgado" valor={formatarData(pub.data_disponibilizacao)} />
              <Campo
                rotulo="Publicado (presumida)"
                valor={pub.data_publicacao_sugerida ? formatarData(pub.data_publicacao_sugerida) : '—'}
              />
              <Campo rotulo="Pesquisado" valor={nomePesquisado(pub, destinatarios)} className="col-span-2" />
              {pub.status === 'descartada' && pub.descarte_motivo && (
                <Campo rotulo="Motivo do descarte" valor={pub.descarte_motivo} className="col-span-2" />
              )}
            </dl>

            {/* Processo vinculado (aviso Fase 5) */}
            {pv && pub.movimento_id && (
              <p className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
                <Gavel className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Aviso ao cliente já gerado pela Fase 5 (acompanhamento processual).
              </p>
            )}

            {/* Inteiro teor — texto plano seguro (NUNCA innerHTML) */}
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Inteiro teor
              </p>
              <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/20 p-3.5 text-sm font-sans leading-relaxed text-foreground">
                {pub.textoPlano || 'Sem texto disponível.'}
              </pre>
            </div>

            {/* Estação de tratamento (Criar tarefa) */}
            {podeTratar && criandoTarefa && (
              <PainelTratamento
                key={`${pub.id}-tarefa`}
                publicacao={pub}
                teamMembers={teamMembers}
                ocupado={ocupado}
                modo="completo"
                tarefasIniciais={1}
                onConcluir={tratar}
                onCancelar={() => setCriandoTarefa(false)}
                onDescartar={() => {
                  setCriandoTarefa(false)
                  setMotivo('')
                  setModalDescarte(true)
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Rodapé de ações */}
      {pub && !criandoTarefa && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          {podeTratar ? (
            <>
              <Button size="sm" onClick={marcarTratada} loading={ocupado}>
                <CheckCheck className="h-4 w-4" /> Marcar como tratada
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setCriandoTarefa(true)} disabled={ocupado}>
                <ClipboardPlus className="h-4 w-4" /> Criar tarefa
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto border border-destructive/50 text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setMotivo('')
                  setModalDescarte(true)
                }}
                disabled={ocupado}
              >
                <Ban className="h-4 w-4" /> Descartar
              </Button>
            </>
          ) : (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {pub.status === 'descartada' ? 'Publicação descartada.' : 'Publicação tratada.'}
              </span>
              <Button variant="secondary" size="sm" onClick={reabrir} loading={ocupado}>
                <RotateCcw className="h-4 w-4" /> Reabrir
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <>
      {modo === 'overlay' ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-background lg:hidden" role="dialog" aria-modal="true" aria-label="Detalhe da publicação">
          {corpo}
        </div>
      ) : (
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
          {corpo}
        </div>
      )}

      {/* Modal descartar (motivo obrigatório = confirmação do descarte) */}
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
            <Button variant="danger" loading={ocupado} disabled={!motivo.trim()} onClick={descartar}>
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
    </>
  )
}

function Campo({ rotulo, valor, className }: { rotulo: string; valor: string; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 break-words text-foreground">{valor}</dd>
    </div>
  )
}
