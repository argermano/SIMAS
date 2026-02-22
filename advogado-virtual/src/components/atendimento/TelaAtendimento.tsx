'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useStreaming } from '@/components/shared/StreamingText'
import { SeletorCliente } from './SeletorCliente'
import { GravadorAudio } from './GravadorAudio'
import { UploadDocumentos } from './UploadDocumentos'
import { SeletorTribunais } from './SeletorTribunais'
import type { ResultadoJurisprudencia } from '@/lib/jurisprudencia/datajud'
import { Mic, Keyboard, Users, FileText, MessageSquare, Save, Check, Zap, Loader2 } from 'lucide-react'

interface TelaAtendimentoProps {
  area: string
  tipoPeca: string
  tipoPecaNome: string
  tenantId: string
  userId: string
  tiposDocumento: string[]
  atendimentoIdInicial?: string
}

export function TelaAtendimento({
  area,
  tipoPeca,
  tipoPecaNome,
  tenantId,
  userId,
  tiposDocumento,
  atendimentoIdInicial,
}: TelaAtendimentoProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const { text: textoGerado, loading: gerando, error: erroStream, startStream } = useStreaming()

  // Estado do atendimento
  const [atendimentoId, setAtendimentoId]     = useState<string | null>(atendimentoIdInicial ?? null)
  const [cliente, setCliente]                   = useState<{ id: string; nome: string } | null>(null)
  const [modoInput, setModoInput]               = useState<'audio' | 'texto'>('audio')
  const [textoRelato, setTextoRelato]           = useState('')
  const [transcricao, setTranscricao]           = useState('')
  const [pedidoEspecifico, setPedidoEspecifico] = useState('')
  const [salvando, setSalvando]                 = useState(false)
  const [salvo, setSalvo]                       = useState(false)
  const [carregando, setCarregando]             = useState(!!atendimentoIdInicial)
  const [mostraModalGeracao, setMostraModalGeracao] = useState(false)
  const [jurisprudencia, setJurisprudencia] = useState<ResultadoJurisprudencia[]>([])
  const [tribunaisSelecionados, setTribunaisSelecionados] = useState<string[]>([])

  // Carregar atendimento existente
  useEffect(() => {
    if (!atendimentoIdInicial) return

    async function carregar() {
      try {
        const res = await fetch(`/api/atendimentos/${atendimentoIdInicial}`)
        if (!res.ok) return
        const data = await res.json()
        const at = data.atendimento
        if (!at) return
        if (at.cliente_id && at.clientes) {
          setCliente({ id: at.cliente_id, nome: at.clientes.nome ?? 'Cliente' })
        }
        setModoInput(at.modo_input ?? 'audio')
        setTextoRelato(at.transcricao_editada ?? at.transcricao_raw ?? '')
        setTranscricao(at.transcricao_editada ?? at.transcricao_raw ?? '')
        setPedidoEspecifico(at.pedidos_especificos ?? '')
      } catch {
        toastError('Erro', 'Não foi possível carregar o atendimento')
      } finally {
        setCarregando(false)
      }
    }
    carregar()
  }, [atendimentoIdInicial, toastError])

  // Criar atendimento ao selecionar cliente
  const handleClienteSelecionado = useCallback(async (c: { id: string; nome: string } | null) => {
    if (!c) {
      setCliente(null)
      setAtendimentoId(null)
      return
    }

    setCliente(c)

    // Cria atendimento se ainda não existe
    if (!atendimentoId) {
      try {
        const res = await fetch('/api/atendimentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cliente_id: c.id,
            area,
            tipo_peca_origem: tipoPeca,
            modo_input: modoInput,
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
  }, [atendimentoId, area, tipoPeca, modoInput, toastError])

  // Receber transcrição do gravador
  const handleTranscricao = useCallback((texto: string) => {
    setTranscricao(texto)
    setTextoRelato(texto)
    success('Áudio transcrito', 'Revise o texto abaixo e edite se necessário.')
  }, [success])

  // Salvar atendimento
  async function salvar() {
    if (!atendimentoId) return

    setSalvando(true)
    try {
      const textoFinal = modoInput === 'audio' ? textoRelato : textoRelato

      const res = await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcricao_editada: textoFinal,
          pedidos_especificos: pedidoEspecifico,
          modo_input: modoInput,
        }),
      })

      if (res.ok) {
        setSalvo(true)
        success('Atendimento salvo!', 'O caso foi registrado com sucesso.')
        setTimeout(() => router.push(`/${area}`), 1500)
      } else {
        const data = await res.json()
        toastError('Erro ao salvar', data.error ?? 'Tente novamente')
      }
    } catch {
      toastError('Erro', 'Falha de rede ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  // Gerar peça com IA (salva + stream + redireciona para editor)
  async function gerarPeca() {
    if (!atendimentoId) return

    setSalvando(true)
    try {
      // 1. Salva o atendimento atualizado
      await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcricao_editada: textoRelato,
          pedidos_especificos: pedidoEspecifico,
          modo_input: modoInput,
        }),
      })
    } finally {
      setSalvando(false)
    }

    // 2. Abre o modal de geração e inicia streaming
    setMostraModalGeracao(true)

    const resultado = await startStream('/api/ia/gerar-peca', {
      atendimentoId,
      tipo: tipoPeca,
      area,
      jurisprudencia,
      tribunais: tribunaisSelecionados,
    })

    if (!resultado) {
      setMostraModalGeracao(false)
      toastError('Erro', erroStream ?? 'Falha ao gerar a peça. Tente novamente.')
      return
    }

    const { fullText, headers } = resultado
    const pecaId = headers.get('X-Peca-Id')

    if (!pecaId) {
      setMostraModalGeracao(false)
      toastError('Erro', 'Não foi possível identificar a peça gerada.')
      return
    }

    // 3. Salva o conteúdo gerado no banco
    await fetch('/api/ia/salvar-peca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pecaId, conteudo: fullText }),
    })

    // 4. Redireciona para o editor da peça
    router.push(`/${area}/editor/${pecaId}`)
  }

  const podeGravar = !!atendimentoId
  const podeSalvar = !!atendimentoId && (textoRelato.trim().length > 0 || transcricao.trim().length > 0)

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-800" />
          <p className="text-sm text-gray-500">Carregando atendimento...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Modal de geração com streaming */}
      {mostraModalGeracao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Gerando {tipoPecaNome} com IA</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Isto pode levar até 45 segundos. Não feche a janela.
              </p>
            </div>
            <div className="px-6 py-4">
              <div className="h-52 overflow-y-auto rounded-xl border bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700">
                {textoGerado ? (
                  <>
                    {textoGerado}
                    {gerando && (
                      <span className="inline-block h-3.5 w-0.5 animate-pulse bg-primary-600 ml-0.5 align-middle" />
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 py-4 text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Iniciando geração...
                  </div>
                )}
              </div>
            </div>
            <div className="border-t px-6 py-4 text-center">
              <p className="text-xs text-gray-400">
                {gerando ? 'Gerando...' : 'Finalizando e salvando...'}
              </p>
            </div>
          </div>
        </div>
      )}

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
          {/* Tabs Gravar / Digitar */}
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

          {/* Conteúdo da tab */}
          {modoInput === 'audio' ? (
            <div className="space-y-4">
              <GravadorAudio
                onTranscricao={handleTranscricao}
                atendimentoId={atendimentoId}
                disabled={!podeGravar}
              />

              {/* Transcrição editável */}
              {transcricao && (
                <Textarea
                  label="Transcrição (edite se necessário)"
                  value={textoRelato}
                  onChange={(e) => setTextoRelato(e.target.value)}
                  placeholder="A transcrição aparecerá aqui..."
                  rows={8}
                />
              )}
            </div>
          ) : (
            <Textarea
              label="Descreva o caso"
              value={textoRelato}
              onChange={(e) => setTextoRelato(e.target.value)}
              placeholder="Descreva os fatos, o histórico e a situação atual do cliente..."
              hint="Quanto mais detalhado, melhor será a peça gerada pela IA"
              rows={8}
              disabled={!podeGravar}
            />
          )}
        </CardContent>
      </Card>

      {/* 3. Pedido Específico */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-gray-400" />
            Pedido específico
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            label="O que o cliente deseja? (opcional)"
            value={pedidoEspecifico}
            onChange={(e) => setPedidoEspecifico(e.target.value)}
            placeholder={`Ex.: ${tipoPecaNome} para aposentadoria por tempo de contribuição com reconhecimento de atividade especial`}
            hint="Detalhe o pedido principal — isso ajudará a IA a gerar uma peça mais precisa"
            rows={3}
            disabled={!podeGravar}
          />
        </CardContent>
      </Card>

      {/* 4. Documentos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-gray-400" />
            Documentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UploadDocumentos
            atendimentoId={atendimentoId}
            tiposDocumento={tiposDocumento}
            disabled={!podeGravar}
          />
        </CardContent>
      </Card>

      {/* 5. Jurisprudência */}
      <SeletorTribunais
        area={area}
        disabled={!podeGravar}
        onResultados={setJurisprudencia}
        onTribunaisChange={setTribunaisSelecionados}
      />

      {/* 6. Botões de ação */}
      <div className="flex flex-wrap justify-end gap-3 pb-8">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => router.push(`/${area}`)}
          disabled={salvando || gerando}
        >
          Cancelar
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={salvar}
          disabled={!podeSalvar || salvando || salvo || gerando}
          loading={salvando}
          className="gap-2"
        >
          {salvo ? (
            <>
              <Check className="h-5 w-5" />
              Salvo!
            </>
          ) : (
            <>
              <Save className="h-5 w-5" />
              Salvar
            </>
          )}
        </Button>
        <Button
          size="lg"
          onClick={gerarPeca}
          disabled={!podeSalvar || salvando || gerando}
          className="gap-2 bg-violet-700 hover:bg-violet-800"
        >
          <Zap className="h-5 w-5" />
          Gerar Peça IA
        </Button>
      </div>

    </div>
  )
}
