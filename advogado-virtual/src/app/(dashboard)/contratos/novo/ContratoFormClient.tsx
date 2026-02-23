'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { SeletorCliente } from '@/components/atendimento/SeletorCliente'
import {
  Users, DollarSign, Brain, Loader2, Upload, X, FileText, ChevronRight,
} from 'lucide-react'

const OPCOES_AREA = [
  { value: 'previdenciario', label: 'Previdenciário' },
  { value: 'trabalhista',    label: 'Trabalhista'    },
  { value: 'civel',          label: 'Cível'          },
  { value: 'criminal',       label: 'Criminal'       },
  { value: 'tributario',     label: 'Tributário'     },
  { value: 'empresarial',    label: 'Empresarial'    },
  { value: 'familia',        label: 'Família'        },
  { value: 'consumidor',     label: 'Consumidor'     },
  { value: 'imobiliario',    label: 'Imobiliário'    },
  { value: 'administrativo', label: 'Administrativo' },
]

const OPCOES_FORMA_PAGAMENTO = [
  { value: 'À vista',           label: 'À vista'           },
  { value: 'Mensal',            label: 'Mensal'            },
  { value: 'Na condenação',     label: 'Na condenação'     },
  { value: 'Entrada + parcelas', label: 'Entrada + parcelas' },
  { value: 'Êxito',             label: 'Somente êxito'     },
]

interface ContratoFormClientProps {
  role: string
}

export function ContratoFormClient({ role: _role }: ContratoFormClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [cliente,          setCliente]          = useState<{ id: string; nome: string } | null>(null)
  const [area,             setArea]             = useState('')
  const [valorFixo,        setValorFixo]        = useState('')
  const [percentualExito,  setPercentualExito]  = useState('')
  const [formaPagamento,   setFormaPagamento]   = useState('')
  const [instrucoes,       setInstrucoes]       = useState('')
  const [modeloFile,       setModeloFile]       = useState<File | null>(null)
  const [modeloTexto,      setModeloTexto]      = useState('')
  const [uploadandoModelo, setUploadandoModelo] = useState(false)
  const [gerando,          setGerando]          = useState(false)
  const [conteudoGerado,   setConteudoGerado]   = useState('')
  const [contratoId,       setContratoId]       = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleModeloUpload = useCallback(async (file: File) => {
    setUploadandoModelo(true)
    setModeloFile(file)
    try {
      const formData = new FormData()
      formData.append('modelo', file)
      const res  = await fetch('/api/contratos/upload-modelo', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        setModeloTexto(data.texto_extraido ?? '')
        success('Modelo carregado', 'O estilo do seu modelo será aplicado ao contrato')
      } else {
        toastError('Erro no upload', data.error ?? 'Tente novamente')
        setModeloFile(null)
      }
    } catch {
      toastError('Erro', 'Falha ao enviar o modelo')
      setModeloFile(null)
    } finally {
      setUploadandoModelo(false)
    }
  }, [success, toastError])

  const criarEGerar = useCallback(async () => {
    if (!cliente) {
      toastError('Atenção', 'Selecione um cliente')
      return
    }

    setGerando(true)
    setConteudoGerado('')

    try {
      // 1. Criar contrato
      const resContrato = await fetch('/api/contratos', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          cliente_id:       cliente.id,
          area:             area || null,
          valor_fixo:       valorFixo ? parseFloat(valorFixo) : null,
          percentual_exito: percentualExito ? parseFloat(percentualExito) : null,
          forma_pagamento:  formaPagamento || null,
        }),
      })
      const dataContrato = await resContrato.json()
      if (!resContrato.ok) {
        toastError('Erro', dataContrato.error ?? 'Não foi possível criar o contrato')
        return
      }
      const id = dataContrato.contrato.id
      setContratoId(id)

      // 2. Gerar com IA (streaming)
      const resIA = await fetch('/api/ia/gerar-contrato', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contratoId: id,
          instrucoes: instrucoes || undefined,
          modeloTexto: modeloTexto || undefined,
        }),
      })

      if (!resIA.ok || !resIA.body) {
        toastError('Erro na IA', 'Não foi possível gerar o contrato')
        return
      }

      // Stream do conteúdo
      const reader  = resIA.body.getReader()
      const decoder = new TextDecoder()
      let conteudo  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6)
            if (dataStr === '[DONE]') continue
            try {
              const parsed = JSON.parse(dataStr)
              if (parsed.delta) {
                conteudo += parsed.delta
                setConteudoGerado(conteudo)
              }
            } catch {
              // linha incompleta
            }
          }
        }
      }

      if (conteudo) {
        // 3. Salvar conteúdo no contrato
        await fetch(`/api/contratos/${id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ conteudo_markdown: conteudo }),
        })
        success('Contrato gerado!', 'Revise e ajuste antes de enviar para aprovação')
        router.push(`/contratos/${id}`)
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setGerando(false)
    }
  }, [cliente, area, valorFixo, percentualExito, formaPagamento, instrucoes, modeloTexto, success, toastError, router])

  return (
    <div className="space-y-6">

      {/* Cliente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-gray-400" />
            Cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SeletorCliente
            onSelecionado={setCliente}
            clienteSelecionado={cliente}
          />
        </CardContent>
      </Card>

      {/* Dados do contrato */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="h-5 w-5 text-gray-400" />
            Dados do contrato
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            label="Área jurídica"
            value={area}
            onChange={e => setArea(e.target.value)}
            options={OPCOES_AREA}
            placeholder="Selecione a área..."
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Honorários fixos (R$)"
              type="number"
              value={valorFixo}
              onChange={e => setValorFixo(e.target.value)}
              placeholder="Ex.: 3000"
              hint="Deixe em branco se for somente êxito"
            />
            <Input
              label="% sobre o êxito"
              type="number"
              value={percentualExito}
              onChange={e => setPercentualExito(e.target.value)}
              placeholder="Ex.: 20"
              hint="Percentual sobre o valor obtido"
            />
          </div>
          <Select
            label="Forma de pagamento"
            value={formaPagamento}
            onChange={e => setFormaPagamento(e.target.value)}
            options={OPCOES_FORMA_PAGAMENTO}
            placeholder="Selecione..."
          />
        </CardContent>
      </Card>

      {/* Modelo do advogado */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-gray-400" />
            Seu modelo de contrato
            <span className="ml-1 text-xs font-normal text-gray-400">(opcional)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!modeloFile ? (
            <div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-sm text-gray-500 transition-colors hover:border-primary-300 hover:text-primary-700"
              >
                <Upload className="h-5 w-5" />
                Clique para enviar seu modelo (PDF ou DOCX)
              </button>
              <p className="mt-2 text-xs text-gray-400">
                A IA replicará o estilo e estrutura do seu modelo ao gerar o contrato
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleModeloUpload(file)
                }}
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <FileText className="h-5 w-5 text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-green-800 truncate">{modeloFile.name}</p>
                <p className="text-xs text-green-600">
                  {uploadandoModelo ? 'Extraindo texto...' : 'Modelo carregado — estilo será aplicado'}
                </p>
              </div>
              <button
                onClick={() => { setModeloFile(null); setModeloTexto('') }}
                className="text-green-600 hover:text-green-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instruções adicionais */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-gray-400" />
            Instruções para a IA
            <span className="ml-1 text-xs font-normal text-gray-400">(opcional)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            label="Instruções específicas"
            value={instrucoes}
            onChange={e => setInstrucoes(e.target.value)}
            placeholder="Ex.: Incluir cláusula de mediação obrigatória. Prazo de vigência de 2 anos. Foro de São Paulo."
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Preview do contrato gerado */}
      {conteudoGerado && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Contrato gerado (prévia)</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed max-h-96 overflow-y-auto">
              {conteudoGerado}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Botão gerar */}
      <div className="flex justify-end gap-3">
        {contratoId && !gerando && (
          <Button
            variant="secondary"
            onClick={() => router.push(`/contratos/${contratoId}`)}
            className="gap-2"
          >
            Abrir editor
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
        <Button
          size="lg"
          onClick={criarEGerar}
          disabled={!cliente || gerando || uploadandoModelo}
          className="gap-2 min-w-48"
        >
          {gerando ? (
            <><Loader2 className="h-5 w-5 animate-spin" /> Gerando contrato...</>
          ) : (
            <><Brain className="h-5 w-5" /> Gerar com IA</>
          )}
        </Button>
      </div>
    </div>
  )
}
