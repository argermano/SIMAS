'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Download, ExternalLink, FileText, HandCoins, Phone, Trash2, User } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatarValor } from '@/lib/financeiro/parcelas'
import { formatarDataRelativa } from '@/lib/utils'
import type { ComprovanteRecebido } from './InboxComprovantes'

/** "2026-07-11T…" | "2026-07-11" -> "11/07/2026" (fallback: original). */
function dataPtBr(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '—')
}

/**
 * Detalhe de um comprovante do INBOX (migration 053): o clique no corpo do item
 * abre esta tela com o arquivo em tamanho generoso, os dados que a IA extraiu e a
 * origem (telefone + cliente). As ações Atribuir/Descartar apenas DISPARAM os
 * fluxos já existentes no InboxComprovantes (o pai fecha o detalhe e abre o modal
 * de atribuição ou o diálogo de descarte) — nada de baixa automática aqui.
 * Segue o padrão visual do PagamentoModal. LGPD: nada de `dados` é logado.
 */
export function DetalheComprovanteModal({
  comprovante,
  onClose,
  onAtribuir,
  onDescartar,
}: {
  comprovante: ComprovanteRecebido | null
  onClose: () => void
  onAtribuir: () => void
  onDescartar: () => void
}) {
  // Falha ao carregar a <img> da signed URL → fallback textual.
  const [imgErro, setImgErro] = useState(false)

  const c = comprovante
  const dados = c?.dados
  const ehPdf = (c?.content_type ?? c?.dados?.contentType ?? '').includes('pdf')
  const url = c?.imagemUrl ?? null

  return (
    <Dialog
      open={Boolean(c)}
      onClose={onClose}
      title="Comprovante recebido"
      description={c ? `${formatarValor(dados?.valorCentavos ?? 0)} · ${c.telefone}` : undefined}
      size="lg"
      footer={
        <>
          {/* Descartar à esquerda (mesma cor destrutiva do inbox); Atribuir é a
              ação primária. Ambas fecham o detalhe e reusam os fluxos do pai. */}
          <Button
            variant="ghost"
            size="md"
            onClick={onDescartar}
            className="mr-auto text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" /> Descartar
          </Button>
          <Button variant="secondary" size="md" onClick={onClose}>Fechar</Button>
          <Button size="md" onClick={onAtribuir}>
            <HandCoins className="h-4 w-4" /> Atribuir
          </Button>
        </>
      }
    >
      {c && (
        <div className="space-y-4">
          {/* Comprovante em tamanho real (scroll no miolo do Dialog). PDF => link. */}
          <div className="rounded-lg border border-border bg-muted/20 p-2">
            {!url || (!ehPdf && imgErro) ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">Arquivo indisponível.</p>
            ) : ehPdf ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-md bg-background px-3 py-10 text-sm font-medium text-primary hover:underline"
              >
                <FileText className="h-5 w-5" /> Abrir comprovante (PDF)
              </a>
            ) : (
              <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL de bucket privado, não otimizável */}
                <img
                  src={url}
                  alt="Comprovante recebido"
                  onError={() => setImgErro(true)}
                  className="max-h-96 w-full cursor-zoom-in rounded-md object-contain"
                />
              </a>
            )}
          </div>

          {/* Atalhos do arquivo */}
          <div className="flex flex-wrap gap-2">
            {url && (
              <Button asChild variant="secondary" size="sm">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" /> Abrir em nova aba
                </a>
              </Button>
            )}
            {c.downloadUrl && (
              <Button asChild variant="secondary" size="sm">
                <a href={c.downloadUrl}>
                  <Download className="h-4 w-4" /> Baixar
                </a>
              </Button>
            )}
          </div>

          {/* Dados extraídos pela IA */}
          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Valor</p>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {formatarValor(dados?.valorCentavos ?? 0)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Data do pagamento</p>
                <p className="font-semibold tabular-nums text-foreground">{dataPtBr(dados?.dataISO)}</p>
                {/* Data de chegada no WhatsApp — distinta da data do pagamento (comprovante pode ser antigo). */}
                {c?.criado_em && (
                  <p className="mt-0.5 text-xs text-muted-foreground">recebido {formatarDataRelativa(c.criado_em)}</p>
                )}
              </div>
            </div>
            {(dados?.pagadorNome || dados?.recebedorNome || dados?.banco || dados?.endToEndId) && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-sm">
                {dados?.pagadorNome && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Pagador</dt>
                    <dd className="truncate font-medium text-foreground">{dados.pagadorNome}</dd>
                  </div>
                )}
                {/* Recebedor (favorecido/beneficiário) — só quando a IA extraiu.
                    Alimenta o filtro "só recibos do escritório" no inbox. */}
                {dados?.recebedorNome && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Recebedor</dt>
                    <dd className="truncate font-medium text-foreground">{dados.recebedorNome}</dd>
                  </div>
                )}
                {dados?.banco && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Banco</dt>
                    <dd className="truncate font-medium text-foreground">{dados.banco}</dd>
                  </div>
                )}
                {dados?.endToEndId && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">End-to-end ID</dt>
                    <dd className="truncate font-mono text-xs text-foreground">{dados.endToEndId}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>

          {/* Origem: cliente (link ao dossiê quando houver) + telefone */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            {c.cliente_id ? (
              <Link
                href={`/clientes/${c.cliente_id}`}
                className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-primary hover:underline"
              >
                <User className="h-4 w-4 text-muted-foreground" aria-hidden /> {c.cliente_nome ?? 'Cliente'}
              </Link>
            ) : c.contato_nome ? (
              // Sem cadastro, mas o Chatwoot conhece o contato: mostra o nome + tooltip.
              <span
                title="Contato do Chatwoot — sem cadastro de cliente"
                className="inline-flex items-center gap-1.5 font-medium text-foreground"
              >
                <User className="h-4 w-4 text-muted-foreground" aria-hidden /> {c.contato_nome}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 italic text-muted-foreground">
                <User className="h-4 w-4" aria-hidden /> Cliente não identificado
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Phone className="h-4 w-4" aria-hidden /> {c.telefone}
            </span>
          </div>
        </div>
      )}
    </Dialog>
  )
}
