'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/dialog'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import {
  Save, CheckCircle, Download, Clock, ChevronDown, ChevronUp,
  DollarSign, User, FileDown, Printer, FileText, Eye, Pencil,
} from 'lucide-react'

const BADGE_STATUS: Record<string, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  rascunho:   { variant: 'secondary', label: 'Rascunho'   },
  em_revisao: { variant: 'warning',   label: 'Em revisão' },
  aprovado:   { variant: 'success',   label: 'Aprovado'   },
  exportado:  { variant: 'success',   label: 'Exportado'  },
}

const LABEL_AREA: Record<string, string> = {
  previdenciario: 'Previdenciário',
  trabalhista:    'Trabalhista',
  civel:          'Cível',
  criminal:       'Criminal',
  tributario:     'Tributário',
  empresarial:    'Empresarial',
  familia:        'Família',
  consumidor:     'Consumidor',
  imobiliario:    'Imobiliário',
  administrativo: 'Administrativo',
}

interface EditorContratoClientProps {
  contratoId: string
  contrato: {
    titulo: string
    area: string | null
    conteudo_markdown: string
    status: string
    versao: number
    valor_fixo: number | null
    percentual_exito: number | null
    forma_pagamento: string | null
    clientes: { nome: string; cpf?: string } | null
    atendimentos: { area?: string } | null
  }
  versoes: { id: string; versao: number; created_at: string }[]
  role: string
}

export function EditorContratoClient({ contratoId, contrato, versoes, role }: EditorContratoClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [conteudo,      setConteudo]      = useState(contrato.conteudo_markdown)
  const [status,        setStatus]        = useState(contrato.status)
  const [versao,        setVersao]        = useState(contrato.versao)
  const [salvando,        setSalvando]        = useState(false)
  const [aprovando,       setAprovando]       = useState(false)
  const [exportandoDocx,  setExportandoDocx]  = useState(false)
  const [versoesAberto,   setVersoesAberto]   = useState(false)
  const [confirmarAprovar, setConfirmarAprovar] = useState(false)
  const [menuExport,      setMenuExport]      = useState(false)
  const [modoPrevia,      setModoPrevia]      = useState(false)

  const podeAprovar  = ['admin', 'advogado'].includes(role)
  const badge        = BADGE_STATUS[status] ?? BADGE_STATUS.rascunho

  const salvar = useCallback(async () => {
    setSalvando(true)
    try {
      const res  = await fetch(`/api/contratos/${contratoId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ conteudo_markdown: conteudo }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro ao salvar', data.error ?? 'Tente novamente')
      } else {
        setVersao(data.contrato.versao)
        success('Salvo!', `Versão ${data.contrato.versao} registrada`)
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setSalvando(false)
    }
  }, [contratoId, conteudo, success, toastError])

  const aprovar = useCallback(async () => {
    setAprovando(true)
    try {
      const res  = await fetch(`/api/contratos/${contratoId}/aprovar`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro', data.error ?? 'Não foi possível aprovar')
      } else {
        setStatus('aprovado')
        success('Contrato aprovado!', 'O contrato está pronto para exportação')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setAprovando(false)
      setConfirmarAprovar(false)
    }
  }, [contratoId, success, toastError])

  const exportarDocx = useCallback(async () => {
    setExportandoDocx(true)
    try {
      const res = await fetch(`/api/contratos/${contratoId}/exportar-docx`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toastError('Erro', data.error ?? 'Não foi possível exportar DOCX')
        return
      }

      const blob        = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match       = disposition.match(/filename="([^"]+)"/)
      const filename    = match?.[1] ?? 'contrato.docx'

      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href     = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setStatus('exportado')
      setMenuExport(false)
      success('Exportado!', 'Arquivo .docx baixado com sucesso')
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setExportandoDocx(false)
    }
  }, [contratoId, success, toastError])

  const imprimirPdf = useCallback(() => {
    const janela = window.open('', '_blank')
    if (!janela) return
    janela.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <title>${contrato.titulo}</title>
      <style>
        body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; margin: 2cm; color: #000; }
        h1 { font-size: 14pt; text-align: center; text-transform: uppercase; margin-bottom: 16pt; }
        h2 { font-size: 12pt; text-transform: uppercase; margin-top: 20pt; margin-bottom: 8pt; }
        h3 { font-size: 12pt; margin-top: 12pt; margin-bottom: 4pt; }
        hr { border: none; border-top: 1px solid #000; margin: 12pt 0; }
        p  { margin: 6pt 0; text-align: justify; }
        @media print { @page { margin: 2cm; } }
      </style>
    </head><body>
      <pre style="font-family:inherit;white-space:pre-wrap;font-size:12pt">${conteudo.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      <script>window.onload=()=>{window.print();window.close()}<\/script>
    </body></html>`)
    janela.document.close()
    setMenuExport(false)
  }, [conteudo, contrato.titulo])

  const honorario = contrato.valor_fixo
    ? `R$ ${contrato.valor_fixo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : contrato.percentual_exito !== null
      ? `${contrato.percentual_exito}% êxito`
      : '—'

  return (
    <>
      <ConfirmDialog
        open={confirmarAprovar}
        onClose={() => setConfirmarAprovar(false)}
        onConfirm={aprovar}
        title="Aprovar contrato"
        description="Confirma a aprovação deste contrato de honorários? Após aprovado, ele estará pronto para exportação e assinatura."
        confirmLabel="Aprovar"
        loading={aprovando}
      />

      <div className="grid gap-6 lg:grid-cols-3">

        {/* Editor — coluna principal */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={badge.variant}>{badge.label}</Badge>
              <span className="text-sm text-gray-400">v{versao}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="md"
                onClick={salvar}
                loading={salvando}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                Salvar
              </Button>
              {podeAprovar && status !== 'aprovado' && status !== 'exportado' && (
                <Button
                  size="md"
                  onClick={() => setConfirmarAprovar(true)}
                  disabled={!conteudo.trim()}
                  className="gap-2 bg-green-700 hover:bg-green-800"
                >
                  <CheckCircle className="h-4 w-4" />
                  Aprovar
                </Button>
              )}
              {podeAprovar && (status === 'aprovado' || status === 'exportado') && (
                <div className="relative">
                  <Button
                    size="md"
                    onClick={() => setMenuExport(v => !v)}
                    className="gap-2"
                    disabled={exportandoDocx}
                  >
                    <Download className="h-4 w-4" />
                    Exportar
                    <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
                  </Button>
                  {menuExport && (
                    <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-gray-200 bg-white shadow-lg">
                      <button
                        onClick={exportarDocx}
                        disabled={exportandoDocx}
                        className="flex w-full items-center gap-2.5 rounded-t-xl px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <FileDown className="h-4 w-4 text-primary-600" />
                        {exportandoDocx ? 'Gerando DOCX...' : 'Baixar como .docx'}
                      </button>
                      <button
                        onClick={imprimirPdf}
                        className="flex w-full items-center gap-2.5 rounded-b-xl px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Printer className="h-4 w-4 text-gray-500" />
                        Imprimir / Salvar PDF
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Tabs Editar / Prévia */}
          <div className="flex items-center gap-0 border-b border-gray-200">
            <button
              onClick={() => setModoPrevia(false)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
                !modoPrevia
                  ? 'border-b-2 border-primary-600 text-primary-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </button>
            <button
              onClick={() => setModoPrevia(true)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
                modoPrevia
                  ? 'border-b-2 border-primary-600 text-primary-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Prévia
            </button>
          </div>

          {modoPrevia ? (
            <div className="min-h-[600px] rounded-lg border border-gray-200 bg-white p-8 overflow-y-auto">
              <MarkdownPreview>{conteudo}</MarkdownPreview>
            </div>
          ) : (
            <Textarea
              label="Conteúdo do contrato"
              value={conteudo}
              onChange={e => setConteudo(e.target.value)}
              rows={30}
              hint="Edite o texto do contrato. Use Markdown para formatação."
            />
          )}
        </div>

        {/* Painel lateral */}
        <div className="space-y-4">
          {/* Dados do contrato */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-400" />
                Dados do contrato
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 space-y-2 text-sm text-gray-700">
              <div className="flex gap-2">
                <User className="h-4 w-4 shrink-0 text-gray-400 mt-0.5" />
                <span>{contrato.clientes?.nome ?? '—'}</span>
              </div>
              {contrato.area && (
                <p className="text-gray-500">
                  Área: {LABEL_AREA[contrato.area] ?? contrato.area}
                </p>
              )}
              <div className="flex gap-2">
                <DollarSign className="h-4 w-4 shrink-0 text-gray-400 mt-0.5" />
                <span>{honorario}</span>
              </div>
              {contrato.forma_pagamento && (
                <p className="text-gray-500">{contrato.forma_pagamento}</p>
              )}
            </CardContent>
          </Card>

          {/* Histórico de versões */}
          {versoes.length > 0 && (
            <Card>
              <button
                className="w-full"
                onClick={() => setVersoesAberto(v => !v)}
              >
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-sm flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-gray-400" />
                      Histórico de versões
                    </span>
                    {versoesAberto
                      ? <ChevronUp className="h-4 w-4 text-gray-400" />
                      : <ChevronDown className="h-4 w-4 text-gray-400" />
                    }
                  </CardTitle>
                </CardHeader>
              </button>
              {versoesAberto && (
                <CardContent className="pb-4">
                  <ul className="space-y-1">
                    {versoes.map(v => (
                      <li key={v.id} className="flex items-center justify-between text-sm text-gray-600">
                        <span className="font-medium">v{v.versao}</span>
                        <span className="text-xs text-gray-400">
                          {new Date(v.created_at).toLocaleDateString('pt-BR')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Card>
          )}

          <Button
            variant="ghost"
            size="md"
            onClick={() => router.push('/contratos')}
            className="w-full text-gray-500"
          >
            ← Voltar para contratos
          </Button>
        </div>
      </div>
    </>
  )
}
