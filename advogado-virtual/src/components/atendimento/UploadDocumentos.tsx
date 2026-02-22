'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Upload, FileText, X, Loader2, Check } from 'lucide-react'

interface Documento {
  id: string
  file_name: string
  tipo: string
  texto_extraido?: string
}

interface UploadDocumentosProps {
  atendimentoId: string | null
  tiposDocumento: readonly string[]
  onDocumentoAdicionado?: (doc: Documento) => void
  disabled?: boolean
}

const LABELS_TIPO: Record<string, string> = {
  cnis: 'CNIS',
  indeferimento: 'Indeferimento',
  cessacao: 'Cessação',
  carta_concessao: 'Concessão',
  laudo_medico: 'Laudo Médico',
  ppp: 'PPP',
  ctps: 'CTPS',
  procuracao: 'Procuração',
  rg_cpf: 'RG/CPF',
  comprovante_residencia: 'Comprovante Res.',
  trct: 'TRCT',
  holerites: 'Holerites',
  contrato_trabalho: 'Contrato Trabalho',
  acordo_coletivo: 'Acordo Coletivo',
  sentenca: 'Sentença',
  acordao: 'Acórdão',
  ata_audiencia: 'Ata de Audiência',
  outro: 'Outro',
}

export function UploadDocumentos({
  atendimentoId,
  tiposDocumento,
  onDocumentoAdicionado,
  disabled,
}: UploadDocumentosProps) {
  const [documentos, setDocumentos]   = useState<Documento[]>([])
  const [enviando, setEnviando]       = useState(false)
  const [erro, setErro]               = useState('')
  const [tipoAtual, setTipoAtual]     = useState(tiposDocumento[0] ?? 'outro')
  const inputRef                       = useRef<HTMLInputElement>(null)

  const desabilitado = disabled || !atendimentoId

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || !atendimentoId) return

    setErro('')
    setEnviando(true)

    for (const arquivo of Array.from(files)) {
      try {
        const formData = new FormData()
        formData.append('arquivo', arquivo)
        formData.append('tipo', tipoAtual)

        const res = await fetch(`/api/atendimentos/${atendimentoId}/documentos`, {
          method: 'POST',
          body: formData,
        })

        const data = await res.json()

        if (!res.ok) {
          setErro(data.error ?? 'Erro ao enviar documento')
        } else if (data.documento) {
          const novoDoc: Documento = data.documento
          setDocumentos(prev => [...prev, novoDoc])
          onDocumentoAdicionado?.(novoDoc)
        }
      } catch {
        setErro('Erro de rede ao enviar documento')
      }
    }

    setEnviando(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function removerDoc(id: string) {
    setDocumentos(prev => prev.filter(d => d.id !== id))
  }

  return (
    <div className="space-y-4">
      {/* Seletor de tipo + Upload */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Tipo do documento
          </label>
          <select
            value={tipoAtual}
            onChange={(e) => setTipoAtual(e.target.value)}
            disabled={desabilitado}
            className="h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-800/20"
          >
            {tiposDocumento.map(tipo => (
              <option key={tipo} value={tipo}>
                {LABELS_TIPO[tipo] ?? tipo}
              </option>
            ))}
          </select>
        </div>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
            disabled={desabilitado || enviando}
          />
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={desabilitado || enviando}
            variant="secondary"
            size="md"
            className="gap-2"
          >
            {enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {enviando ? 'Enviando...' : 'Enviar arquivo'}
          </Button>
        </div>
      </div>

      {/* Drop zone visual */}
      {!desabilitado && (
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleUpload(e.dataTransfer.files) }}
          className="flex items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center transition-colors hover:border-primary-300 hover:bg-primary-50"
        >
          <div>
            <Upload className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            <p className="text-sm text-gray-500">
              Arraste arquivos aqui ou clique em &ldquo;Enviar arquivo&rdquo;
            </p>
            <p className="mt-1 text-xs text-gray-400">PDF, DOCX, JPG, PNG — máx. 10 MB</p>
          </div>
        </div>
      )}

      {/* Lista de documentos enviados */}
      {documentos.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            Documentos enviados ({documentos.length})
          </p>
          {documentos.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 rounded-lg border bg-white px-4 py-3"
            >
              <FileText className="h-5 w-5 shrink-0 text-primary-800" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{doc.file_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-xs">
                    {LABELS_TIPO[doc.tipo] ?? doc.tipo}
                  </Badge>
                  {doc.texto_extraido && (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <Check className="h-3 w-3" /> Texto extraído
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => removerDoc(doc.id)}
                className="rounded p-1 text-gray-400 hover:text-red-600"
                title="Remover"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Erro */}
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </div>
  )
}
