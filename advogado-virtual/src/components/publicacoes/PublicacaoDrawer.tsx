'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatarData } from '@/lib/utils'
import { X, ExternalLink, ClipboardList, CheckCheck, Ban } from 'lucide-react'
import { CriarTarefaModal } from './CriarTarefaModal'
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
  /** Chamado quando o status muda (triar/descartar/tarefa) para o pai recarregar a lista. */
  onAlterada: () => void
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

export function PublicacaoDrawer({ id, teamMembers, onClose, onAlterada }: Props) {
  const { success, error: toastError } = useToast()
  const [pub, setPub] = useState<PublicacaoDetalhe | null>(null)
  const [loading, setLoading] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [modalTarefa, setModalTarefa] = useState(false)
  const [modalDescarte, setModalDescarte] = useState(false)
  const [motivo, setMotivo] = useState('')

  useEffect(() => {
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
    // Não fechar o drawer com Escape enquanto um sub-modal estiver aberto
    // (o próprio Dialog trata o Escape dele).
    if (modalTarefa || modalDescarte) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, modalTarefa, modalDescarte])

  async function triar(acao: 'triada' | 'descartar', extra?: { motivo?: string }) {
    setOcupado(true)
    try {
      const r = await fetch(`/api/publicacoes/${id}/triar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao, ...extra }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível concluir', d.error ?? 'Tente novamente.')
        return
      }
      success(acao === 'triada' ? 'Marcada como triada' : 'Publicação descartada', '')
      onAlterada()
      onClose()
    } finally {
      setOcupado(false)
    }
  }

  const destinatarios = pub ? normalizarDestinatarios(pub.destinatarios) : []
  const podeTriar = pub?.status === 'nova'
  const meta = pub ? STATUS_META[pub.status] : null

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <aside className="relative flex h-full w-full max-w-xl flex-col bg-card shadow-xl animate-in slide-in-from-right-full duration-200">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {pub?.sigla_tribunal ?? 'Publicação'}
            </p>
            <h2 className="mt-0.5 truncate text-lg font-semibold text-foreground">
              {pub?.tipo_documento || pub?.tipo_comunicacao || 'Detalhe da publicação'}
            </h2>
            {pub && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {pub.numero_mascara || pub.numero_processo || 'Sem número de processo'}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Carregando publicação…
            </div>
          ) : !pub ? (
            <p className="py-8 text-sm text-muted-foreground">Não foi possível carregar esta publicação.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {meta && <Badge variant={meta.variant}>{meta.label}</Badge>}
                {pub.processo_id && <Badge variant="secondary">Processo cadastrado</Badge>}
                {pub.link && (
                  <a
                    href={pub.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" /> Ver no tribunal
                  </a>
                )}
              </div>

              {/* Metadados */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Campo rotulo="Disponibilizada em" valor={formatarData(pub.data_disponibilizacao)} />
                <Campo
                  rotulo="Publicação presumida"
                  valor={pub.data_publicacao_sugerida ? formatarData(pub.data_publicacao_sugerida) : '—'}
                />
                <Campo rotulo="Tribunal" valor={pub.sigla_tribunal ?? '—'} />
                <Campo rotulo="Órgão julgador" valor={pub.orgao_julgador ?? '—'} />
                <Campo rotulo="Tipo de comunicação" valor={pub.tipo_comunicacao ?? '—'} />
                <Campo rotulo="Classe" valor={pub.nome_classe ?? '—'} />
                <Campo
                  rotulo="OAB consultada"
                  valor={pub.oab_consultada ? `${pub.oab_consultada}${pub.uf_oab ? '/' + pub.uf_oab : ''}` : '—'}
                />
                {pub.status === 'descartada' && pub.descarte_motivo && (
                  <Campo rotulo="Motivo do descarte" valor={pub.descarte_motivo} className="col-span-2" />
                )}
              </dl>

              {destinatarios.length > 0 && (
                <div>
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

              {/* Inteiro teor (texto plano seguro — NUNCA innerHTML) */}
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Inteiro teor
                </p>
                <pre className="max-h-none whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-sm leading-relaxed text-foreground font-sans">
                  {pub.textoPlano || 'Sem texto disponível.'}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Ações */}
        {pub && podeTriar && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
            <Button size="sm" onClick={() => setModalTarefa(true)} disabled={ocupado}>
              <ClipboardList className="h-4 w-4" /> Criar tarefa
            </Button>
            <Button size="sm" variant="secondary" onClick={() => triar('triada')} disabled={ocupado}>
              <CheckCheck className="h-4 w-4" /> Marcar como triada
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setMotivo(''); setModalDescarte(true) }} disabled={ocupado}>
              <Ban className="h-4 w-4" /> Descartar
            </Button>
          </div>
        )}
      </aside>

      {/* Modal criar tarefa */}
      {pub && modalTarefa && (
        <CriarTarefaModal
          open={modalTarefa}
          onClose={() => setModalTarefa(false)}
          publicacao={pub}
          teamMembers={teamMembers}
          onCriada={() => { setModalTarefa(false); onAlterada(); onClose() }}
        />
      )}

      {/* Modal descartar (motivo obrigatório) */}
      <Dialog
        open={modalDescarte}
        onClose={ocupado ? () => {} : () => setModalDescarte(false)}
        title="Descartar publicação"
        description="A publicação some da fila de triagem, mas permanece na trilha de auditoria."
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
              onClick={() => triar('descartar', { motivo: motivo.trim() })}
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

function Campo({ rotulo, valor, className }: { rotulo: string; valor: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 text-foreground">{valor}</dd>
    </div>
  )
}
