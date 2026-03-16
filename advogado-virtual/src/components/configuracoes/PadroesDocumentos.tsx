'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  FileText, Upload, Trash2, Loader2, Plus, Eye, X,
  FileSignature, ScrollText, Scale, FileCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const TIPOS = [
  { id: 'peca', label: 'Peças Processuais', icon: Scale, descricao: 'Petições iniciais, contestações, recursos e outras peças' },
  { id: 'contrato', label: 'Contratos', icon: FileSignature, descricao: 'Contratos de honorários, prestação de serviços, etc.' },
  { id: 'procuracao', label: 'Procurações', icon: ScrollText, descricao: 'Procurações ad judicia, ad negotia e específicas' },
  { id: 'declaracao', label: 'Declarações', icon: FileCheck, descricao: 'Declarações de hipossuficiência, residência, etc.' },
] as const

type TipoModelo = (typeof TIPOS)[number]['id']

interface Modelo {
  id: string
  tipo: string
  titulo: string
  descricao: string | null
  created_at: string
  updated_at: string
}

export function PadroesDocumentos() {
  const { success, error: toastError } = useToast()
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [loading, setLoading] = useState(true)
  const [tipoAtivo, setTipoAtivo] = useState<TipoModelo>('peca')
  const [showForm, setShowForm] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [visualizando, setVisualizando] = useState<{ titulo: string; conteudo: string } | null>(null)

  // Form state
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [conteudo, setConteudo] = useState('')
  const [modoInput, setModoInput] = useState<'arquivo' | 'texto'>('arquivo')
  const fileRef = useRef<HTMLInputElement>(null)

  const carregarModelos = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/modelos-documento')
      if (res.ok) {
        const data = await res.json()
        setModelos(data.modelos ?? [])
      }
    } catch {
      toastError('Erro', 'Falha ao carregar modelos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregarModelos() }, [carregarModelos])

  const modelosFiltrados = modelos.filter(m => m.tipo === tipoAtivo)

  function resetForm() {
    setTitulo('')
    setDescricao('')
    setArquivo(null)
    setConteudo('')
    setModoInput('arquivo')
    setShowForm(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!titulo.trim()) {
      toastError('Erro', 'Informe o título do modelo')
      return
    }
    if (modoInput === 'arquivo' && !arquivo) {
      toastError('Erro', 'Selecione um arquivo')
      return
    }
    if (modoInput === 'texto' && !conteudo.trim()) {
      toastError('Erro', 'Informe o conteúdo do modelo')
      return
    }

    setEnviando(true)
    try {
      const formData = new FormData()
      formData.append('tipo', tipoAtivo)
      formData.append('titulo', titulo.trim())
      if (descricao.trim()) formData.append('descricao', descricao.trim())

      if (modoInput === 'arquivo' && arquivo) {
        formData.append('arquivo', arquivo)
      } else {
        formData.append('conteudo', conteudo.trim())
      }

      const res = await fetch('/api/modelos-documento', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toastError('Erro', (data as { error?: string }).error ?? 'Falha ao salvar modelo')
        return
      }

      success('Modelo salvo!', `"${titulo}" foi adicionado aos padrões de ${TIPOS.find(t => t.id === tipoAtivo)?.label}`)
      resetForm()
      carregarModelos()
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setEnviando(false)
    }
  }

  async function handleExcluir(id: string, tituloModelo: string) {
    if (!confirm(`Excluir o modelo "${tituloModelo}"?`)) return

    setExcluindo(id)
    try {
      const res = await fetch(`/api/modelos-documento/${id}`, { method: 'DELETE' })
      if (res.ok) {
        success('Excluído', `"${tituloModelo}" foi removido`)
        setModelos(prev => prev.filter(m => m.id !== id))
      } else {
        toastError('Erro', 'Falha ao excluir')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setExcluindo(null)
    }
  }

  async function handleVisualizar(id: string, tituloModelo: string) {
    try {
      const res = await fetch(`/api/modelos-documento/${id}`)
      if (res.ok) {
        const data = await res.json()
        setVisualizando({
          titulo: tituloModelo,
          conteudo: data.modelo?.conteudo_markdown || '(sem conteúdo extraído)',
        })
      }
    } catch {
      toastError('Erro', 'Falha ao carregar conteúdo')
    }
  }

  return (
    <div className="space-y-6">
      {/* Descrição */}
      <div>
        <p className="text-sm text-muted-foreground">
          Gerencie os modelos padrão de documentos do escritório. Esses modelos podem ser usados como referência pela IA ao gerar documentos.
        </p>
      </div>

      {/* Abas por tipo */}
      <div className="flex gap-1 border-b border-border">
        {TIPOS.map(tipo => {
          const Icon = tipo.icon
          const count = modelos.filter(m => m.tipo === tipo.id).length
          return (
            <button
              key={tipo.id}
              onClick={() => { setTipoAtivo(tipo.id); setShowForm(false) }}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                tipoAtivo === tipo.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tipo.label}</span>
              {count > 0 && (
                <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Descrição do tipo ativo */}
      <p className="text-xs text-muted-foreground">
        {TIPOS.find(t => t.id === tipoAtivo)?.descricao}
      </p>

      {/* Lista de modelos */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {modelosFiltrados.length === 0 && !showForm && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Nenhum modelo cadastrado para {TIPOS.find(t => t.id === tipoAtivo)?.label}.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  onClick={() => setShowForm(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Adicionar modelo
                </Button>
              </CardContent>
            </Card>
          )}

          {modelosFiltrados.map(modelo => (
            <Card key={modelo.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{modelo.titulo}</p>
                  {modelo.descricao && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{modelo.descricao}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Adicionado em {new Date(modelo.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleVisualizar(modelo.id, modelo.titulo)}
                    title="Visualizar conteúdo"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleExcluir(modelo.id, modelo.titulo)}
                    disabled={excluindo === modelo.id}
                    title="Excluir modelo"
                    className="text-destructive hover:text-destructive"
                  >
                    {excluindo === modelo.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />
                    }
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {modelosFiltrados.length > 0 && !showForm && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowForm(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Adicionar modelo
            </Button>
          )}
        </div>
      )}

      {/* Formulário de novo modelo */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Novo modelo de {TIPOS.find(t => t.id === tipoAtivo)?.label}
              </span>
              <Button variant="ghost" size="sm" onClick={resetForm}>
                <X className="h-4 w-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Título *</label>
                <input
                  type="text"
                  value={titulo}
                  onChange={e => setTitulo(e.target.value)}
                  placeholder="Ex.: Petição Inicial Cível Padrão"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                />
              </div>

              <div>
                <label className="text-sm font-medium">Descrição (opcional)</label>
                <input
                  type="text"
                  value={descricao}
                  onChange={e => setDescricao(e.target.value)}
                  placeholder="Breve descrição do modelo"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              {/* Alternância arquivo / texto */}
              <div>
                <label className="text-sm font-medium">Conteúdo do modelo</label>
                <div className="flex gap-2 mt-1 mb-3">
                  <button
                    type="button"
                    onClick={() => setModoInput('arquivo')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                      modoInput === 'arquivo'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-input hover:border-foreground/30'
                    )}
                  >
                    <Upload className="h-3.5 w-3.5 inline mr-1" />
                    Upload de arquivo
                  </button>
                  <button
                    type="button"
                    onClick={() => setModoInput('texto')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                      modoInput === 'texto'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-input hover:border-foreground/30'
                    )}
                  >
                    <FileText className="h-3.5 w-3.5 inline mr-1" />
                    Colar texto
                  </button>
                </div>

                {modoInput === 'arquivo' ? (
                  <div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain"
                      onChange={e => setArquivo(e.target.files?.[0] ?? null)}
                      className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      PDF, Word (.docx) ou texto (.txt) — máx. 10 MB
                    </p>
                  </div>
                ) : (
                  <textarea
                    value={conteudo}
                    onChange={e => setConteudo(e.target.value)}
                    placeholder="Cole o conteúdo do modelo aqui..."
                    rows={8}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  />
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" size="sm" onClick={resetForm}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={enviando}>
                  {enviando ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-1" />
                      Salvar modelo
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Modal de visualização */}
      {visualizando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setVisualizando(null)}>
          <div
            className="relative max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">{visualizando.titulo}</h3>
              <Button variant="ghost" size="sm" onClick={() => setVisualizando(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <pre className="whitespace-pre-wrap text-sm text-foreground font-mono bg-muted rounded-md p-4 max-h-[60vh] overflow-y-auto">
              {visualizando.conteudo}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
