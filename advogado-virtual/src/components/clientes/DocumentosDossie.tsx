'use client'

import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react'
import {
  Paperclip, Upload, Loader2, FileText, Image as ImageIcon,
  FileSpreadsheet, File as FileIcon, Download, ExternalLink, Trash2, Link2,
  Scale, Briefcase, ChevronRight, Folder, FolderOpen, MoreVertical, Unlink,
  FileSignature, ScrollText,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, ConfirmDialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/toast'
import { createClient } from '@/lib/supabase/client'
import { formatarBytes } from '@/lib/documentos/tamanho'
import { formatarDataRelativa } from '@/lib/utils'
import { rotularArea, formatarCnj } from '@/lib/tarefas/vinculo'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import type { VinculoDoc } from '@/lib/documentos/vinculos'

// Aba "Documentos" do dossiê: o dono quer que ela SUBSTITUA o Google Drive — os
// arquivos do cliente vistos como uma ÁRVORE de pastas. Nós de 1º nível: "Casos",
// "Processos" e "Gerais". Dentro de Casos/Processos, uma pasta por caso/processo
// que tenha documentos. O MESMO arquivo pode aparecer em VÁRIAS pastas (atalho —
// vínculos N:N, 063): é sempre o mesmo doc, nunca uma cópia.

interface DocumentoDossie {
  id: string
  file_name: string
  tipo: string
  mime_type: string | null
  tamanho_bytes: number | null
  created_at: string
  url: string | null
  vinculos: VinculoDoc[]           // pastas (casos/processos) onde o doc aparece
  origem_atendimento_id: string | null // caso onde nasceu (null = nasceu no dossiê)
}

// Contrato de honorários como ITEM da árvore (pedido do dono). Somente leitura +
// navegação: gestão é na tela de contratos. `arquivoUrl` só existe quando há PDF
// assinado importado (status assinado); senão o item navega para /contratos/[id].
interface ContratoDossie {
  id: string
  titulo: string
  status: string
  area: string | null
  atendimento_id: string | null
  criado_em: string
  arquivoUrl: string | null
  arquivoNome: string | null
}

// Copiado de BADGE_CONTRATO_STATUS da página do cliente (não exportado) + o estado
// 'assinado' (migration 033), que a árvore trata de forma especial (abre o PDF).
const BADGE_CONTRATO_STATUS: Record<string, { variant: 'success' | 'warning' | 'secondary' | 'default'; label: string }> = {
  rascunho:   { variant: 'warning',   label: 'Rascunho'   },
  em_revisao: { variant: 'secondary', label: 'Em revisão' },
  aprovado:   { variant: 'success',   label: 'Aprovado'   },
  exportado:  { variant: 'default',   label: 'Exportado'  },
  assinado:   { variant: 'success',   label: 'Assinado'   },
}

// Peça como ITEM da árvore (dentro da pasta do caso). Só leitura + navegação: a
// edição/aprovação é no editor. Materialização (estado final) gera um .docx que
// aparece separado, como documento — este item é o atalho para o editor.
interface PecaDossie {
  id: string
  tipo: string
  status: string
  area: string | null
  atendimento_id: string | null
  atendimento_titulo: string | null
  atualizado_em: string
}

// Estados reais do fluxo de peças (004 + workflow de revisão). Badge por estado.
const BADGE_PECA_STATUS: Record<string, { variant: 'success' | 'warning' | 'secondary' | 'default'; label: string }> = {
  rascunho:           { variant: 'warning',   label: 'Rascunho'   },
  aguardando_revisao: { variant: 'secondary', label: 'Em revisão' },
  revisada:           { variant: 'secondary', label: 'Revisada'   },
  aprovada:           { variant: 'success',   label: 'Aprovada'   },
  exportada:          { variant: 'default',   label: 'Exportada'  },
}

const nomeTipoPeca = (tipo: string) => TIPOS_PECA[tipo]?.nome ?? tipo.replace(/_/g, ' ')

interface ProgressoItem {
  nome: string
  status: 'enviando' | 'concluido' | 'erro'
  erro?: string
}

// Alvos de vínculo do cliente (carregados sob demanda no picker "Vincular a…").
interface CasoOpc { id: string; titulo: string | null; label: string }
interface ProcOpc { id: string; numero_cnj: string | null; apelido: string | null; label: string }

// Contexto de uma linha de doc na árvore: em qual pasta ela está sendo mostrada.
// O MESMO doc aparece em várias pastas; a ação "Remover desta pasta" precisa saber
// de qual. 'geral' = sem vínculo (só aqui o doc pode ser excluído de fato).
type Contexto =
  | { tipo: 'geral' }
  | { tipo: 'atendimento'; id: string }
  | { tipo: 'processo'; id: string }

// Alvo de upload direcionado ("Anexar aqui" no cabeçalho de uma pasta).
type AlvoUpload = { tipo: 'atendimento'; id: string } | { tipo: 'processo'; id: string } | null

const TETO_BYTES = 25 * 1024 * 1024 // alinhado ao LIMITE_ANEXO_SERVIDOR_BYTES da API

function IconeDoc({ mime }: { mime: string | null }) {
  const cls = 'h-4 w-4 shrink-0'
  if (mime?.startsWith('image/')) return <ImageIcon className={`${cls} text-blue-500`} />
  if (mime === 'application/pdf') return <FileText className={`${cls} text-rose-500`} />
  if (mime?.includes('spreadsheet') || mime?.includes('excel'))
    return <FileSpreadsheet className={`${cls} text-emerald-500`} />
  if (mime?.includes('word')) return <FileText className={`${cls} text-blue-600`} />
  return <FileIcon className={`${cls} text-muted-foreground`} />
}

// Chave estável de uma pasta/nó para o estado de expandir/colapsar.
const ctxKey = (c: Contexto) => (c.tipo === 'geral' ? 'geral' : `${c.tipo}:${c.id}`)

export function DocumentosDossie({ clienteId }: { clienteId: string }) {
  const { success, error: toastError } = useToast()
  const [documentos, setDocumentos] = useState<DocumentoDossie[]>([])
  const [contratos, setContratos]   = useState<ContratoDossie[]>([])
  const [pecas, setPecas]           = useState<PecaDossie[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando]     = useState(false)
  const [progresso, setProgresso]   = useState<ProgressoItem[]>([])
  const [ocupado, setOcupado]       = useState<string | null>(null) // `${ctxKey}:${docId}` em ação
  // Confirmação de exclusão no ConfirmDialog temático (padrão da casa), no lugar
  // do confirm() nativo do navegador.
  const [confirmExcluir, setConfirmExcluir] = useState<DocumentoDossie | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Alvo do próximo upload: null = geral; senão vincula à pasta escolhida.
  const alvoUploadRef = useRef<AlvoUpload>(null)

  // Expandido: 1º nível (categorias) aberto por padrão; pastas fechadas.
  const [expandido, setExpandido] = useState<Set<string>>(
    () => new Set(['c:casos', 'c:processos', 'c:gerais', 'c:contratos']),
  )
  const toggle = (k: string) =>
    setExpandido((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  // Picker "Vincular a…" — ADICIONA o doc a mais um caso/processo (N:N).
  const [vinculando, setVinculando]     = useState<DocumentoDossie | null>(null)
  const [alvos, setAlvos]               = useState<{ casos: CasoOpc[]; processos: ProcOpc[] } | null>(null)
  const [carregandoAlvos, setCarregandoAlvos] = useState(false)
  const [salvandoVinculo, setSalvandoVinculo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/clientes/${clienteId}/documentos`)
      const d = await r.json()
      if (r.ok) {
        setDocumentos((d.documentos ?? []) as DocumentoDossie[])
        setContratos((d.contratos ?? []) as ContratoDossie[])
        setPecas((d.pecas ?? []) as PecaDossie[])
      }
    } catch {
      // silencioso — a lista fica vazia; o upload ainda funciona
    } finally {
      setCarregando(false)
    }
  }, [clienteId])

  useEffect(() => { carregar() }, [carregar])

  // Upload em 2 passos (mesmo fluxo de antes). Se `alvo` vier preenchido, o doc
  // nasce já vinculado àquela pasta (PATCH adicionar após confirmar).
  async function enviarArquivos(files: FileList | null, alvo: AlvoUpload) {
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
        // 4) "Anexar aqui": vincula o doc recém-criado à pasta escolhida.
        if (alvo && confData.documento?.id) {
          const col = alvo.tipo === 'atendimento' ? 'atendimento_id' : 'processo_id'
          await fetch(`/api/documentos/${confData.documento.id}/vinculo`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adicionar: { [col]: alvo.id } }),
          }).catch(() => { /* segue: o doc já existe em Gerais */ })
        }
        marcar({ status: 'concluido' })
      } catch {
        falhar('erro de rede')
      }
    }

    setEnviando(false)
    if (inputRef.current) inputRef.current.value = ''
    await carregar()
    if (erros === 0) success('Documentos anexados', alvo ? 'Já disponíveis nesta pasta.' : 'Já disponíveis no dossiê.')
    else toastError('Alguns arquivos falharam', `${erros} de ${arquivos.length} não foram enviados.`)
    setTimeout(() => setProgresso([]), 2500)
  }

  function dispararUpload(alvo: AlvoUpload) {
    alvoUploadRef.current = alvo
    inputRef.current?.click()
  }

  // Excluir de fato — só em Gerais (doc sem nenhum vínculo). A API barra (409) se
  // o doc ainda estiver em alguma pasta.
  function excluir(doc: DocumentoDossie) {
    setConfirmExcluir(doc)
  }

  async function executarExcluir(doc: DocumentoDossie) {
    setOcupado(`geral:${doc.id}`)
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
      setOcupado(null)
      setConfirmExcluir(null)
    }
  }

  // Remove SÓ o vínculo desta pasta (o arquivo continua no cliente e nas outras
  // pastas). Não é oferecido na pasta de ORIGEM de um doc nascido no caso.
  async function removerDaPasta(doc: DocumentoDossie, ctx: Contexto) {
    if (ctx.tipo === 'geral') return
    setOcupado(`${ctxKey(ctx)}:${doc.id}`)
    try {
      const col = ctx.tipo === 'atendimento' ? 'atendimento_id' : 'processo_id'
      const r = await fetch(`/api/documentos/${doc.id}/vinculo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remover: { [col]: ctx.id } }),
      })
      if (r.ok) {
        // Tira o vínculo desta pasta do estado local (o doc pode continuar em
        // outras — ou cair em "Gerais" se este era o último).
        setDocumentos((prev) => prev.map((d) => d.id === doc.id
          ? { ...d, vinculos: d.vinculos.filter((v) => ctx.tipo === 'atendimento' ? v.atendimento_id !== ctx.id : v.processo_id !== ctx.id) }
          : d))
        success('Removido da pasta', 'O documento continua no dossiê do cliente.')
      } else {
        const d = await r.json().catch(() => ({}))
        toastError('Não removido', d.error ?? 'Tente novamente.')
      }
    } catch {
      toastError('Não removido', 'Falha de rede. Tente novamente.')
    } finally {
      setOcupado(null)
    }
  }

  // Abre o picker "Vincular a…" e carrega (uma vez) os casos e processos do cliente.
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

  // ADICIONA um vínculo (pode ter vários). Atualiza o estado local com a nova
  // pasta para a árvore reagir sem recarregar tudo.
  async function aplicarVinculo(tipo: 'atendimento' | 'processo', caso?: CasoOpc, proc?: ProcOpc) {
    const doc = vinculando
    if (!doc) return
    const alvoId = tipo === 'atendimento' ? caso?.id : proc?.id
    if (!alvoId) return
    setSalvandoVinculo(alvoId)
    try {
      const col = tipo === 'atendimento' ? 'atendimento_id' : 'processo_id'
      const r = await fetch(`/api/documentos/${doc.id}/vinculo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adicionar: { [col]: alvoId } }),
      })
      if (r.ok) {
        const novo: VinculoDoc = tipo === 'atendimento'
          ? { atendimento_id: alvoId, processo_id: null, titulo: caso?.label ?? null }
          : { atendimento_id: null, processo_id: alvoId, numero_cnj: proc?.numero_cnj ?? null, apelido: proc?.apelido ?? null }
        setDocumentos((prev) => prev.map((d) => d.id === doc.id
          ? { ...d, vinculos: d.vinculos.some((v) => tipo === 'atendimento' ? v.atendimento_id === alvoId : v.processo_id === alvoId) ? d.vinculos : [...d.vinculos, novo] }
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

  // ── Monta a árvore a partir dos vínculos (o mesmo doc entra em cada pasta) ────
  const arvore = useMemo(() => {
    const gerais: DocumentoDossie[] = []
    const casos = new Map<string, { id: string; label: string; docs: DocumentoDossie[]; contratos: ContratoDossie[]; pecas: PecaDossie[] }>()
    const procs = new Map<string, { id: string; label: string; docs: DocumentoDossie[] }>()
    // Nó do caso, criando sob demanda. `label` melhora o rótulo se o atual ainda é
    // o placeholder (docs trazem o título do caso; contratos, o rótulo da área).
    const noCaso = (id: string, label?: string | null) => {
      const cur = casos.get(id) ?? { id, label: label?.trim() || 'Caso sem título', docs: [], contratos: [], pecas: [] }
      if (label?.trim() && cur.label === 'Caso sem título') cur.label = label.trim()
      casos.set(id, cur)
      return cur
    }
    for (const d of documentos) {
      if (d.vinculos.length === 0) { gerais.push(d); continue }
      for (const v of d.vinculos) {
        if (v.atendimento_id) {
          noCaso(v.atendimento_id, v.titulo).docs.push(d)
        } else if (v.processo_id) {
          const cur = procs.get(v.processo_id) ?? { id: v.processo_id, label: v.apelido?.trim() || formatarCnj(v.numero_cnj) || 'Processo', docs: [] }
          cur.docs.push(d)
          procs.set(v.processo_id, cur)
        }
      }
    }
    // Contrato com atendimento_id: atalho na pasta do caso (mesma lógica dos docs).
    // Sem docs no caso? A pasta é criada mesmo assim, rotulada pela área do contrato.
    for (const c of contratos) {
      if (c.atendimento_id) noCaso(c.atendimento_id, rotularArea(c.area)).contratos.push(c)
    }
    // Peça: item na pasta do caso. Cria a pasta mesmo que o caso não tenha documento
    // nem contrato (a peça não pode sumir da árvore) — rotula pelo título do caso.
    for (const p of pecas) {
      if (p.atendimento_id) noCaso(p.atendimento_id, p.atendimento_titulo).pecas.push(p)
    }
    const ordenar = <T extends { label: string }>(m: Map<string, T>) =>
      [...m.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
    return { gerais, casos: ordenar(casos), procs: ordenar(procs) }
  }, [documentos, contratos, pecas])

  // ── Uma linha de documento (nível folha da árvore). Render-helpers (chamados
  // como função, não como <Componente/>) para não remontar a subárvore — e fechar
  // o menu — a cada re-render do card. ─────────────────────────────────────────
  function renderLinhaDoc(doc: DocumentoDossie, ctx: Contexto) {
    const downloadUrl = doc.url
      ? doc.url + (doc.url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(doc.file_name)
      : null
    // Não deixa "remover da pasta de origem" um doc que nasceu neste caso (origem.ts).
    const ehPastaOrigem = ctx.tipo === 'atendimento' && doc.origem_atendimento_id === ctx.id
    const podeRemover = ctx.tipo !== 'geral' && !ehPastaOrigem
    const emAcao = ocupado === `${ctxKey(ctx)}:${doc.id}`
    return (
      <li key={`${ctxKey(ctx)}:${doc.id}`} className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors">
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
          <span className="block text-xs text-muted-foreground">
            {formatarBytes(Number(doc.tamanho_bytes ?? 0))} · {formatarDataRelativa(doc.created_at)}
            {ehPastaOrigem && <span className="ml-1.5 text-[10px] italic opacity-70">· origem</span>}
          </span>
        </div>
        {emAcao ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="shrink-0 rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100"
              title="Ações"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {doc.url && (
                <DropdownMenuItem asChild>
                  <a href={doc.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" /> Abrir
                  </a>
                </DropdownMenuItem>
              )}
              {downloadUrl && (
                <DropdownMenuItem asChild>
                  <a href={downloadUrl}>
                    <Download className="h-4 w-4" /> Baixar
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => abrirVincular(doc)}>
                <Link2 className="h-4 w-4" /> Vincular a…
              </DropdownMenuItem>
              {podeRemover && (
                <DropdownMenuItem onSelect={() => removerDaPasta(doc, ctx)}>
                  <Unlink className="h-4 w-4" /> Remover desta pasta
                </DropdownMenuItem>
              )}
              {ctx.tipo === 'geral' && (
                <DropdownMenuItem
                  onSelect={() => excluir(doc)}
                  className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" /> Excluir
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </li>
    )
  }

  // ── Uma linha de contrato (folha). Somente leitura + navegação: nada de vínculo
  // ou exclusão (a gestão é na tela de contratos). ASSINADO com PDF importado abre
  // o arquivo (nova aba) e permite baixar; os demais navegam para /contratos/[id].
  function renderLinhaContrato(c: ContratoDossie) {
    const badge = BADGE_CONTRATO_STATUS[c.status] ?? BADGE_CONTRATO_STATUS.rascunho
    const temPdf = c.status === 'assinado' && !!c.arquivoUrl
    const href = temPdf ? c.arquivoUrl! : `/contratos/${c.id}`
    const downloadUrl = temPdf && c.arquivoUrl
      ? c.arquivoUrl + (c.arquivoUrl.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(c.arquivoNome ?? `${c.titulo}.pdf`)
      : null
    return (
      <li key={`ct:${c.id}`} className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors">
        <FileSignature className="h-4 w-4 shrink-0 text-blue-500" />
        <div className="min-w-0 flex-1">
          <a
            href={href}
            {...(temPdf ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="block truncate font-medium text-foreground hover:text-primary transition-colors"
            title={c.titulo}
          >
            {c.titulo}
          </a>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant={badge.variant} className="px-1.5 py-0 text-[10px]">{badge.label}</Badge>
            {formatarDataRelativa(c.criado_em)}
          </div>
        </div>
        {/* Ação principal: baixar o PDF assinado, senão abrir o contrato. */}
        {downloadUrl ? (
          <a
            href={downloadUrl}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-primary group-hover:opacity-100"
            title="Baixar contrato assinado"
          >
            <Download className="h-4 w-4" />
          </a>
        ) : (
          <a
            href={href}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-primary group-hover:opacity-100"
            title="Abrir contrato"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </li>
    )
  }

  // ── Uma linha de peça (folha, só em pastas de caso). Só leitura + navegação ao
  // editor: a edição/aprovação é lá. Badge do estado (rascunho/revisada/aprovada/
  // exportada). Sem `area` não há rota de editor — mostra só o texto. ────────────
  function renderLinhaPeca(p: PecaDossie) {
    const badge = BADGE_PECA_STATUS[p.status] ?? BADGE_PECA_STATUS.rascunho
    const nome = `Peça — ${nomeTipoPeca(p.tipo)}`
    const href = p.area ? `/${p.area}/editor/${p.id}` : null
    return (
      <li key={`pc:${p.id}`} className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors">
        <ScrollText className="h-4 w-4 shrink-0 text-violet-500" />
        <div className="min-w-0 flex-1">
          {href ? (
            <a
              href={href}
              className="block truncate font-medium text-foreground hover:text-primary transition-colors"
              title={nome}
            >
              {nome}
            </a>
          ) : (
            <span className="block truncate font-medium text-foreground" title={nome}>{nome}</span>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant={badge.variant} className="px-1.5 py-0 text-[10px]">{badge.label}</Badge>
            {formatarDataRelativa(p.atualizado_em)}
          </div>
        </div>
        {href && (
          <a
            href={href}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-primary group-hover:opacity-100"
            title="Abrir no editor"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </li>
    )
  }

  // ── Uma pasta (caso ou processo): cabeçalho colapsável + "Anexar aqui" ────────
  // `contratosDaPasta`/`pecasDaPasta` só são preenchidos em pastas de caso.
  function renderPasta(
    nodeKey: string, label: string, docs: DocumentoDossie[], ctx: Contexto, alvo: AlvoUpload,
    contratosDaPasta: ContratoDossie[] = [], pecasDaPasta: PecaDossie[] = [],
  ) {
    const aberta = expandido.has(nodeKey)
    const total = docs.length + contratosDaPasta.length + pecasDaPasta.length
    return (
      <li key={nodeKey}>
        <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-muted/40">
          <button
            onClick={() => toggle(nodeKey)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pl-1 text-left text-sm"
          >
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${aberta ? 'rotate-90' : ''}`} />
            {aberta ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" /> : <Folder className="h-4 w-4 shrink-0 text-amber-500" />}
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{label}</span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{total}</span>
          </button>
          <button
            onClick={() => dispararUpload(alvo)}
            disabled={enviando}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-primary group-hover:opacity-100 disabled:opacity-40"
            title="Anexar arquivo nesta pasta"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
        </div>
        {aberta && (
          <ul className="ml-[13px] space-y-0.5 border-l border-border pl-2">
            {pecasDaPasta.map((p) => renderLinhaPeca(p))}
            {contratosDaPasta.map((c) => renderLinhaContrato(c))}
            {docs.map((d) => renderLinhaDoc(d, ctx))}
          </ul>
        )}
      </li>
    )
  }

  // ── Uma categoria de 1º nível (Casos / Processos / Gerais) ────────────────────
  function renderCategoria(
    nodeKey: string, titulo: string, icon: ReactNode, count: number, children: ReactNode,
  ) {
    const aberta = expandido.has(nodeKey)
    return (
      <li key={nodeKey}>
        <button
          onClick={() => toggle(nodeKey)}
          className="flex w-full items-center gap-1.5 rounded-md py-1.5 pl-1 pr-2 text-left hover:bg-muted/40"
        >
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberta ? 'rotate-90' : ''}`} />
          {icon}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{titulo}</span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{count}</span>
        </button>
        {aberta && <div className="ml-[13px] mt-0.5 border-l border-border pl-2">{children}</div>}
      </li>
    )
  }

  // Contratos com caso vivem na pasta do caso; a pasta "Contratos" é só dos órfãos.
  const contratosSemCaso = contratos.filter((c) => !c.atendimento_id)

  // Total do cabeçalho: arquivos + contratos + peças (cada um é um item único da
  // árvore). Inclui peças para que um caso que só tenha peça ainda apareça (não
  // caia no estado vazio).
  const totalItens = documentos.length + contratos.length + pecas.length
  const temAlgum = totalItens > 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4 text-amber-500" />
          Documentos
          {totalItens > 0 && (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
              {totalItens}
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
            onChange={(e) => {
              const alvo = alvoUploadRef.current
              alvoUploadRef.current = null
              enviarArquivos(e.target.files, alvo)
            }}
            disabled={enviando}
          />
          {/* Botão geral: sobe para "Gerais" (sem vínculo). */}
          <Button size="sm" variant="secondary" disabled={enviando} onClick={() => dispararUpload(null)}>
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
        ) : !temAlgum ? (
          <EmptyState
            className="py-10"
            icon={<Folder className="h-7 w-7" />}
            title="Nenhum documento ainda"
            description="Anexe contratos, procurações, laudos e outros arquivos. Organize-os por caso ou processo — o mesmo arquivo pode servir a vários."
          />
        ) : (
          <ul className="space-y-0.5">
            {arvore.casos.length > 0 && renderCategoria(
              'c:casos', 'Casos',
              <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />,
              arvore.casos.length,
              <ul className="space-y-0.5">
                {arvore.casos.map((c) => renderPasta(`at:${c.id}`, c.label, c.docs, { tipo: 'atendimento', id: c.id }, { tipo: 'atendimento', id: c.id }, c.contratos, c.pecas))}
              </ul>,
            )}

            {arvore.procs.length > 0 && renderCategoria(
              'c:processos', 'Processos',
              <Scale className="h-4 w-4 shrink-0 text-muted-foreground" />,
              arvore.procs.length,
              <ul className="space-y-0.5">
                {arvore.procs.map((p) => renderPasta(`pr:${p.id}`, p.label, p.docs, { tipo: 'processo', id: p.id }, { tipo: 'processo', id: p.id }))}
              </ul>,
            )}

            {/* Contratos: pasta de 1º nível SÓ para contratos sem caso (dono, 2026-07-16) —
                os vinculados já aparecem dentro da pasta do próprio caso, sem duplicar. */}
            {contratosSemCaso.length > 0 && renderCategoria(
              'c:contratos', 'Contratos',
              <FileSignature className="h-4 w-4 shrink-0 text-muted-foreground" />,
              contratosSemCaso.length,
              <ul className="space-y-0.5">
                {contratosSemCaso.map((c) => renderLinhaContrato(c))}
              </ul>,
            )}

            {arvore.gerais.length > 0 && renderCategoria(
              'c:gerais', 'Gerais',
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />,
              arvore.gerais.length,
              <ul className="space-y-0.5">
                {arvore.gerais.map((d) => renderLinhaDoc(d, { tipo: 'geral' }))}
              </ul>,
            )}
          </ul>
        )}
      </CardContent>

      {/* Picker "Vincular a…" — casos e processos DESTE cliente. ADICIONA (N:N):
          alvos onde o doc já está ficam desabilitados. */}
      <Dialog
        open={!!vinculando}
        onClose={() => setVinculando(null)}
        title="Vincular documento"
        description={vinculando ? `Adicione "${vinculando.file_name}" a um caso ou processo (pode estar em vários).` : undefined}
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
                  {alvos.casos.map((c) => {
                    const jaEsta = !!vinculando?.vinculos.some((v) => v.atendimento_id === c.id)
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => aplicarVinculo('atendimento', c)}
                          disabled={jaEsta || salvandoVinculo === c.id}
                          className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm hover:border-primary/30 hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card"
                        >
                          <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{c.label}</span>
                          {jaEsta
                            ? <span className="shrink-0 text-[10px] text-muted-foreground">já está</span>
                            : salvandoVinculo === c.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {alvos.processos.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Processos</p>
                <ul className="space-y-1.5">
                  {alvos.processos.map((p) => {
                    const jaEsta = !!vinculando?.vinculos.some((v) => v.processo_id === p.id)
                    return (
                      <li key={p.id}>
                        <button
                          onClick={() => aplicarVinculo('processo', undefined, p)}
                          disabled={jaEsta || salvandoVinculo === p.id}
                          className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm hover:border-primary/30 hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card"
                        >
                          <Scale className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{p.label}</span>
                          {jaEsta
                            ? <span className="shrink-0 text-[10px] text-muted-foreground">já está</span>
                            : salvandoVinculo === p.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Confirmação de exclusão (só em Gerais) — padrão da casa */}
      <ConfirmDialog
        open={confirmExcluir !== null}
        onClose={() => setConfirmExcluir(null)}
        onConfirm={() => { if (confirmExcluir) void executarExcluir(confirmExcluir) }}
        title={confirmExcluir ? `Excluir "${confirmExcluir.file_name}"?` : 'Excluir documento?'}
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
        loading={confirmExcluir !== null && ocupado === `geral:${confirmExcluir.id}`}
      />
    </Card>
  )
}
