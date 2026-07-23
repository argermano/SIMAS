'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, FilePen, FolderPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { VinculoPicker, type VinculoSelecionado } from './VinculoPicker'
import { nomeProvavelDoTitulo } from '@/lib/tarefas/titulo-nome'

// Assistente de vínculo do "Resolver" para tarefa de PEÇA sem caso. Substitui o
// botão morto/dossiê por AJUDA ATIVA (PART 2):
//   a) COM cliente/processo → liga a tarefa a um caso do cliente e abre o motor;
//      cliente sem casos → caminho honesto "Criar caso para este cliente".
//   b) SEM vínculo nenhum → liga cliente/caso com SUGESTÕES por nome (do título).
// IA prepara, humano executa: aqui o humano escolhe o vínculo; nada é automático.

interface VinculoAssistenteProps {
  taskId:       string
  titulo:       string
  clienteId:    string | null
  clienteNome:  string | null
  processoId:   string | null
  /** Chamado após vincular quando NÃO há navegação (o modal recarrega a ação). */
  onVinculado:  () => void
}

export function VinculoAssistente({
  taskId, titulo, clienteId, clienteNome, processoId, onVinculado,
}: VinculoAssistenteProps) {
  const router = useRouter()
  const { error: toastError } = useToast()

  const modo: 'com-cliente' | 'sem-vinculo' = clienteId ? 'com-cliente' : 'sem-vinculo'

  const [sugestoes, setSugestoes] = useState<VinculoSelecionado[]>([])
  const [semCasos,  setSemCasos]  = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [abrindo,   setAbrindo]   = useState(false) // picker visível
  const [salvando,  setSalvando]  = useState(false)
  const seqRef = useRef(0)

  // Pré-carrega sugestões: casos do cliente (a) ou matches por nome do título (b).
  useEffect(() => {
    const seq = ++seqRef.current
    setCarregando(true)
    setSemCasos(false)
    setSugestoes([])
    ;(async () => {
      try {
        let url: string | null = null
        if (modo === 'com-cliente') {
          url = `/api/tarefas/vinculos?clienteId=${encodeURIComponent(clienteId!)}&tipos=atendimento`
        } else {
          const nome = nomeProvavelDoTitulo(titulo)
          url = nome ? `/api/tarefas/vinculos?q=${encodeURIComponent(nome)}` : null
        }
        if (!url) return
        const r = await fetch(url)
        const d = await r.json().catch(() => ({}))
        if (seq !== seqRef.current) return
        const itens = (d.resultados ?? []) as VinculoSelecionado[]
        setSugestoes(itens)
        if (modo === 'com-cliente') setSemCasos(itens.length === 0)
      } finally {
        if (seq === seqRef.current) setCarregando(false)
      }
    })()
  }, [taskId, modo, clienteId, titulo])

  async function vincular(v: VinculoSelecionado | null) {
    if (!v) return
    setSalvando(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ vinculo: { tipo: v.tipo, id: v.id } }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toastError('Erro', d.error ?? 'Não foi possível vincular')
        return
      }
      // Ligou a um CASO → o motor de peças já pode abrir: re-resolve a URL (precisa
      // da área/tipo, que a rota monta) e navega direto. Senão, só recarrega.
      if (v.tipo === 'atendimento') {
        const acaoRes = await fetch(`/api/tasks/${taskId}/acao`, { method: 'POST' })
        const acao = await acaoRes.json().catch(() => null)
        if (acao?.href) { router.push(acao.href as string); return }
      }
      onVinculado()
    } finally {
      setSalvando(false)
    }
  }

  const criarCasoHref = clienteId ? `/clientes/${clienteId}/atendimentos/novo` : null

  return (
    <div className="mx-6 mb-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <FilePen className="h-4 w-4 text-primary" />
        Vincule ao caso para gerar a peça
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {modo === 'com-cliente'
          ? <>Esta peça {clienteNome ? <>é de <span className="font-medium text-foreground">{clienteNome}</span></> : 'tem cliente/processo'}, mas ainda não está ligada a um caso. Escolha o caso para abrir o motor de peças.</>
          : 'Esta tarefa é uma peça sem vínculo. Ligue-a a um cliente ou caso para o SIMAS ajudar a gerar a peça.'}
      </p>

      {/* Caminho honesto: cliente sem nenhum caso → criar caso. */}
      {modo === 'com-cliente' && semCasos && !carregando ? (
        <div className="mt-2 text-sm">
          <p className="text-muted-foreground">Este cliente ainda não tem um caso.</p>
          {criarCasoHref && (
            <a
              href={criarCasoHref}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <FolderPlus className="h-4 w-4" />
              Criar caso para este cliente
            </a>
          )}
        </div>
      ) : abrindo ? (
        <div className="mt-2">
          <VinculoPicker
            value={null}
            onChange={vincular}
            label={modo === 'com-cliente' ? 'Escolha o caso' : 'Cliente, caso ou processo'}
            hintOpcional={false}
            tipos={modo === 'com-cliente' ? ['atendimento'] : undefined}
            clienteId={modo === 'com-cliente' ? (clienteId ?? undefined) : undefined}
            sugestoes={sugestoes}
          />
          {salvando && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Vinculando…
            </p>
          )}
        </div>
      ) : (
        <Button
          size="sm"
          className="mt-2"
          onClick={() => setAbrindo(true)}
          disabled={carregando}
        >
          {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          {modo === 'com-cliente' ? 'Vincular ao caso para gerar a peça' : 'Vincular cliente ou caso'}
        </Button>
      )}
    </div>
  )
}
