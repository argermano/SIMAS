'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { ScrollText, FileText, ExternalLink, FileSignature, FilePlus, Download, Trash2, Loader2 } from 'lucide-react'

interface PecaExistente {
  id: string
  tipo: string
  area: string
  versao: number
  status: string
  created_at: string
}

interface ContratoExistente {
  id: string
  titulo: string
  status: string
  area: string
  created_at: string
}

interface DocumentoAnexado {
  id: string
  tipo: string
  file_name?: string | null
}

interface DocumentosDoCasoProps {
  area: string
  atendimentoId: string | null
  cliente: { id: string; nome: string } | null
  pecasExistentes: PecaExistente[]
  contratosExistentes: ContratoExistente[]
  documentosAnexados?: DocumentoAnexado[]
}

export function DocumentosDoCaso({
  area,
  atendimentoId,
  cliente,
  pecasExistentes,
  contratosExistentes,
  documentosAnexados = [],
}: DocumentosDoCasoProps) {
  const [anexados, setAnexados] = useState<DocumentoAnexado[]>(documentosAnexados)
  const [excluindo, setExcluindo] = useState<string | null>(null)

  async function baixarAnexado(docId: string) {
    try {
      const res = await fetch(`/api/documentos/${docId}/url`)
      const data = await res.json()
      if (data.url) window.open(data.url, '_blank')
    } catch { /* silencioso */ }
  }

  async function excluirAnexado(docId: string) {
    if (!window.confirm('Excluir este documento do caso? Esta ação não pode ser desfeita.')) return
    setExcluindo(docId)
    try {
      const res = await fetch(`/api/documentos/${docId}`, { method: 'DELETE' })
      if (res.ok) {
        setAnexados((prev) => prev.filter((d) => d.id !== docId))
      }
    } catch { /* silencioso */ } finally {
      setExcluindo(null)
    }
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ScrollText className="h-5 w-5 text-primary" />
          Documentos do caso
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Peças */}
        {pecasExistentes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Peças processuais</p>
            {pecasExistentes.map(peca => {
              const tipoCfg = TIPOS_PECA[peca.tipo]
              const badgeVariant = peca.status === 'aprovada' ? 'success' as const
                : peca.status === 'revisada' ? 'default' as const
                : 'secondary' as const
              const statusLabel = peca.status === 'aprovada' ? 'Aprovada'
                : peca.status === 'revisada' ? 'Revisada'
                : peca.status === 'exportada' ? 'Exportada'
                : 'Rascunho'
              return (
                <Link
                  key={peca.id}
                  href={`/${peca.area}/editor/${peca.id}`}
                  className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {tipoCfg?.nome ?? peca.tipo}
                    </span>
                    <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0 shrink-0">
                      {statusLabel}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground shrink-0">v{peca.versao}</span>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                </Link>
              )
            })}
          </div>
        )}

        {/* Contratos */}
        {contratosExistentes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Contratos</p>
            {contratosExistentes.map(contrato => {
              const badgeVariant = contrato.status === 'aprovado' ? 'success' as const
                : contrato.status === 'exportado' ? 'success' as const
                : 'secondary' as const
              const statusLabel = contrato.status === 'aprovado' ? 'Aprovado'
                : contrato.status === 'exportado' ? 'Exportado'
                : contrato.status === 'em_revisao' ? 'Em revisão'
                : 'Rascunho'
              return (
                <Link
                  key={contrato.id}
                  href={`/contratos/${contrato.id}`}
                  className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileSignature className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {contrato.titulo}
                    </span>
                    <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0 shrink-0">
                      {statusLabel}
                    </Badge>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                </Link>
              )
            })}
          </div>
        )}

        {/* Documentos gerados/anexados (procuração, declaração, etc.) */}
        {anexados.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Documentos anexados</p>
            {anexados.map((doc) => (
              <div
                key={doc.id}
                className="group flex items-center gap-1 rounded-lg border bg-card pr-1.5 transition-colors hover:bg-muted/50"
              >
                <button
                  onClick={() => baixarAnexado(doc.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
                >
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium text-foreground">
                    {doc.file_name ?? doc.tipo}
                  </span>
                  <Download className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                </button>
                <button
                  onClick={() => excluirAnexado(doc.id)}
                  disabled={excluindo === doc.id}
                  title="Excluir documento"
                  aria-label="Excluir documento"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  {excluindo === doc.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Ações rápidas: gerar documentos */}
        {cliente && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Gerar documentos</p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/${area}/modelos/procuracao?clienteId=${cliente.id}${atendimentoId ? `&atendimentoId=${atendimentoId}` : ''}`}
                className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                Procuração
              </Link>
              <Link
                href={`/${area}/modelos/declaracao_hipossuficiencia?clienteId=${cliente.id}${atendimentoId ? `&atendimentoId=${atendimentoId}` : ''}`}
                className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                Declaração de Hipossuficiência
              </Link>
              {contratosExistentes.length === 0 && (
                <Link
                  href={`/contratos/novo?cliente_id=${cliente.id}${atendimentoId ? `&atendimentoId=${atendimentoId}` : ''}`}
                  className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                >
                  <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                  Contrato de Honorários
                </Link>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
