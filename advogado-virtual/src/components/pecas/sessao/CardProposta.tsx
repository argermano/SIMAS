'use client'

// A proposta pendente — o único lugar da sessão que pode mudar a peça, e só
// pelas mãos do advogado.
//
// O diff reaproveita o ComparadorSecoes (E9): base = a peça como está no
// editor, atual = a peça com o patch aplicado pela MESMA função pura do
// servidor. As escolhas por seção voltam como decisões para o endpoint, que
// recalcula tudo do lado de lá — a tela nunca envia texto de peça.

import { useMemo, useState } from 'react'
import { ComparadorSecoes } from '@/components/pecas/ComparadorSecoes'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { decisoesDaProposta, previaDaProposta, rotuloAcao } from '@/lib/ia/sessao/proposta-ui'
import type { SecaoPatch } from '@/lib/diff/patch-secoes'
import type { PropostaPeca } from '@/lib/ia/sessao/sessoes'
import type { EntradaDecisaoUI, ResultadoDecisaoUI } from './useSessaoPeca'
import { AlertTriangle, GitCompare, Loader2, X } from 'lucide-react'

export function CardProposta({
  proposta,
  conteudoAtual,
  onDecidir,
  onAplicada,
}: {
  proposta: PropostaPeca
  /** Texto da peça como está salvo agora (base do diff). */
  conteudoAtual: string
  onDecidir: (propostaId: string, entrada: EntradaDecisaoUI) => Promise<ResultadoDecisaoUI>
  /** Uma versão nova nasceu: o editor precisa recarregar o texto. */
  onAplicada: (versao: number | null) => void
}) {
  const { success, error: toastError, warning } = useToast()
  const [diffAberto, setDiffAberto] = useState(false)
  const [previaErro, setPreviaErro] = useState<string | null>(null)
  const [aplicando, setAplicando] = useState(false)

  const patch: SecaoPatch[] = useMemo(
    () => (Array.isArray(proposta.patch) ? proposta.patch : []),
    [proposta.patch],
  )
  const previa = useMemo(() => previaDaProposta(conteudoAtual, patch), [conteudoAtual, patch])

  function abrirDiff() {
    if (!previa.ok) {
      // A seção citada não existe mais (o advogado editou a peça no meio).
      setPreviaErro(previa.erro)
      return
    }
    setPreviaErro(null)
    setDiffAberto(true)
  }

  /** Envia a decisão, tratando os 409 com confirmação explícita. */
  async function enviarDecisao(entrada: EntradaDecisaoUI) {
    setAplicando(true)
    try {
      let r = await onDecidir(proposta.id, entrada)

      if (!r.ok && r.status === 409 && r.detalhes) {
        const det = r.detalhes as {
          pecaMudou?: boolean
          code?: string
          atual?: number
          novo?: number
          versaoBase?: number
          versaoAtual?: number
        }

        if (det.pecaMudou) {
          const msg =
            `A peça mudou desde que esta proposta foi gerada (proposta sobre a v${det.versaoBase}, ` +
            `peça na v${det.versaoAtual}). Aplicar assim mesmo pode sobrescrever o que veio depois.`
          if (!window.confirm(`${msg}\n\nAplicar mesmo assim?`)) return
          r = await onDecidir(proposta.id, { ...entrada, forcar: true })
        } else if (det.code === 'CONTEUDO_MENOR') {
          // Mesma conversa da guarda anti-encolhimento do salvar-peca.
          const atual = (det.atual ?? 0).toLocaleString('pt-BR')
          const novo = (det.novo ?? 0).toLocaleString('pt-BR')
          const msg = `O texto resultante tem ${novo} caracteres; a peça salva tem ${atual}. Aplicar substitui a versão maior.`
          if (!window.confirm(`${msg}\n\nAplicar mesmo assim?`)) return
          r = await onDecidir(proposta.id, { ...entrada, forcar: true })
        }
      }

      if (!r.ok) {
        toastError('Não foi possível aplicar', r.erro ?? 'Tente novamente.')
        return
      }

      setDiffAberto(false)
      if (r.versao == null) {
        warning('Proposta recusada', 'Nada foi alterado na peça.')
        onAplicada(null)
        return
      }
      success(`v${r.versao} criada`, `${r.aceitas ?? 0} seção(ões) aplicada(s) à peça.`)
      onAplicada(r.versao)
    } finally {
      setAplicando(false)
    }
  }

  return (
    <>
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Proposta de alteração</p>
          {proposta.versao_base != null && (
            <span className="shrink-0 text-[10px] text-muted-foreground">sobre a v{proposta.versao_base}</span>
          )}
        </div>

        {proposta.resumo && <p className="mb-2 text-sm leading-relaxed text-foreground">{proposta.resumo}</p>}

        <ul className="mb-3 space-y-1.5">
          {patch.map((p, i) => (
            <li key={`${p.titulo}-${i}`} className="rounded-lg bg-card/70 px-2.5 py-1.5">
              <p className="text-xs font-medium text-foreground">
                <span className="text-muted-foreground">{rotuloAcao(p.acao)} </span>
                {p.titulo || '(início da peça)'}
              </p>
              {p.motivo && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{p.motivo}</p>}
            </li>
          ))}
        </ul>

        {previaErro && (
          <p className="mb-2 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {previaErro}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={abrirDiff} disabled={aplicando || patch.length === 0} className="gap-1.5">
            {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
            Ver diff e aplicar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void enviarDecisao({ rejeitarTudo: true })}
            disabled={aplicando}
            className="gap-1.5 text-muted-foreground"
          >
            <X className="h-4 w-4" />
            Recusar
          </Button>
        </div>
      </div>

      {diffAberto && (
        <ComparadorSecoes
          base={conteudoAtual}
          atual={previa.ok ? previa.markdown : conteudoAtual}
          versaoBase={proposta.versao_base ?? undefined}
          onFechar={() => setDiffAberto(false)}
          onAplicar={(_markdown, detalhes) => {
            const decisoes = decisoesDaProposta(patch, detalhes ?? [])
            void enviarDecisao({ decisoes })
          }}
        />
      )}
    </>
  )
}
