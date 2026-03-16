'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Upload, FileText, X, Loader2, Check, Circle, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface Documento {
  id: string
  file_name: string
  tipo: string
  texto_extraido?: string
}

interface ArquivoProgresso {
  nome: string
  status: 'aguardando' | 'enviando' | 'concluido' | 'erro'
  erro?: string
}

interface UploadDocumentosProps {
  atendimentoId: string | null
  tiposDocumento: readonly string[]
  onDocumentoAdicionado?: (doc: Documento) => void
  disabled?: boolean
  /** Documentos já existentes para exibir na lista */
  documentosIniciais?: Documento[]
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

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
  extrato_fgts: 'Extrato de FGTS',
  sentenca: 'Sentença',
  acordao: 'Acórdão',
  ata_audiencia: 'Ata de Audiência',
  // Família/Sucessões
  certidao_casamento: 'Certidão de Casamento',
  certidao_nascimento: 'Certidão de Nascimento',
  certidao_obito: 'Certidão de Óbito',
  pacto_antenupcial: 'Pacto Antenupcial',
  escritura_uniao_estavel: 'Escritura de União Estável',
  comprovante_renda: 'Comprovante de Renda',
  declaracao_ir: 'Declaração de IR',
  escritura_imovel: 'Escritura de Imóvel',
  extrato_bancario: 'Extrato Bancário',
  // Direito Médico
  prontuario_medico: 'Prontuário Médico',
  exame: 'Exame',
  receita_medica: 'Receita Médica',
  nota_fiscal_medica: 'Nota Fiscal Médica',
  contrato_plano_saude: 'Contrato Plano de Saúde',
  negativa_plano: 'Negativa do Plano',
  termo_consentimento: 'Termo de Consentimento',
  atestado_obito: 'Atestado de Óbito',
  outro: 'Outro',
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UploadDocumentos({
  atendimentoId,
  tiposDocumento,
  onDocumentoAdicionado,
  disabled,
  documentosIniciais,
}: UploadDocumentosProps) {
  const [documentos, setDocumentos]   = useState<Documento[]>([])
  const [enviando, setEnviando]       = useState(false)
  const [erro, setErro]               = useState('')
  const [tipoAtual, setTipoAtual]     = useState(tiposDocumento[0] ?? 'outro')
  const [progresso, setProgresso]     = useState<ArquivoProgresso[]>([])
  const inputRef                       = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (documentosIniciais && documentosIniciais.length > 0) {
      setDocumentos(prev => {
        const idsExistentes = new Set(prev.map(d => d.id))
        const novos = documentosIniciais.filter(d => !idsExistentes.has(d.id))
        return novos.length > 0 ? [...prev, ...novos] : prev
      })
    }
  }, [documentosIniciais])

  const desabilitado = disabled || !atendimentoId

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || !atendimentoId) return

    setErro('')
    setEnviando(true)

    const arquivos = Array.from(files)

    // Validação de tamanho antes do upload
    for (const arquivo of arquivos) {
      if (arquivo.size > MAX_FILE_SIZE) {
        setErro(`O arquivo "${arquivo.name}" (${formatFileSize(arquivo.size)}) excede o limite de 50 MB`)
        setEnviando(false)
        if (inputRef.current) inputRef.current.value = ''
        return
      }
    }

    setProgresso(arquivos.map(f => ({ nome: f.name, status: 'aguardando' })))

    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i]

      setProgresso(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'enviando' } : p))

      try {
        // 1. Solicita signed URL para upload direto ao Supabase Storage
        const res = await fetch(`/api/atendimentos/${atendimentoId}/documentos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: arquivo.name,
            fileType: arquivo.type,
            fileSize: arquivo.size,
            tipo: tipoAtual,
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          const msg = data.error ?? `Erro ao preparar upload de "${arquivo.name}"`
          setProgresso(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'erro', erro: msg } : p))
          setErro(msg)
          continue
        }

        // 2. Upload direto ao Supabase Storage via signed URL (contorna limite de 4.5MB do Vercel)
        const supabase = createClient()
        const { error: uploadError } = await supabase.storage
          .from('documentos')
          .uploadToSignedUrl(data.storagePath, data.uploadToken, arquivo, {
            contentType: arquivo.type || 'application/octet-stream',
          })

        if (uploadError) {
          const msg = `Erro ao enviar "${arquivo.name}": ${uploadError.message}`
          setProgresso(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'erro', erro: msg } : p))
          setErro(msg)
          continue
        }

        // 3. Extração de texto em background (não bloqueia o upload)
        fetch(`/api/atendimentos/${atendimentoId}/documentos`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentoId: data.documento.id,
            storagePath: data.storagePath,
            fileType: arquivo.type,
          }),
        }).then(async (extractRes) => {
          if (extractRes.ok) {
            const extractData = await extractRes.json()
            if (extractData.documento?.texto_extraido) {
              setDocumentos(prev => prev.map(d =>
                d.id === data.documento.id
                  ? { ...d, texto_extraido: extractData.documento.texto_extraido }
                  : d
              ))
            }
          }
        }).catch(() => { /* extração falhou silenciosamente */ })

        const novoDoc: Documento = data.documento
        setDocumentos(prev => [...prev, novoDoc])
        onDocumentoAdicionado?.(novoDoc)
        setProgresso(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'concluido' } : p))

      } catch {
        const msg = `Erro de rede ao enviar "${arquivo.name}"`
        setProgresso(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'erro', erro: msg } : p))
        setErro(msg)
      }
    }

    setEnviando(false)
    if (inputRef.current) inputRef.current.value = ''

    setTimeout(() => setProgresso([]), 2000)
  }

  function removerDoc(id: string) {
    setDocumentos(prev => prev.filter(d => d.id !== id))
  }

  return (
    <div className="space-y-4">
      {/* Seletor de tipo + Upload */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Tipo do documento
          </label>
          <select
            value={tipoAtual}
            onChange={(e) => setTipoAtual(e.target.value)}
            disabled={desabilitado}
            className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
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
          className="flex items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/50 px-6 py-8 text-center transition-colors hover:border-primary/30 hover:bg-primary/10"
        >
          <div>
            <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Arraste arquivos aqui ou clique em &ldquo;Enviar arquivo&rdquo;
            </p>
            <p className="mt-1 text-xs text-muted-foreground">PDF, DOCX, JPG, PNG — máx. 50 MB</p>
          </div>
        </div>
      )}

      {/* Progresso de upload */}
      {progresso.length > 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">
              Processando documentos...
            </p>
          </div>

          <div className="space-y-1.5">
            {progresso.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2.5">
                {item.status === 'aguardando' && (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                {item.status === 'enviando' && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                )}
                {item.status === 'concluido' && (
                  <Check className="h-4 w-4 shrink-0 text-success" />
                )}
                {item.status === 'erro' && (
                  <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                )}
                <span className={`text-sm truncate ${
                  item.status === 'concluido' ? 'text-success' :
                  item.status === 'erro' ? 'text-destructive' :
                  item.status === 'enviando' ? 'text-foreground font-medium' :
                  'text-muted-foreground'
                }`}>
                  {item.nome}
                </span>
                <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                  {item.status === 'aguardando' && 'Aguardando'}
                  {item.status === 'enviando' && 'Enviando...'}
                  {item.status === 'concluido' && 'Concluído'}
                  {item.status === 'erro' && (item.erro ?? 'Erro')}
                </span>
              </div>
            ))}
          </div>

          {/* Barra de progresso */}
          {(() => {
            const concluidos = progresso.filter(p => p.status === 'concluido' || p.status === 'erro').length
            const total = progresso.length
            const pct = total > 0 ? (concluidos / total) * 100 : 0
            return (
              <div className="space-y-1">
                <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-right">
                  {concluidos} de {total} documento{total > 1 ? 's' : ''}
                </p>
              </div>
            )
          })()}
        </div>
      )}

      {/* Lista de documentos enviados */}
      {documentos.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            Documentos enviados ({documentos.length})
          </p>
          {documentos.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <FileText className="h-5 w-5 shrink-0 text-primary" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{doc.file_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-xs">
                    {LABELS_TIPO[doc.tipo] ?? doc.tipo}
                  </Badge>
                  {doc.texto_extraido && (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <Check className="h-3 w-3" /> Texto extraído
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => removerDoc(doc.id)}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                title="Remover"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Erro */}
      {erro && <p className="text-sm text-destructive">{erro}</p>}
    </div>
  )
}
