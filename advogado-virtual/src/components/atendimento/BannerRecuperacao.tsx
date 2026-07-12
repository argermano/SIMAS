'use client'

import { Loader2, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Fase da recuperação pós-queda de conexão durante a geração/refino da peça. */
export type EstadoRecuperacao =
  | { fase: 'recuperando' }
  | { fase: 'sucesso'; chars: number }
  | { fase: 'falha' }

/**
 * Overlay que substitui o modal de geração quando o stream cai no meio. Avisa
 * que a conexão caiu e mostra o progresso da recuperação do texto completo que
 * o servidor salvou (rede de segurança). Nunca finge sucesso silencioso.
 */
export function BannerRecuperacao({
  estado,
  onFechar,
}: {
  estado: EstadoRecuperacao
  onFechar?: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card shadow-2xl">
        {estado.fase === 'recuperando' && (
          <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-6">
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-warning" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">A conexão caiu durante a geração</h2>
              <p className="text-sm text-muted-foreground">
                Recuperando o texto completo salvo no servidor... A peça continua sendo gerada
                mesmo com a janela fechada. Isto pode levar alguns minutos.
              </p>
            </div>
          </div>
        )}

        {estado.fase === 'sucesso' && (
          <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success/5 p-6">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">
                Texto completo recuperado — {estado.chars.toLocaleString('pt-BR')} caracteres
              </h2>
              <p className="text-sm text-muted-foreground">Abrindo o editor com a versão íntegra...</p>
            </div>
          </div>
        )}

        {estado.fase === 'falha' && (
          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-6">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">Não foi possível recuperar automaticamente</h2>
                <p className="text-sm text-muted-foreground">
                  Reabra a peça pelo atendimento — o rascunho salvo no servidor contém a versão
                  mais completa. Nada foi perdido.
                </p>
              </div>
            </div>
            {onFechar && (
              <div className="mt-4 flex justify-end">
                <Button variant="secondary" size="sm" onClick={onFechar}>
                  Entendi
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
