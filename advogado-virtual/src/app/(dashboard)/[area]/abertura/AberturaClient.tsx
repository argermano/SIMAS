'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { SeletorCliente } from '@/components/atendimento/SeletorCliente'
import {
  TIPOS_PROCESSO,
  getChecklist,
  type TipoServico,
  type ItemChecklist,
} from '@/lib/constants/checklist-documentos'
import {
  Users,
  Scale,
  CheckSquare,
  Square,
  ExternalLink,
  FileDown,
  Check,
  Loader2,
} from 'lucide-react'

interface AberturaClientProps {
  area: string
  areaNome: string
}

export function AberturaClient({ area, areaNome }: AberturaClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [atendimentoId,   setAtendimentoId]   = useState<string | null>(null)
  const [cliente,         setCliente]          = useState<{ id: string; nome: string } | null>(null)
  const [tipoServico,     setTipoServico]      = useState<TipoServico>('judicial')
  const [tipoProcesso,    setTipoProcesso]     = useState<string>('')
  const [entregues,       setEntregues]        = useState<Record<string, boolean>>({})
  const [salvandoClass,   setSalvandoClass]    = useState(false)
  const [classificado,    setClassificado]     = useState(false)

  // ── Criar atendimento ao selecionar cliente ─────────────────────────────────

  const handleClienteSelecionado = useCallback(async (c: { id: string; nome: string } | null) => {
    if (!c) {
      setCliente(null)
      setAtendimentoId(null)
      setClassificado(false)
      setEntregues({})
      return
    }
    setCliente(c)
    if (!atendimentoId) {
      try {
        const res = await fetch('/api/atendimentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliente_id: c.id, area, modo_input: 'texto' }),
        })
        const data = await res.json()
        if (data.id) {
          setAtendimentoId(data.id)
        } else {
          toastError('Erro', data.error ?? 'Não foi possível criar o caso')
        }
      } catch {
        toastError('Erro', 'Falha de rede ao criar o caso')
      }
    }
  }, [atendimentoId, area, toastError])

  // ── Salvar classificação ────────────────────────────────────────────────────

  async function salvarClassificacao() {
    if (!atendimentoId) return
    if (tipoServico === 'judicial' && !tipoProcesso) {
      toastError('Atenção', 'Selecione o tipo de processo')
      return
    }

    setSalvandoClass(true)
    try {
      const res = await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo_servico:  tipoServico,
          tipo_processo: tipoServico === 'judicial' ? tipoProcesso : null,
        }),
      })
      if (res.ok) {
        setClassificado(true)
        setEntregues({})
        success('Caso classificado!', 'Gerencie o checklist de documentos abaixo.')
      } else {
        const data = await res.json()
        toastError('Erro', data.error ?? 'Falha ao salvar classificação')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setSalvandoClass(false)
    }
  }

  // ── Checklist ───────────────────────────────────────────────────────────────

  const checklist: ItemChecklist[] = classificado
    ? getChecklist(area, tipoServico, tipoServico === 'judicial' ? tipoProcesso : undefined)
    : []

  const pendentes = checklist.filter(d => !entregues[d.id])

  async function toggleEntregue(docId: string, atual: boolean) {
    if (!atendimentoId) return
    const novoEstado = !atual
    setEntregues(prev => ({ ...prev, [docId]: novoEstado }))

    try {
      await fetch('/api/atendimentos/checklist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atendimentoId, docId, entregue: novoEstado }),
      })
    } catch {
      // Reverte otimisticamente em caso de falha
      setEntregues(prev => ({ ...prev, [docId]: atual }))
      toastError('Erro', 'Não foi possível salvar')
    }
  }

  // ── Exportar pendências ─────────────────────────────────────────────────────

  function exportarPendentes() {
    const docsPendentes = checklist.filter(d => !entregues[d.id] && !d.geradoPeloEscritorio)
    if (docsPendentes.length === 0) {
      success('Tudo entregue!', 'Não há documentos pendentes.')
      return
    }

    const tipoLabel = tipoServico === 'administrativo'
      ? 'Serviço Administrativo'
      : TIPOS_PROCESSO[area]?.find(p => p.value === tipoProcesso)?.label ?? tipoProcesso

    const dataHoje = new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' })

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Documentos Pendentes — ${cliente?.nome ?? 'Cliente'}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; color: #222; }
    h1 { font-size: 20px; color: #1e3a5f; border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; }
    .meta { font-size: 13px; color: #555; margin-bottom: 24px; }
    ul { list-style: none; padding: 0; }
    li { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #eee; font-size: 14px; }
    li::before { content: "☐"; font-size: 18px; color: #1e3a5f; }
    .footer { margin-top: 32px; font-size: 12px; color: #888; }
  </style>
</head>
<body>
  <h1>Documentos Pendentes</h1>
  <div class="meta">
    <strong>Cliente:</strong> ${cliente?.nome ?? '—'}<br/>
    <strong>Tipo de serviço:</strong> ${areaNome} — ${tipoLabel}<br/>
    <strong>Data:</strong> ${dataHoje}
  </div>
  <p style="font-size:14px;color:#555">Por favor, entregue os documentos abaixo no escritório para que possamos dar continuidade ao seu caso:</p>
  <ul>
    ${docsPendentes.map(d => `<li>${d.nome}${d.obrigatorio ? '' : ' <em style="color:#888">(se houver)</em>'}</li>`).join('\n    ')}
  </ul>
  <div class="footer">Documento gerado em ${dataHoje}</div>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html' })
    const url  = URL.createObjectURL(blob)
    const win  = window.open(url, '_blank')
    win?.addEventListener('load', () => {
      win.print()
      URL.revokeObjectURL(url)
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const processosArea = TIPOS_PROCESSO[area] ?? []

  return (
    <div className="space-y-6">

      {/* 1. Cliente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-gray-400" />
            Cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SeletorCliente
            onSelecionado={handleClienteSelecionado}
            clienteSelecionado={cliente}
          />
        </CardContent>
      </Card>

      {/* 2. Classificação do serviço */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Scale className="h-5 w-5 text-gray-400" />
            Classificação do Serviço
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Tipo administrativo / judicial */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">Tipo de serviço</p>
            <div className="flex gap-3">
              {(['administrativo', 'judicial'] as TipoServico[]).map((tipo) => (
                <button
                  key={tipo}
                  onClick={() => { setTipoServico(tipo); setClassificado(false); setEntregues({}) }}
                  disabled={!atendimentoId}
                  className={`flex-1 rounded-xl border-2 py-3 px-4 text-sm font-medium transition-all disabled:opacity-40 ${
                    tipoServico === tipo
                      ? 'border-primary-600 bg-primary-50 text-primary-800'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {tipo === 'administrativo' ? 'Administrativo' : 'Judicial'}
                </button>
              ))}
            </div>
          </div>

          {/* Tipo de processo (só para judicial) */}
          {tipoServico === 'judicial' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Tipo de processo
              </label>
              <select
                value={tipoProcesso}
                onChange={(e) => { setTipoProcesso(e.target.value); setClassificado(false); setEntregues({}) }}
                disabled={!atendimentoId}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-600 disabled:opacity-40"
              >
                <option value="">Selecione o tipo de processo...</option>
                {processosArea.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

          <Button
            onClick={salvarClassificacao}
            disabled={!atendimentoId || salvandoClass || (tipoServico === 'judicial' && !tipoProcesso)}
            className="gap-2"
          >
            {salvandoClass ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</>
            ) : classificado ? (
              <><Check className="h-4 w-4" />Classificado — atualizar</>
            ) : (
              'Confirmar classificação'
            )}
          </Button>
        </CardContent>
      </Card>

      {/* 3. Checklist de documentos */}
      {classificado && checklist.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckSquare className="h-5 w-5 text-gray-400" />
                Documentos Necessários
                <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                  {checklist.length - pendentes.length}/{checklist.length} entregues
                </span>
              </CardTitle>
              <button
                onClick={exportarPendentes}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                title="Exportar pendências como PDF"
              >
                <FileDown className="h-3.5 w-3.5" />
                Exportar pendências
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Documentos a entregar pelo cliente */}
            <div className="divide-y">
              {checklist
                .filter(d => !d.geradoPeloEscritorio)
                .map((doc) => {
                  const entregue = entregues[doc.id] ?? false
                  return (
                    <div
                      key={doc.id}
                      className={`flex items-center gap-3 py-3 transition-colors ${entregue ? 'opacity-50' : ''}`}
                    >
                      <button
                        onClick={() => toggleEntregue(doc.id, entregue)}
                        className="shrink-0 text-primary-700 hover:text-primary-900 transition-colors"
                        aria-label={entregue ? 'Marcar como pendente' : 'Marcar como entregue'}
                      >
                        {entregue
                          ? <CheckSquare className="h-5 w-5" />
                          : <Square className="h-5 w-5" />
                        }
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-medium ${entregue ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                          {doc.nome}
                        </span>
                        {!doc.obrigatorio && (
                          <span className="ml-2 text-xs text-gray-400">(se houver)</span>
                        )}
                      </div>
                      {entregue && (
                        <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Entregue
                        </span>
                      )}
                    </div>
                  )
                })}
            </div>

            {/* Documentos gerados pelo escritório */}
            {checklist.some(d => d.geradoPeloEscritorio) && (
              <div className="mt-6 rounded-xl border border-primary-100 bg-primary-50 p-4">
                <p className="mb-3 text-sm font-semibold text-primary-800">
                  Documentos gerados pelo escritório
                </p>
                <div className="space-y-2">
                  {checklist
                    .filter(d => d.geradoPeloEscritorio)
                    .map((doc) => (
                      <a
                        key={doc.id}
                        href={`/${area}/modelos/${doc.modeloId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-primary-200 bg-white px-3 py-2.5 text-sm font-medium text-primary-800 hover:bg-primary-100 transition-colors"
                      >
                        <ExternalLink className="h-4 w-4 shrink-0" />
                        Gerar {doc.nome}
                        {!doc.obrigatorio && (
                          <span className="ml-auto text-xs font-normal text-gray-400">(se aplicável)</span>
                        )}
                      </a>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 4. Ações */}
      <div className="flex justify-end gap-3 pb-8">
        <Button variant="secondary" onClick={() => router.push(`/${area}`)}>
          Voltar à área
        </Button>
        {classificado && atendimentoId && (
          <Button
            onClick={() => router.push(`/${area}/consultoria?atendimentoId=${atendimentoId}`)}
            className="gap-2"
          >
            Ir para Análise IA
          </Button>
        )}
      </div>
    </div>
  )
}
