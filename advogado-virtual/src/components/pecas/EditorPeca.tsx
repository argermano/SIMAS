'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { Save, Check, Eye, Pencil } from 'lucide-react'

interface EditorPecaProps {
  pecaId: string
  conteudo: string
  versao: number
  status: string
  onConteudoChange: (conteudo: string) => void
}

export function EditorPeca({ pecaId, conteudo, versao, status, onConteudoChange }: EditorPecaProps) {
  const { success, error: toastError } = useToast()
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [modo, setModo] = useState<'preview' | 'editar'>('preview')

  async function salvar() {
    setSalvando(true)
    try {
      const res = await fetch(`/api/ia/salvar-peca`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pecaId, conteudo }),
      })

      if (res.ok) {
        setSalvo(true)
        success('Peça salva!', `Versão ${versao} salva com sucesso.`)
        setTimeout(() => setSalvo(false), 2000)
      } else {
        const data = await res.json()
        toastError('Erro ao salvar', data.error ?? 'Tente novamente')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-3">
          <CardTitle className="text-base">
            Editor da peça
            <span className="ml-2 text-xs font-normal text-gray-400">v{versao} · {status}</span>
          </CardTitle>

          {/* Toggle Visualizar / Editar */}
          <div className="flex rounded-lg border bg-gray-50 p-0.5">
            <button
              onClick={() => setModo('preview')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                modo === 'preview'
                  ? 'bg-white text-primary-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Visualizar
            </button>
            <button
              onClick={() => setModo('editar')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                modo === 'editar'
                  ? 'bg-white text-primary-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </button>
          </div>
        </div>

        <Button
          size="sm"
          onClick={salvar}
          loading={salvando}
          disabled={salvando || salvo}
          className="gap-1.5"
        >
          {salvo ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {salvo ? 'Salvo' : 'Salvar'}
        </Button>
      </CardHeader>
      <CardContent>
        {modo === 'editar' ? (
          <Textarea
            value={conteudo}
            onChange={(e) => onConteudoChange(e.target.value)}
            rows={30}
            className="font-mono text-sm leading-relaxed"
            placeholder="O conteúdo da peça aparecerá aqui..."
          />
        ) : (
          <div
            className="prose prose-sm max-w-none min-h-[600px] rounded-xl border bg-white p-6 overflow-y-auto"
            style={{ maxHeight: '75vh' }}
          >
            {conteudo ? (
              <ReactMarkdown
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-xl font-bold text-gray-900 mt-6 mb-3 pb-2 border-b">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-lg font-bold text-gray-900 mt-6 mb-2 uppercase tracking-wide">{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base font-semibold text-gray-800 mt-4 mb-2">{children}</h3>
                  ),
                  p: ({ children }) => (
                    <p className="text-sm leading-7 text-gray-800 mb-3 text-justify">{children}</p>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-bold text-gray-900">{children}</strong>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-primary-300 bg-primary-50 pl-4 py-2 my-3 italic text-sm text-gray-700">
                      {children}
                    </blockquote>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal pl-6 space-y-1.5 my-3 text-sm text-gray-800">{children}</ol>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc pl-6 space-y-1.5 my-3 text-sm text-gray-800">{children}</ul>
                  ),
                  li: ({ children }) => (
                    <li className="leading-relaxed">{children}</li>
                  ),
                  hr: () => (
                    <hr className="my-6 border-gray-300" />
                  ),
                }}
              >
                {conteudo}
              </ReactMarkdown>
            ) : (
              <p className="text-gray-400 text-sm">O conteúdo da peça aparecerá aqui...</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
