'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LABELS_AREA } from '@/types'
import { LABELS_ETAPA, ORDEM_ETAPAS, type EtapaFunil } from '@/lib/funil/regras'
import type { LeadData } from './tipos'
import { brl } from './estilos'
import {
  X, MessageCircle, Calendar, Video, User, UserCheck, AlertCircle,
  FileSignature, FileText, ScrollText, ExternalLink, ClipboardList,
} from 'lucide-react'

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' })

interface Detalhes {
  cliente: { id: string; nome: string; status_cadastro: string; cadastroCompleto: boolean } | null
  contratos: { id: string; titulo: string; status: string; created_at: string }[]
  pecas: { id: string; tipo: string; area: string; status: string; created_at: string }[]
  eventos: { id: string; de_etapa: string | null; para_etapa: string; ator: string; ator_nome: string | null; observacao: string | null; created_at: string }[]
}

// ≥ proposta_enviada → pode gerar contrato de honorários.
const IDX_PROPOSTA = ORDEM_ETAPAS.indexOf('proposta_enviada')
// ≥ consulta_realizada → já houve conversa; atalho p/ abrir o atendimento (pré-peça).
const IDX_CONSULTA_REALIZADA = ORDEM_ETAPAS.indexOf('consulta_realizada')

export function DrawerLead({
  lead, chatwootUrl, onFechar,
}: {
  lead: LeadData
  nomeUsuario: string
  chatwootUrl: string | null
  onFechar: () => void
  onMudou: () => void
}) {
  const router = useRouter()
  const [det, setDet] = useState<Detalhes | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [abrindoAtendimento, setAbrindoAtendimento] = useState(false)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    fetch(`/api/funil/leads/${lead.id}/detalhes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setDet(d) })
      .catch(() => {})
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [lead.id])

  const nome = lead.nome_informado?.trim() || lead.clientes?.nome?.trim() || lead.telefone
  const area = lead.area ? (LABELS_AREA[lead.area as keyof typeof LABELS_AREA] ?? lead.area) : null
  const clienteId = lead.clientes?.id ?? det?.cliente?.id ?? null
  const cadastroCompleto = det?.cliente?.cadastroCompleto ?? false
  const statusCadastro = det?.cliente?.status_cadastro ?? lead.clientes?.status_cadastro ?? null

  const podeGerarContrato = ORDEM_ETAPAS.indexOf(lead.etapa) >= IDX_PROPOSTA
  const podeGerarProcuracao = lead.etapa === 'contrato_fechado'
  const areaSlug = lead.area || 'civel'
  // Atalho (não obrigatório): a partir da consulta realizada, abrir o atendimento.
  const podeAbrirAtendimento = clienteId != null && ORDEM_ETAPAS.indexOf(lead.etapa) >= IDX_CONSULTA_REALIZADA

  // Cria um atendimento (estágio "atendimento") a partir do lead e navega até ele.
  // Sem dedup rígido — é só uma conveniência; a criação repetida não quebra nada.
  async function abrirAtendimento() {
    if (!clienteId || abrindoAtendimento) return
    setAbrindoAtendimento(true)
    try {
      const partes = [`Aberto pelo funil comercial (etapa: ${LABELS_ETAPA[lead.etapa]}).`]
      if (lead.consulta_data) {
        partes.push(`Consulta em ${dataHora(lead.consulta_data)}${lead.consulta_formato ? ` · ${lead.consulta_formato}` : ''}.`)
      }
      const res = await fetch('/api/atendimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: clienteId,
          area: areaSlug,
          titulo: `Consulta — ${area ?? 'atendimento'}`,
          estagio: 'atendimento',
          primeiro_registro: partes.join(' '),
        }),
      })
      if (!res.ok) throw new Error('falha ao abrir atendimento')
      const { id: atendimentoId } = await res.json()
      router.push(`/clientes/${clienteId}/casos/${atendimentoId}`)
    } catch {
      setAbrindoAtendimento(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onFechar} />
      <aside className="relative flex w-full max-w-md flex-col overflow-hidden bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-foreground">{nome}</h2>
            <p className="text-xs text-muted-foreground">{LABELS_ETAPA[lead.etapa]}{area ? ` · ${area}` : ''} · {lead.unidade}</p>
          </div>
          <button onClick={onFechar} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {/* Contato */}
          <section className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Contato</p>
            <p className="text-foreground">{lead.telefone}</p>
            {lead.email && <p className="text-muted-foreground">{lead.email}</p>}
            <div className="flex gap-3 pt-1">
              <a href={chatwootUrl ?? `https://wa.me/${lead.telefone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <MessageCircle className="h-3.5 w-3.5" /> {chatwootUrl ? 'Abrir no Chatwoot' : 'WhatsApp'}
              </a>
            </div>
          </section>

          {/* Cliente */}
          {clienteId && (
            <section className="space-y-1.5 border-t border-border/60 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Cliente</p>
              <div className="flex items-center gap-2">
                {statusCadastro === 'ativo' ? (
                  <span className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success"><UserCheck className="h-3 w-3" /> Cadastro ativo</span>
                ) : statusCadastro === 'pre_cadastro' ? (
                  <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"><AlertCircle className="h-3 w-3" /> Pré-cadastro</span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"><User className="h-3 w-3" /> {statusCadastro ?? '—'}</span>
                )}
                {!cadastroCompleto && statusCadastro !== 'ativo' && (
                  <span className="text-[10px] text-muted-foreground">falta nome/CPF/endereço</span>
                )}
              </div>
              <Link href={`/clientes/${clienteId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> {cadastroCompleto ? 'Abrir cadastro' : 'Completar cadastro'}
              </Link>
            </section>
          )}

          {/* Atendimento — atalho para abrir o atendimento (pré-peça) a partir do lead */}
          {podeAbrirAtendimento && (
            <section className="space-y-2 border-t border-border/60 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Atendimento</p>
              <button
                type="button"
                onClick={abrirAtendimento}
                disabled={abrindoAtendimento}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                <ClipboardList className="h-4 w-4 text-primary" />
                {abrindoAtendimento ? 'Abrindo…' : 'Abrir atendimento'}
              </button>
            </section>
          )}

          {/* Consulta */}
          {(lead.consulta_data || lead.meet_url) && (
            <section className="space-y-1 border-t border-border/60 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Consulta</p>
              {lead.consulta_data && (
                <p className="flex items-center gap-1.5 text-foreground"><Calendar className="h-3.5 w-3.5 text-muted-foreground" /> {dataHora(lead.consulta_data)}{lead.consulta_formato ? ` · ${lead.consulta_formato}` : ''}</p>
              )}
              {lead.consulta_cancelada && <p className="text-xs text-destructive">Consulta cancelada</p>}
              {lead.meet_url && (
                <a href={lead.meet_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <Video className="h-3.5 w-3.5" /> Link da videochamada
                </a>
              )}
            </section>
          )}

          {/* Valor */}
          {lead.valor_estimado != null && (
            <section className="border-t border-border/60 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Proposta</p>
              <p className="text-base font-semibold text-foreground">{brl(lead.valor_estimado)}</p>
            </section>
          )}

          {/* Ações de geração */}
          {clienteId && (podeGerarContrato || podeGerarProcuracao) && (
            <section className="space-y-2 border-t border-border/60 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Gerar documento</p>
              {podeGerarContrato && (
                <Link href={`/contratos/novo?cliente_id=${clienteId}`}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
                  <FileSignature className="h-4 w-4 text-primary" /> Gerar contrato de honorários
                </Link>
              )}
              {podeGerarProcuracao && (
                <Link href={`/${areaSlug}/modelos/procuracao?clienteId=${clienteId}`}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
                  <ScrollText className="h-4 w-4 text-primary" /> Gerar procuração
                </Link>
              )}
            </section>
          )}

          {/* Documentos */}
          <section className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Documentos</p>
            {carregando ? (
              <p className="text-xs text-muted-foreground/60">Carregando…</p>
            ) : (det && (det.contratos.length > 0 || det.pecas.length > 0)) ? (
              <ul className="space-y-1.5">
                {det.contratos.map((c) => (
                  <li key={c.id}>
                    <Link href={`/contratos/${c.id}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
                      <FileSignature className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{c.titulo}</span>
                      <span className="text-[10px] text-muted-foreground">{c.status} · {dataCurta(c.created_at)}</span>
                    </Link>
                  </li>
                ))}
                {det.pecas.map((p) => (
                  <li key={p.id}>
                    <Link href={`/${p.area}/editor/${p.id}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{p.tipo.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] text-muted-foreground">{p.status} · {dataCurta(p.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground/60">Nenhum documento ainda.</p>
            )}
          </section>

          {/* Timeline */}
          <section className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Histórico</p>
            {carregando ? (
              <p className="text-xs text-muted-foreground/60">Carregando…</p>
            ) : det && det.eventos.length > 0 ? (
              <ol className="space-y-2">
                {det.eventos.map((e) => (
                  <li key={e.id} className="flex gap-2 text-xs">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                    <div className="min-w-0">
                      <p className="text-foreground">
                        {e.de_etapa ? `${LABELS_ETAPA[e.de_etapa as EtapaFunil] ?? e.de_etapa} → ` : ''}
                        <span className="font-medium">{LABELS_ETAPA[e.para_etapa as EtapaFunil] ?? e.para_etapa}</span>
                      </p>
                      <p className="text-muted-foreground">
                        {dataHora(e.created_at)} · {e.ator === 'humano' ? (e.ator_nome ?? 'humano') : e.ator}
                        {e.observacao ? ` · ${e.observacao}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted-foreground/60">Sem eventos.</p>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}
