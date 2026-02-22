'use client'

import { useState } from 'react'
import { EditorPeca } from '@/components/pecas/EditorPeca'
import { PainelLateral } from '@/components/pecas/PainelLateral'
import { BotaoExportar } from '@/components/pecas/BotaoExportar'
import { RelatorioValidacao } from '@/components/pecas/RelatorioValidacao'
import { ComandosRapidos } from '@/components/atendimento/ComandosRapidos'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ShieldCheck, Loader2 } from 'lucide-react'

interface EditorPecaClientProps {
  pecaId: string
  atendimentoId: string
  area: string
  tipo: string
  conteudoInicial: string
  versaoInicial: number
  statusInicial: string
}

export function EditorPecaClient({
  pecaId,
  atendimentoId,
  area,
  tipo,
  conteudoInicial,
  versaoInicial,
  statusInicial,
}: EditorPecaClientProps) {
  const { success, error: toastError } = useToast()
  const [conteudo, setConteudo] = useState(conteudoInicial)
  const [versao, setVersao] = useState(versaoInicial)
  const [status, setStatus] = useState(statusInicial)
  const [validando, setValidando] = useState(false)
  const [validacao, setValidacao] = useState<Record<string, unknown> | null>(null)

  // Após salvar, incrementa versão local (EditorPeca chama a API diretamente)
  function handleConteudoChange(novoConteudo: string) {
    setConteudo(novoConteudo)
  }

  async function handleValidar() {
    if (!conteudo.trim()) {
      toastError('Peça vazia', 'Salve a peça antes de validar')
      return
    }
    setValidando(true)
    setValidacao(null)
    try {
      const res = await fetch('/api/ia/validar-peca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pecaId }),
      })
      const data = await res.json()
      if (res.ok) {
        setValidacao(data)
        setStatus('revisada')
        success('Validação concluída', 'Relatório disponível abaixo do editor')
      } else {
        toastError('Erro na validação', data.error ?? 'Tente novamente')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setValidando(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Grid principal: editor + painel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Editor — 2/3 */}
        <div className="lg:col-span-2">
          <EditorPeca
            pecaId={pecaId}
            conteudo={conteudo}
            versao={versao}
            status={status}
            onConteudoChange={handleConteudoChange}
          />
        </div>

        {/* Painel lateral — 1/3 */}
        <div className="space-y-4">
          <PainelLateral
            conteudo={conteudo}
            area={area}
            tipo={tipo}
          />

          {/* Ações */}
          <div className="flex flex-col gap-2">
            <BotaoExportar pecaId={pecaId} />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleValidar}
              disabled={validando || !conteudo.trim()}
              className="gap-1.5 w-full"
            >
              {validando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Validando...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Revisar e Validar
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Relatório de validação */}
      {validacao && (
        <RelatorioValidacao data={validacao} />
      )}

      {/* Comandos rápidos */}
      <ComandosRapidos
        atendimentoId={atendimentoId}
        disabled={!atendimentoId}
      />
    </div>
  )
}
