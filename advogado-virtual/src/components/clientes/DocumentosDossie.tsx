'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  Paperclip, Upload, Loader2, FileText, Image as ImageIcon,
  FileSpreadsheet, File as FileIcon, Download, ExternalLink, Trash2, Link2,
  Unlink, Scale, Briefcase,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { createClient } from '@/lib/supabase/client'
import { formatarBytes } from '@/lib/documentos/tamanho'
import { formatarDataRelativa } from '@/lib/utils'
import { rotularArea, formatarCnj } from '@/lib/tarefas/vinculo'

// Aba "Documentos" do dossiê (coluna direita): anexa arquivos DIRETO ao cliente e
// lista todos os docs dele (diretos + herdados de atendimentos). O dono pediu para
// distinguir docs GERAIS de docs ESPECÍFICOS (de um caso e/ou processo): por isso
// os docs vêm agrupados em "Gerais" e "Vinculados", com badge do caso/processo, e
// dá para Vincular (doc geral) ou Desvincular (doc vinculado) sem sair do dossiê.

interface DocumentoDossie {
  id: string
  file_name: string
  tipo: string
  mime_type: string | null
  tamanho_bytes: number | null
  created_at: string
  atendimento_id: string | null
  atendimento_titulo: string | null
  processo_id: string | null
  processo_numero_cnj: string | null
  processo_apelido: string | null
  url: string | null
}

interface ProgressoItem {
  nome: string
  status: 'enviando' | 'concluido' | 'erro'
  erro?: string
}

// Alvos de vínculo do cliente (carregados sob demanda no picker).
interface CasoOpc { id: string; titulo: string | null; label: string }
interface ProcOpc { id: string; numero_cnj: string | null; apelido: string | null; label: string }

const TETO_BYTES = 25 * 1024 * 1024 // alinhado ao LIMITE_ANEXO_SERVIDOR_BYTES da API

function IconeDoc({ mime }: { mime: string | null }) {
  const cls = 'h-5 w-5 shrink-0'
  if (mime?.startsWith('image/')) return <ImageIcon className={`${cls} text-blue-500`} />
  if (mime === 'application/pdf') return <FileText className={`${cls} text-rose-500`} />
  if (mime?.includes('spreadsheet') || mime?.includes('excel'))
    return <FileSpreadsheet className={`${cls} text-emerald-500`} />
  if (mime?.includes('word')) return <FileText className={`${cls} text-blue-600`} />
  return <FileIcon className={`${cls} text-muted-foreground`} />
}

const temVinculo = (d: DocumentoDossie) => !!d.atendimento_id || !!d.processo_id

export function DocumentosDossie({ clienteId }: { clienteId: string }) {
  const { success, error: toastError } = useToast()
  const [documentos, setDocumentos] = useState<DocumentoDossie[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando]     = useState(false)
  const [progresso, setProgresso]   = useState<ProgressoItem[]>([])
  const [excluindo, setExcluindo]   = useState<string | null>(null)
  const [desvinculando, setDesvinculando] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Picker "Vincular a…" (caso ou processo deste cliente).
  const [vinculando, setVinculando]     = useState<DocumentoDossie | null>(null)
  const [alvos, setAlvos]               = useState<{ casos: CasoOpc[]; processos: ProcOpc[] } | null>(null)
  const [carregandoAlvos, setCarregandoAlvos] = useState(false)
  const [salvandoVinculo, setSalvandoVinculo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/clientes/${clienteId}/documentos`)
      const d = await r.json()
      if (r.ok) setDocumentos(d.documentos ?? [])
    } catch {
      // silencioso — a lista fica vazia; o upload ainda funciona
    } finally {
      setCarregando(false)
    }
  }, [clienteId])

  useEffect(() => { carregar() }, [carregar])

  async function enviarArquivos(files: FileList | null) {
    if (!files || files.length === 0) return
    const arquivos = Array.from(files)
    setEnviando(true)
    setProgresso(arquivos.map((f) => ({ nome: f.name, status: 'enviando' as const })))
    let erros = 0

    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i]
      const marcar = (p: Partial<ProgressoItem>) =>
        setProgresso((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...p } : it)))
      const falhar = (erro: string) => { erros++; marcar({ status: 'erro', erro }) }
      try {
        if (arquivo.size > TETO_BYTES) {
          falhar('excede 25 MB')
          continue
        }
        // 1) pede a signed upload URL
        const prep = await fetch(`/api/clientes/${clienteId}/documentos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: arquivo.name, fileType: arquivo.type, fileSize: arquivo.size }),
        })
        const prepData = await prep.json()
        if (!prep.ok) {
          falhar(prepData.error ?? 'falhou')
          continue
        }
        // 2) sobe direto ao Storage
        const supabase = createClient()
        const { error: upErr } = await supabase.storage
          .from('documentos')
          .uploadToSignedUrl(prepData.storagePath, prepData.uploadToken, arquivo, {
            contentType: arquivo.type || 'application/octet-stream',
          })
        if (upErr) {
          falhar('falha no envio')
          continue
        }
        // 3) confirma (a API confere o tamanho real e cria a linha)
        const conf = await fetch(`/api/clientes/${clienteId}/documentos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storagePath: prepData.storagePath,
            fileName: arquivo.name,
            fileType: arquivo.type,
          }),
        })
        const confData = await conf.json()
        if (!conf.ok) {
          falhar(confData.error ?? 'falhou')
          continue
        }
        marcar({ status: 'concluido' })
      } catch {
        falhar('erro de rede')
      }
    }

    setEnviando(false)
    if (inputRef.current) inputRef.current.value = ''
    await carregar()
    if (erros === 0) success('Documentos anexados', 'Já disponíveis no dossiê e nos anexos.')
    else toastError('Alguns arquivos falharam', `${erros} de ${arquivos.length} não foram enviados.`)
    setTimeout(() => setProgresso([]), 2500)
  }

  async function excluir(doc: DocumentoDossie) {
    if (!confirm(`Excluir "${doc.file_name}"? Esta ação não pode ser desfeita.`)) return
    setExcluindo(doc.id)
    try {
      const r = await fetch(`/api/clientes/${clienteId}/documentos/${doc.id}`, { method: 'DELETE' })
      if (r.ok) {
        setDocumentos((prev) => prev.filter((d) => d.id !== doc.id))
        success('Documento excluído')
      } else {
        const d = await r.json().catch(() => ({}))
        toastError('Não excluído', d.error ?? 'Tente novamente.')
      }
    } catch {
      toastError('Não excluído', 'Falha de rede. Tente novamente.')
    } finally {
      setExcluindo(null)
    }
  }

  async function desvincular(doc: DocumentoDossie) {
    if (!confirm('Desvincular este documento? Ele volta a ser um documento geral do cliente (não é excluído).')) return
    setDesvinculando(doc.id)
    try {
      const r = await fetch(`/api/documentos/${doc.id}/vinculo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desvincular: true }),
      })
      if (r.ok) {
        setDocumentos((prev) => prev.map((d) => d.id === doc.id
          ? { ...d, atendimento_id: null, atendimento_titulo: null, processo_id: null, processo_numero_cnj: null, processo_apelido: null }
          : d))
        success('Documento desvinculado', 'Voltou para os documentos gerais.')
      } else {
        const d = await r.json().catch(() => ({}))
        toastError('Não desvinculado', d.error ?? 'Tente novamente.')
      }
    } catch {
      toastError('Não desvinculado', 'Falha de rede. Tente novamente.')
    } finally {
      setDesvinculando(null)
    }
  }

  // Abre o picker e carrega (uma vez) os casos e processos do cliente.
  async function abrirVincular(doc: DocumentoDossie) {
    setVinculando(doc)
    if (alvos || carregandoAlvos) return
    setCarregandoAlvos(true)
    try {
      const [rc, rp] = await Promise.all([
        fetch(`/api/atendimentos?cliente_id=${clienteId}`),
        fetch(`/api/clientes/${clienteId}/processos`),
      ])
      const dc = await rc.json().catch(() => ({}))
      const dp = await rp.json().catch(() => ({}))
      const casos: CasoOpc[] = ((dc.atendimentos ?? []) as Array<{ id: string; titulo: string | null; area: string | null }>)
        .map((a) => ({ id: a.id, titulo: a.titulo, label: (a.titulo ?? '').trim() || rotularArea(a.area) }))
      const processos: ProcOpc[] = ((dp.processos ?? []) as Array<{ id: string; numero_cnj: string | null; apelido: string | null }>)
        .map((p) => ({ id: p.id, numero_cnj: p.numero_cnj, apelido: p.apelido, label: (p.apelido ?? '').trim() || formatarCnj(p.numero_cnj) }))
      setAlvos({ casos, processos })
    } catch {
      setAlvos({ casos: [], processos: [] })
    } finally {
      setCarregandoAlvos(false)
    }
  }

  async function aplicarVinculo(tipo: 'atendimento' | 'processo', caso?: CasoOpc, proc?: ProcOpc) {
    const doc = vinculando
    if (!doc) return
    const alvoId = tipo === 'atendimento' ? caso?.id : proc?.id
    if (!alvoId) return
    setSalvandoVinculo(alvoId)
    try {
      const r = await fetch(`/api/documentos/${doc.id}/vinculo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tipo === 'atendimento' ? { atendimento_id: alvoId } : { processo_id: alvoId }),
      })
      if (r.ok) {
        setDocumentos((prev) => prev.map((d) => d.id === doc.id
          ? tipo === 'atendimento'
            ? { ...d, atendimento_id: alvoId, atendimento_titulo: caso?.label ?? null, processo_id: null, processo_numero_cnj: null, processo_apelido: null }
            : { ...d, processo_id: alvoId, processo_numero_cnj: proc?.numero_cnj ?? null, processo_apelido: proc?.apelido ?? null, atendimento_id: null, atendimento_titulo: null }
          : d))
        setVinculando(null)
        success('Documento vinculado', tipo === 'atendimento' ? 'Agora aparece no caso.' : 'Agora aparece no processo.')
      } else {
        const d = await r.json().catch(() => ({}))
        toastError('Não vinculado', d.error ?? 'Tente novamente.')
      }
    } catch {
      toastError('Não vinculado', 'Falha de rede. Tente novamente.')
    } finally {
      setSalvandoVinculo(null)
    }
  }

  function renderDoc(doc: DocumentoDossie) {
    const vinc = temVinculo(doc)
    const downloadUrl = doc.url
      ? doc.url + (doc.url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(doc.file_name)
      : null
    const processoLabel = doc.processo_apelido?.trim() || formatarCnj(doc.processo_numero_cnj)
    return (
      <li
        key={doc.id}
        className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm hover:border-primary/30 hover:bg-muted/40 transition-colors"
      >
        <IconeDoc mime={doc.mime_type} />
        <div className="min-w-0 flex-1">
          {doc.url ? (
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate font-medium text-foreground hover:text-primary transition-colors"
              title={doc.file_name}
            >
              {doc.file_name}
            </a>
          ) : (
            <span className="block truncate font-medium text-foreground">{doc.file_name}</span>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{formatarBytes(Number(doc.tamanho_bytes ?? 0))}</span>
            <span>·</span>
            <span>{formatarDataRelativa(doc.created_at)}</span>
            {doc.atendimento_id && (
              <Link
                href={`/clientes/${clienteId}/casos/${doc.atendimento_id}`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-primary"
                title={doc.atendimento_titulo ? `Do caso: ${doc.atendimento_titulo}` : 'Do atendimento'}
              >
                <Briefcase className="h-3 w-3" /> do caso
              </Link>
            )}
            {doc.processo_id && (
              <span
                className="inline-flex max-w-[180px] items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                title={`Do processo: ${processoLabel}`}
              >
                <Scale className="h-3 w-3 shrink-0" /> <span className="truncate">processo {processoLabel}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {doc.url && (
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1.5 text-muted-foreground hover:text-primary"
              title="Abrir em nova aba"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {downloadUrl && (
            <a
              href={downloadUrl}
              className="rounded p-1.5 text-muted-foreground hover:text-primary"
              title="Baixar"
            >
              <Download className="h-4 w-4" />
            </a>
          )}
          {vinc ? (
            <button
              onClick={() => desvincular(doc)}
              disabled={desvinculando === doc.id}
              className="rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Desvincular (volta a documento geral)"
            >
              {desvinculando === doc.id
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Unlink className="h-4 w-4" />}
            </button>
          ) : (
            <>
              <button
                onClick={() => abrirVincular(doc)}
                className="rounded p-1.5 text-muted-foreground hover:text-primary"
                title="Vincular a um caso ou processo"
              >
                <Link2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => excluir(doc)}
                disabled={excluindo === doc.id}
                className="rounded p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
                title="Excluir"
              >
                {excluindo === doc.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Trash2 className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
      </li>
    )
  }

  const gerais     = documentos.filter((d) => !temVinculo(d))
  const vinculados = documentos.filter(temVinculo)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4 text-amber-500" />
          Documentos
          {documentos.length > 0 && (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
              {documentos.length}
            </span>
          )}
        </CardTitle>
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp,.gif"
            className="hidden"
            onChange={(e) => enviarArquivos(e.target.files)}
            disabled={enviando}
          />
          <Button size="sm" variant="secondary" disabled={enviando} onClick={() => inputRef.current?.click()}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {enviando ? 'Enviando…' : 'Anexar'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Progresso do upload */}
        {progresso.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 p-2.5">
            {progresso.map((p, idx) => (
              <li key={idx} className="flex items-center gap-2 text-xs">
                {p.status === 'enviando' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                {p.status === 'concluido' && <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-success" />}
                {p.status === 'erro' && <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-destructive" />}
                <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                <span className={p.status === 'erro' ? 'text-destructive' : 'text-muted-foreground'}>
                  {p.status === 'enviando' ? 'enviando…' : p.status === 'concluido' ? 'ok' : (p.erro ?? 'erro')}
                </span>
              </li>
            ))}
          </ul>
        )}

        {carregando ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando documentos…
          </p>
        ) : documentos.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum documento ainda. Anexe contratos, procurações, laudos e outros arquivos deste cliente.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Gerais: sem vínculo de caso/processo. Subtítulo só aparece se houver
                também vinculados — senão a lista fala por si. */}
            {gerais.length > 0 && (
              <div className="space-y-1.5">
                {vinculados.length > 0 && (
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Gerais</p>
                )}
                <ul className="space-y-1.5">{gerais.map(renderDoc)}</ul>
              </div>
            )}
            {/* Vinculados: específicos de um caso e/ou processo. */}
            {vinculados.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Vinculados a caso ou processo</p>
                <ul className="space-y-1.5">{vinculados.map(renderDoc)}</ul>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Picker "Vincular a…" — casos e processos DESTE cliente */}
      <Dialog
        open={!!vinculando}
        onClose={() => setVinculando(null)}
        title="Vincular documento"
        description={vinculando ? `Escolha um caso ou processo para "${vinculando.file_name}".` : undefined}
        size="md"
      >
        {carregandoAlvos ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando casos e processos…
          </p>
        ) : !alvos || (alvos.casos.length === 0 && alvos.processos.length === 0) ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Este cliente ainda não tem casos nem processos para vincular.
          </p>
        ) : (
          <div className="space-y-4">
            {alvos.casos.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Casos</p>
                <ul className="space-y-1.5">
                  {alvos.casos.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => aplicarVinculo('atendimento', c)}
                        disabled={salvandoVinculo === c.id}
                        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm hover:border-primary/30 hover:bg-muted/40 transition-colors disabled:opacity-50"
                      >
                        <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{c.label}</span>
                        {salvandoVinculo === c.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {alvos.processos.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Processos</p>
                <ul className="space-y-1.5">
                  {alvos.processos.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => aplicarVinculo('processo', undefined, p)}
                        disabled={salvandoVinculo === p.id}
                        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm hover:border-primary/30 hover:bg-muted/40 transition-colors disabled:opacity-50"
                      >
                        <Scale className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{p.label}</span>
                        {salvandoVinculo === p.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </Card>
  )
}
