'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { ScrollText, FileText, ExternalLink, FileSignature, FilePlus } from 'lucide-react'

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

interface DocumentosDoCasoProps {
  area: string
  cliente: { id: string; nome: string } | null
  pecasExistentes: PecaExistente[]
  contratosExistentes: ContratoExistente[]
}

export function DocumentosDoCaso({
  area,
  cliente,
  pecasExistentes,
  contratosExistentes,
}: DocumentosDoCasoProps) {
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

        {/* Ações rápidas: gerar documentos */}
        {cliente && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Gerar documentos</p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/${area}/modelos/procuracao?clienteId=${cliente.id}`}
                className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                Procuração
              </Link>
              <Link
                href={`/${area}/modelos/declaracao_hipossuficiencia?clienteId=${cliente.id}`}
                className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                Declaração de Hipossuficiência
              </Link>
              {contratosExistentes.length === 0 && (
                <Link
                  href={`/contratos/novo?cliente_id=${cliente.id}`}
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
