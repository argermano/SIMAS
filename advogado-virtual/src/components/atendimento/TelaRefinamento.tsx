'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useStreaming } from '@/components/shared/StreamingText'
import { SeletorCliente } from './SeletorCliente'
import { UploadDocumentos } from './UploadDocumentos'
import { MicrofoneInline } from './MicrofoneInline'
import {
  Users, FileText, MessageSquare, Upload, Loader2, Zap,
  Save, Check, RefreshCw, AlertCircle,
} from 'lucide-react'

interface TelaRefinamentoProps {
  area: string
  areaNome: string
  tenantId: string
  userId: string
  roleUsuario: string
  tiposDocumento: string[]
}

export function TelaRefinamento({
  area,
  areaNome,
  tenantId,
  userId,
  roleUsuario,
  tiposDocumento,
}: TelaRefinamentoProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const { text: textoGerado, loading: gerando, error: erroStream, startStream } = useStreaming()

  const [atendimentoId, setAtendimentoId] = useState<string | null>(null)
  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(null)
  const [pecaOriginal, setPecaOriginal] = useState('')
  const [instrucoes, setInstrucoes] = useState('')
  const [mostraModalGeracao, setMostraModalGeracao] = useState(false)
  const [carregandoPeca, setCarregandoPeca] = useState(false)
  const [documentosExistentes, setDocumentosExistentes] = useState<Array<{ id: string; file_name: string; tipo: string; texto_extraido?: string }>>([])
  const inputPecaRef = useRef<HTMLInputElement>(null)

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
            tipo_peca_origem: 'refinamento',
            modo_input: 'texto',
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
  }, [atendimentoId, area, toastError])

  // Upload e leitura de arquivo da peça original
  async function handleUploadPeca(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]

    setCarregandoPeca(true)
    try {
      // Ler como texto (para .txt, .md) ou extrair de .docx/.pdf via API
      if (file.type === 'text/plain' || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
        const text = await file.text()
        setPecaOriginal(text)
        success('Peça carregada', `"${file.name}" foi carregada com sucesso.`)
      } else {
        // Para PDF/DOCX, faz upload e extrai texto via backend
        const formData = new FormData()
        formData.append('file', file)

        const res = await fetch('/api/extrair-texto', {
          method: 'POST',
          body: formData,
        })

        if (res.ok) {
          const data = await res.json()
          if (data.texto) {
            setPecaOriginal(data.texto)
            success('Peça carregada', `Texto extraído de "${file.name}".`)
          } else {
            toastError('Aviso', 'Não foi possível extrair texto do arquivo. Cole o conteúdo manualmente.')
          }
        } else {
          toastError('Erro', 'Falha ao processar o arquivo. Cole o conteúdo manualmente.')
        }
      }
    } catch {
      toastError('Erro', 'Falha ao ler o arquivo. Cole o conteúdo manualmente.')
    } finally {
      setCarregandoPeca(false)
      if (inputPecaRef.current) inputPecaRef.current.value = ''
    }
  }

  // Gerar peça refinada
  async function gerarRefinamento() {
    if (!atendimentoId || !pecaOriginal.trim()) return

    // Salvar transcrição editada (a peça original como referência)
    await fetch(`/api/atendimentos/${atendimentoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcricao_editada: `[REFINAMENTO] Instruções: ${instrucoes || '(nenhuma)'}`,
        pedidos_especificos: instrucoes,
      }),
    })

    setMostraModalGeracao(true)

    const resultado = await startStream('/api/ia/refinamento-peca', {
      atendimentoId,
      area,
      pecaOriginal,
      instrucoes,
    })

    if (!resultado) {
      setMostraModalGeracao(false)
      toastError('Erro', erroStream ?? 'Falha ao refinar a peça. Tente novamente.')
      return
    }

    const { fullText, headers } = resultado
    const pecaId = headers.get('X-Peca-Id')

    if (!pecaId) {
      setMostraModalGeracao(false)
      toastError('Erro', 'Não foi possível identificar a peça gerada.')
      return
    }

    // Salva conteúdo
    await fetch('/api/ia/salvar-peca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pecaId, conteudo: fullText }),
    })

    // Atualiza status do atendimento
    await fetch(`/api/atendimentos/${atendimentoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'peca_gerada' }),
    })

    if (roleUsuario === 'colaborador') {
      success('Peça enviada para revisão!', 'Um advogado ou administrador irá avaliar e aprovar a peça.')
      router.push(`/${area}`)
      return
    }

    router.push(`/${area}/editor/${pecaId}`)
  }

  const podeGerar = !!atendimentoId && pecaOriginal.trim().length > 50

  return (
    <div className="space-y-6">

      {/* Modal de geração com streaming */}
      {mostraModalGeracao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-card shadow-2xl">
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground">Refinando peça com IA</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Isto pode levar até 45 segundos. Não feche a janela.
              </p>
            </div>
            <div className="px-6 py-4">
              <div className="h-52 overflow-y-auto rounded-xl border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
                {textoGerado ? (
                  <>
                    {textoGerado}
                    {gerando && (
                      <span className="inline-block h-3.5 w-0.5 animate-pulse bg-primary/70 ml-0.5 align-middle" />
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 py-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Iniciando refinamento...
                  </div>
                )}
              </div>
            </div>
            <div className="border-t px-6 py-4 text-center">
              <p className="text-xs text-muted-foreground">
                {gerando ? 'Refinando...' : 'Finalizando e salvando...'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 1. Seleção de Cliente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-muted-foreground" />
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

      {/* 2. Upload da Peça Original */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Peça original
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Cole o conteúdo da peça que deseja refinar ou faça upload do arquivo (Word, PDF ou TXT).
          </p>

          <div className="flex gap-2">
            <input
              ref={inputPecaRef}
              type="file"
              accept=".pdf,.txt,.md,.docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
              className="hidden"
              onChange={(e) => handleUploadPeca(e.target.files)}
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => inputPecaRef.current?.click()}
              disabled={carregandoPeca || !atendimentoId}
              className="gap-2"
            >
              {carregandoPeca ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {carregandoPeca ? 'Processando...' : 'Upload da peça'}
            </Button>
            {pecaOriginal && (
              <div className="flex items-center gap-1.5 text-sm text-success">
                <Check className="h-4 w-4" />
                Peça carregada ({pecaOriginal.length.toLocaleString()} caracteres)
              </div>
            )}
          </div>

          <Textarea
            label="Conteúdo da peça"
            value={pecaOriginal}
            onChange={(e) => setPecaOriginal(e.target.value)}
            placeholder="Cole aqui o conteúdo completo da peça que deseja refinar..."
            rows={12}
            disabled={!atendimentoId}
          />

          {pecaOriginal.trim().length > 0 && pecaOriginal.trim().length < 50 && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertCircle className="h-4 w-4" />
              A peça parece muito curta. Cole o conteúdo completo para melhor resultado.
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Documentos do cliente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Documentos do cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Anexe documentos que a IA deve considerar ao refinar a peça (CNIS, laudos, contratos, etc.)
          </p>
          <UploadDocumentos
            atendimentoId={atendimentoId}
            tiposDocumento={tiposDocumento}
            disabled={!atendimentoId}
            documentosIniciais={documentosExistentes}
          />
        </CardContent>
      </Card>

      {/* 4. Instruções de refinamento */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            Instruções para refinamento
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            label="O que deseja melhorar na peça? (opcional)"
            value={instrucoes}
            onChange={(e) => setInstrucoes(e.target.value)}
            placeholder={`Ex.: Melhorar a fundamentação jurídica, adicionar jurisprudência recente, corrigir a qualificação das partes, fortalecer o pedido de tutela de urgência...`}
            hint="Quanto mais detalhado, melhor será o resultado da IA"
            rows={4}
            disabled={!atendimentoId}
          />
          {atendimentoId && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Ou dite:</span>
              <MicrofoneInline
                onTranscricao={(t) => setInstrucoes(prev => prev ? prev + ' ' + t : t)}
                disabled={!atendimentoId}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. Botões de ação */}
      <div className="flex flex-wrap justify-end gap-3 pb-8">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => router.push(`/${area}`)}
          disabled={gerando}
        >
          Cancelar
        </Button>
        <Button
          size="lg"
          onClick={gerarRefinamento}
          disabled={!podeGerar || gerando}
          className="gap-2 bg-primary/80 hover:bg-primary"
        >
          <RefreshCw className="h-5 w-5" />
          Refinar Peça com IA
        </Button>
      </div>

    </div>
  )
}
