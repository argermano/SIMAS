'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, FilePen, FolderPlus, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { AREAS } from '@/lib/constants/areas'
import { VinculoPicker, type VinculoSelecionado } from './VinculoPicker'
import { nomeProvavelDoTitulo } from '@/lib/tarefas/titulo-nome'

// Assistente de vínculo do "Resolver" para tarefa de PEÇA sem caso. Substitui o
// botão morto/dossiê por AJUDA ATIVA:
//   a) COM cliente/processo → 1 clique "Criar caso e gerar a peça": infere a
//      área pelos dados (chip "Caso novo em Cível — trocar?") e leva ao motor.
//      Havendo casos do cliente, o caminho manual (escolher caso existente)
//      continua disponível como secundário.
//   b) SEM vínculo nenhum → liga cliente/caso com SUGESTÕES por nome (do título).
// IA prepara, humano executa: aqui o humano confirma a área e conduz o motor;
// nada gera peça sozinho e o caso criado é REAL e auditado.

interface VinculoAssistenteProps {
  taskId:       string
  titulo:       string
  clienteId:    string | null
  clienteNome:  string | null
  processoId:   string | null
  /** Pré-criação disponível (há cliente/processo, mas nenhum caso). */
  podeCriarCaso?:    boolean
  /** Área inferida pelos dados do processo (id de AREAS) + confiança. */
  areaInferida?:     string | null
  areaInferidaNome?: string | null
  confiancaArea?:    'alta' | 'baixa' | null
  /** Chamado após vincular quando NÃO há navegação (o modal recarrega a ação). */
  onVinculado:  () => void
}

const AREA_OPTIONS = Object.values(AREAS)
  .filter((a) => a.ativo)
  .map((a) => ({ value: a.id, label: a.nome }))

export function VinculoAssistente({
  taskId, titulo, clienteId, clienteNome,
  podeCriarCaso, areaInferida, areaInferidaNome, confiancaArea,
  onVinculado,
}: VinculoAssistenteProps) {
  const router = useRouter()
  const { toast, error: toastError } = useToast()

  // Pré-criação em 1 clique quando há cliente (o caso nasce ligado ao cliente e,
  // se houver, ao processo). Sem cliente → cai no fluxo de vínculo por nome.
  const modoCriar = !!podeCriarCaso && !!clienteId

  const [sugestoes, setSugestoes] = useState<VinculoSelecionado[]>([])
  const [carregando, setCarregando] = useState(true)
  const [abrindo,   setAbrindo]   = useState(false) // picker de caso existente visível
  const [salvando,  setSalvando]  = useState(false)
  const seqRef = useRef(0)

  // Estado da pré-criação: confiança baixa já revela o select (a UI pede a área);
  // "trocar?" revela mesmo quando a inferência veio 'alta'.
  const [trocando, setTrocando] = useState(false)
  const [areaSel,  setAreaSel]  = useState<string>(areaInferida ?? 'civel')
  const [criando,  setCriando]  = useState(false)
  useEffect(() => { setAreaSel(areaInferida ?? 'civel'); setTrocando(false) }, [taskId, areaInferida])

  const mostrarSelect = confiancaArea === 'baixa' || trocando

  // Pré-carrega os casos do cliente (para oferecer "escolher caso existente") ou,
  // sem cliente, matches por nome do título (fluxo de vínculo).
  useEffect(() => {
    const seq = ++seqRef.current
    setCarregando(true)
    setSugestoes([])
    ;(async () => {
      try {
        let url: string | null = null
        if (clienteId) {
          url = `/api/tarefas/vinculos?clienteId=${encodeURIComponent(clienteId)}&tipos=atendimento`
        } else {
          const nome = nomeProvavelDoTitulo(titulo)
          url = nome ? `/api/tarefas/vinculos?q=${encodeURIComponent(nome)}` : null
        }
        if (!url) return
        const r = await fetch(url)
        const d = await r.json().catch(() => ({}))
        if (seq !== seqRef.current) return
        setSugestoes((d.resultados ?? []) as VinculoSelecionado[])
      } finally {
        if (seq === seqRef.current) setCarregando(false)
      }
    })()
  }, [taskId, clienteId, titulo])

  // 1 clique: cria o caso (área explícita quando o usuário escolheu) e navega ao
  // motor de peças. Toast com o link do caso criado (registro real e auditado).
  async function criarCaso() {
    setCriando(true)
    try {
      const enviarArea = mostrarSelect ? areaSel : undefined
      const res = await fetch(`/api/tasks/${taskId}/criar-caso`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(enviarArea ? { area: enviarArea } : {}),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Erro', d.error ?? 'Não foi possível criar o caso')
        return
      }
      const casoHref = clienteId && d.casoId ? `/clientes/${clienteId}/casos/${d.casoId}` : undefined
      toast({
        type: 'success',
        title: 'Caso criado',
        message: `Caso em ${d.areaNome ?? 'jurídico'} aberto — abrindo o motor de peças.`,
        href: casoHref,
      })
      onVinculado()
      if (d.hrefMotor) { router.push(d.hrefMotor as string); return }
      if (casoHref) router.push(casoHref)
    } finally {
      setCriando(false)
    }
  }

  // Escolher um CASO EXISTENTE (caminho manual): vincula e abre o motor.
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

  return (
    <div className="mx-6 mb-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <FilePen className="h-4 w-4 text-primary" />
        Vincule ao caso para gerar a peça
      </p>

      {modoCriar ? (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {clienteNome ? <>Esta peça é de <span className="font-medium text-foreground">{clienteNome}</span> e ainda não tem um caso.</> : 'Esta peça ainda não tem um caso.'}
            {' '}Crie o caso e o SIMAS já abre o motor de peças.
          </p>

          {/* Área inferida + opção de trocar (ou select quando confiança baixa). */}
          <div className="mt-2 rounded-lg border border-primary/20 bg-background/60 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Área do caso
            </div>
            {mostrarSelect ? (
              <div className="mt-1.5">
                <Select
                  options={AREA_OPTIONS}
                  value={areaSel}
                  onChange={(e) => setAreaSel(e.target.value)}
                  disabled={criando}
                />
                {confiancaArea === 'baixa' && (
                  <p className="mt-1 text-xs text-muted-foreground">Não deu para inferir com certeza — confirme a área.</p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm text-foreground">
                Caso novo em <span className="font-semibold">{areaInferidaNome ?? 'Cível'}</span>
                {' '}
                <button
                  type="button"
                  onClick={() => setTrocando(true)}
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  trocar?
                </button>
              </p>
            )}
          </div>

          <Button size="sm" className="mt-2" onClick={criarCaso} disabled={criando}>
            {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
            Criar caso e gerar a peça
          </Button>

          {/* Caminho manual: escolher um caso EXISTENTE do cliente (secundário). */}
          {sugestoes.length > 0 && (
            abrindo ? (
              <div className="mt-3 border-t border-primary/15 pt-2.5">
                <VinculoPicker
                  value={null}
                  onChange={vincular}
                  label="Escolha um caso existente"
                  hintOpcional={false}
                  tipos={['atendimento']}
                  clienteId={clienteId ?? undefined}
                  sugestoes={sugestoes}
                />
                {salvando && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Vinculando…
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAbrindo(true)}
                disabled={criando}
                className="mt-2 block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                ou escolher um caso existente ({sugestoes.length})
              </button>
            )
          )}
        </>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Esta tarefa é uma peça sem vínculo. Ligue-a a um cliente ou caso para o SIMAS ajudar a gerar a peça.
          </p>
          {abrindo ? (
            <div className="mt-2">
              <VinculoPicker
                value={null}
                onChange={vincular}
                label="Cliente, caso ou processo"
                hintOpcional={false}
                sugestoes={sugestoes}
              />
              {salvando && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Vinculando…
                </p>
              )}
            </div>
          ) : (
            <Button size="sm" className="mt-2" onClick={() => setAbrindo(true)} disabled={carregando}>
              {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Vincular cliente ou caso
            </Button>
          )}
        </>
      )}
    </div>
  )
}
