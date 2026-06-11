'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Stamp, Loader2, Upload, CheckCircle, Trash2 } from 'lucide-react'

export function PapelTimbrado() {
  const { success, error: toastError } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [existe, setExiste] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [removendo, setRemovendo] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/configuracoes/timbrado')
      if (res.ok) {
        const d = await res.json()
        setExiste(!!d.existe)
      }
    } catch {
      /* silencioso */
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function enviar(file: File) {
    if (!/\.docx$/i.test(file.name)) {
      toastError('Formato inválido', 'Envie o papel timbrado em .docx (Word).')
      return
    }
    setEnviando(true)
    try {
      const fd = new FormData()
      fd.append('timbrado', file)
      const res = await fetch('/api/configuracoes/timbrado', { method: 'POST', body: fd })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Falha ao enviar')
      }
      setExiste(true)
      success('Papel timbrado salvo', 'As peças passam a ser exportadas dentro do seu timbrado.')
    } catch (e) {
      toastError('Erro', e instanceof Error ? e.message : 'Tente novamente.')
    } finally {
      setEnviando(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remover() {
    setRemovendo(true)
    try {
      const res = await fetch('/api/configuracoes/timbrado', { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setExiste(false)
      success('Timbrado removido', 'As peças voltam a ser exportadas sem timbrado.')
    } catch {
      toastError('Erro', 'Falha ao remover.')
    } finally {
      setRemovendo(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stamp className="h-5 w-5 text-muted-foreground" />
          Papel timbrado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Envie o <strong>.docx do papel timbrado</strong> do escritório (cabeçalho/logo, marca d&apos;água e rodapé,
          com o corpo vazio). As peças passam a ser exportadas <strong>dentro dele</strong>, preservando a identidade
          em todas as páginas.
        </p>

        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando…
          </div>
        ) : existe ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/20 bg-success/5 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle className="h-4 w-4" /> Papel timbrado cadastrado
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={enviando} className="gap-1.5">
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Substituir
              </Button>
              <Button size="sm" variant="ghost" onClick={remover} disabled={removendo} className="gap-1.5 text-destructive hover:text-destructive">
                {removendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remover
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={enviando} className="gap-1.5">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {enviando ? 'Enviando…' : 'Enviar papel timbrado (.docx)'}
          </Button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) enviar(f) }}
        />

        <p className="text-xs text-muted-foreground">
          Dica: deixe o corpo do .docx vazio — o conteúdo da peça entra no lugar, mantendo cabeçalho e rodapé.
        </p>
      </CardContent>
    </Card>
  )
}
