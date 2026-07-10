'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { cn, formatarData } from '@/lib/utils'
import { ExternalLink, FileText } from 'lucide-react'
import type { PublicacaoDetalhe } from '@/components/publicacoes/tipos'

/**
 * Aba "Publicação" do modal de tarefa. Quando a tarefa nasceu de uma publicação
 * (`origin_reference` = "publicacao:<id>"), busca o detalhe em
 * GET /api/publicacoes/[id] e mostra o card resumo estilo Astrea
 * (Diário/Vara/Comarca/Divulgado/Publicado/Processo/Termo) com link "Ver".
 * NUNCA deriva prazo — só a data de publicação PRESUMIDA, como referência.
 */
export function CardPublicacao({ publicacaoId }: { publicacaoId: string }) {
  const [pub, setPub] = useState<PublicacaoDetalhe | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/publicacoes/${publicacaoId}`)
        if (!vivo) return
        if (res.ok) {
          const d = await res.json().catch(() => ({}))
          setPub((d.publicacao ?? null) as PublicacaoDetalhe | null)
        } else {
          setPub(null)
        }
      } catch {
        if (vivo) setPub(null)
      } finally {
        if (vivo) setLoading(false)
      }
    })()
    return () => { vivo = false }
  }, [publicacaoId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Carregando publicação…
      </div>
    )
  }

  if (!pub) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Não foi possível carregar a publicação vinculada.
      </p>
    )
  }

  const diario = [pub.sigla_tribunal, pub.tipo_comunicacao || pub.tipo_documento].filter(Boolean).join(' · ') || '—'
  const processo = pub.numero_mascara || pub.numero_processo || '—'
  const termo = pub.oab_consultada ? `OAB ${pub.oab_consultada}${pub.uf_oab ? '/' + pub.uf_oab : ''}` : '—'

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      {/* Cabeçalho */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          Publicação vinculada
        </div>
        {pub.link && (
          <a
            href={pub.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Ver
          </a>
        )}
      </div>

      {/* Grid de campos */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
        <Campo rotulo="Diário" valor={diario} className="col-span-2" />
        <Campo rotulo="Vara / Comarca" valor={pub.orgao_julgador || '—'} className="col-span-2" />
        <Campo rotulo="Divulgado" valor={pub.data_disponibilizacao ? formatarData(pub.data_disponibilizacao) : '—'} />
        <Campo
          rotulo="Publicado (presumida)"
          valor={pub.data_publicacao_sugerida ? formatarData(pub.data_publicacao_sugerida) : '—'}
        />
        <Campo rotulo="Processo" valor={processo} />
        <Campo rotulo="Termo" valor={termo} />
      </dl>

      {/* Trecho / inteiro teor resumido */}
      {(pub.trecho || pub.textoPlano) && (
        <div className="mt-3">
          <dt className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Trecho</dt>
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm text-foreground">
            {pub.trecho || pub.textoPlano}
          </p>
        </div>
      )}
    </div>
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
