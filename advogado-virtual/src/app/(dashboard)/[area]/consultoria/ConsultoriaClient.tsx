'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { SeletorCliente } from '@/components/atendimento/SeletorCliente'
import { GravadorAudio } from '@/components/atendimento/GravadorAudio'
import { UploadDocumentos } from '@/components/atendimento/UploadDocumentos'
import { RelatorioAnalise } from '@/components/analise/RelatorioAnalise'
import { useRouter } from 'next/navigation'
import { Mic, Keyboard, Users, MessageSquare, Brain, Loader2 } from 'lucide-react'

interface ConsultoriaClientProps {
  area: string
  areaNome: string
  tiposDocumento: string[]
  tipoConsultoria: string
}

const TITULOS_CONSULTORIA: Record<string, string> = {
  caso_novo:  'Análise de Caso',
  parecer:    'Parecer Jurídico',
  estrategia: 'Estratégia Processual',
}

export function ConsultoriaClient({
  area,
  areaNome,
  tiposDocumento,
  tipoConsultoria,
}: ConsultoriaClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [atendimentoId, setAtendimentoId] = useState<string | null>(null)
  const [cliente, setCliente]             = useState<{ id: string; nome: string } | null>(null)
  const [modoInput, setModoInput]         = useState<'audio' | 'texto'>('audio')
  const [textoRelato, setTextoRelato]     = useState('')
  const [transcricao, setTranscricao]     = useState('')
  const [pedidoEspecifico, setPedidoEspecifico] = useState('')
  const [analisando, setAnalisando]       = useState(false)
  const [analise, setAnalise]             = useState<Record<string, unknown> | null>(null)

  const tituloConsultoria = TITULOS_CONSULTORIA[tipoConsultoria] ?? 'Análise de Caso'

  // Criar atendimento ao selecionar cliente
  const handleClienteSelecionado = useCallback(async (c: { id: string; nome: string } | null) => {
    if (!c) {
      setCliente(null)
      setAtendimentoId(null)
      return
    }
    setCliente(c)
    if (!atendimentoId) {
      try {
        const res = await fetch('/api/atendimentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cliente_id: c.id,
            area,
            tipo_peca_origem: null,
            modo_input: modoInput,
            origem: 'consultoria',
          }),
        })
        const data = await res.json()
        if (data.id) {
          setAtendimentoId(data.id)
        } else {
          toastError('Erro', data.error ?? 'Não foi possível criar o atendimento')
        }
      } catch {
        toastError('Erro', 'Falha de rede ao criar atendimento')
      }
    }
  }, [atendimentoId, area, modoInput, toastError])

  const handleTranscricao = useCallback((texto: string) => {
    setTranscricao(texto)
    setTextoRelato(texto)
    success('Áudio transcrito', 'Revise o texto e clique em Analisar Caso')
  }, [success])

  async function analisar() {
    if (!atendimentoId) return

    // Salva atendimento antes de analisar
    await fetch(`/api/atendimentos/${atendimentoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcricao_editada: textoRelato,
        pedidos_especificos: pedidoEspecifico,
        modo_input: modoInput,
      }),
    })

    setAnalisando(true)
    setAnalise(null)
    try {
      const res = await fetch('/api/ia/analise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atendimentoId }),
      })
      const data = await res.json()
      if (res.ok) {
        setAnalise(data)
        success('Análise concluída', 'Veja o relatório abaixo')
      } else {
        toastError('Erro', data.error ?? 'Falha ao gerar análise')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setAnalisando(false)
    }
  }

  function handleGerarPeca(tipoPeca: string) {
    if (!atendimentoId) return
    router.push(`/${area}/pecas/${tipoPeca}?id=${atendimentoId}`)
  }

  const podeAnalisar = !!atendimentoId && (textoRelato.trim().length > 0 || transcricao.trim().length > 0)

  return (
    <div className="space-y-6">

      {/* 1. Seleção de Cliente */}
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

      {/* 2. Relato do Caso */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5 text-gray-400" />
            Relato do caso
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex rounded-lg border bg-gray-50 p-1">
            <button
              onClick={() => setModoInput('audio')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
                modoInput === 'audio'
                  ? 'bg-white text-primary-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Mic className="h-4 w-4" />
              Gravar áudio
            </button>
            <button
              onClick={() => setModoInput('texto')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
                modoInput === 'texto'
                  ? 'bg-white text-primary-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Keyboard className="h-4 w-4" />
              Digitar
            </button>
          </div>

          {modoInput === 'audio' ? (
            <div className="space-y-4">
              <GravadorAudio
                onTranscricao={handleTranscricao}
                atendimentoId={atendimentoId}
                disabled={!atendimentoId}
              />
              {transcricao && (
                <Textarea
                  label="Transcrição (edite se necessário)"
                  value={textoRelato}
                  onChange={(e) => setTextoRelato(e.target.value)}
                  rows={8}
                />
              )}
            </div>
          ) : (
            <Textarea
              label="Descreva o caso"
              value={textoRelato}
              onChange={(e) => setTextoRelato(e.target.value)}
              placeholder="Descreva os fatos e a situação atual do cliente..."
              hint="Quanto mais detalhes, mais precisa será a análise"
              rows={8}
              disabled={!atendimentoId}
            />
          )}
        </CardContent>
      </Card>

      {/* 3. Pedido / Questão específica */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-gray-400" />
            Questão específica (opcional)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            label="O que você quer que a IA analise especificamente?"
            value={pedidoEspecifico}
            onChange={(e) => setPedidoEspecifico(e.target.value)}
            placeholder="Ex.: Qual a melhor estratégia para reconhecimento de atividade especial?"
            rows={3}
            disabled={!atendimentoId}
          />
        </CardContent>
      </Card>

      {/* 4. Documentos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Keyboard className="h-5 w-5 text-gray-400" />
            Documentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UploadDocumentos
            atendimentoId={atendimentoId}
            tiposDocumento={tiposDocumento}
            disabled={!atendimentoId}
          />
        </CardContent>
      </Card>

      {/* 5. Botão Analisar */}
      <div className="flex justify-end gap-3 pb-4">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => router.push(`/${area}`)}
          disabled={analisando}
        >
          Cancelar
        </Button>
        <Button
          size="lg"
          onClick={analisar}
          disabled={!podeAnalisar || analisando}
          className="gap-2 bg-violet-700 hover:bg-violet-800 min-w-44"
        >
          {analisando ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Analisando... (pode levar 30s)
            </>
          ) : (
            <>
              <Brain className="h-5 w-5" />
              {tituloConsultoria}
            </>
          )}
        </Button>
      </div>

      {/* 6. Relatório da análise */}
      {analise && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">{tituloConsultoria} — Resultado</h2>
          <RelatorioAnalise data={analise as Parameters<typeof RelatorioAnalise>[0]['data']} onGerarPeca={handleGerarPeca} />
        </div>
      )}
    </div>
  )
}
