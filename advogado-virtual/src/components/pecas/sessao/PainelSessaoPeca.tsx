'use client'

// O painel da SESSÃO DE LAPIDAÇÃO (F0.4) — a conversa com o agente ao lado da
// peça, dentro do SIMAS.
//
// O estado vem de fora (useSessaoPeca, no EditorPecaClient): o painel é a
// tela da sessão, não a dona dela. É isso que permite fechá-lo, remontar o
// editor depois de aplicar uma proposta e continuar a mesma conversa.

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { BarraCusto } from './BarraCusto'
import { CardProposta } from './CardProposta'
import { Composer } from './Composer'
import { ListaTurnos } from './ListaTurnos'
import type { SessaoPecaControle, VersaoSessao } from './useSessaoPeca'
import {
  AlertTriangle,
  History,
  Loader2,
  MoreVertical,
  RefreshCw,
  Sparkles,
} from 'lucide-react'

function dataCurta(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function PainelSessaoPeca({
  sessao: s,
  conteudoAtual,
  temCaso,
  onAplicada,
}: {
  sessao: SessaoPecaControle
  /** Peça como está salva — base do diff da proposta. */
  conteudoAtual: string
  /** Peça ligada a um atendimento: sem isso não há dossiê para anexos. */
  temCaso: boolean
  onAplicada: (versao: number | null) => void
}) {
  const { error: toastError, success, info } = useToast()
  const [menuAberto, setMenuAberto] = useState(false)
  const [versaoNova, setVersaoNova] = useState<VersaoSessao>('padrao')
  const [abrindo, setAbrindo] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuAberto) return
    const fora = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [menuAberto])

  async function abrirSessaoNova() {
    setAbrindo(true)
    try {
      const ok = await s.criarSessao(versaoNova)
      if (ok) success('Sessão aberta', 'Descreva o ajuste que a peça precisa — o agente lê o caso e propõe.')
    } finally {
      setAbrindo(false)
    }
  }

  async function anexar(arquivo: File) {
    const r = await s.anexar(arquivo)
    if (!r.ok) {
      toastError('Não foi possível anexar', r.erro ?? 'Tente novamente.')
      return
    }
    info(
      'Documento anexado',
      r.grande
        ? 'Documento extenso: entra na próxima rodada como resumo, com a íntegra sob demanda.'
        : 'Ele entra no material desta sessão a partir da próxima rodada.',
    )
  }

  const emRodada = s.estado === 'enviando' || s.estado === 'streaming'
  const semSessao = !s.sessao
  const encerrada = s.encerrada

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Cabeçalho — o pr-12 abre espaço para o botão de recolher/fechar que o
          DocumentEditor desenha flutuando no canto. */}
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-2.5 pr-12">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Lapidação com IA
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {semSessao
              ? 'A IA propõe, você aplica seção por seção.'
              : encerrada
                ? 'Sessão encerrada — leitura.'
                : `${s.sessao?.effort === 'high' ? 'Raciocínio estendido' : 'Padrão'} · aberta em ${dataCurta(s.sessao!.criada_em)}`}
          </p>
        </div>

        {!semSessao && (
          <div className="relative shrink-0" ref={menuRef}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => setMenuAberto((v) => !v)}
              title="Mais ações"
              aria-label="Mais ações da sessão"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
            {menuAberto && (
              <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-border bg-card p-1.5 shadow-elevated">
                <button
                  onClick={() => {
                    setMenuAberto(false)
                    s.fecharSessao()
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <History className="h-3.5 w-3.5" />
                  Ver sessões desta peça
                </button>
                <button
                  onClick={() => {
                    setMenuAberto(false)
                    void s.recarregar()
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Recarregar a sessão
                </button>
                {!encerrada && (
                  <button
                    onClick={async () => {
                      setMenuAberto(false)
                      if (!window.confirm('Encerrar a sessão? A conversa fica salva para consulta, mas não aceita novas rodadas.')) return
                      if (await s.encerrar()) success('Sessão encerrada', 'A conversa continua disponível para leitura.')
                    }}
                    disabled={s.ocupado}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Encerrar sessão
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Corpo */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {s.carregando ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Carregando a sessão...
          </div>
        ) : semSessao ? (
          <AberturaDeSessao
            versao={versaoNova}
            onVersao={setVersaoNova}
            onAbrir={abrirSessaoNova}
            abrindo={abrindo}
            sessoes={s.sessoes}
            onAbrirExistente={(id) => void s.abrirSessao(id)}
          />
        ) : (
          <ListaTurnos
            turnos={s.turnos}
            parcial={s.parcial}
            instrucaoEmVoo={s.instrucaoEmVoo}
            pensando={emRodada}
            reconectando={s.reconectando}
          />
        )}
      </div>

      {/* Proposta pendente: fica fixa acima do composer para nunca "subir" com
          a rolagem da conversa e ser esquecida. */}
      {s.propostaPendente && !s.carregando && (
        <div className="shrink-0 border-t border-border px-3 py-2.5">
          <CardProposta
            proposta={s.propostaPendente}
            conteudoAtual={conteudoAtual}
            onDecidir={s.decidir}
            onAplicada={onAplicada}
          />
        </div>
      )}

      {s.erro && !s.reconectando && (
        <div className="flex shrink-0 items-start gap-2 border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{s.erro}</span>
          <button onClick={s.limparErro} className="shrink-0 font-semibold underline underline-offset-2">
            ok
          </button>
        </div>
      )}

      {/* Rodapé */}
      {!semSessao && !s.carregando && (
        <div className="shrink-0">
          <BarraCusto
            custoSessaoUsd={s.custoSessaoUsd}
            custoRodadaUsd={s.custoRodadaUsd}
            estimativa={s.estimativa}
            emRodada={emRodada}
          />
          {encerrada ? (
            <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">Esta sessão está encerrada.</p>
              <Button size="sm" variant="secondary" onClick={() => void s.criarSessao('padrao')} className="gap-1.5">
                <Sparkles className="h-4 w-4" />
                Abrir nova sessão
              </Button>
            </div>
          ) : (
            <Composer
              valor={s.rascunho}
              onChange={s.setRascunho}
              onEnviar={() => {
                const texto = s.rascunho
                s.setRascunho('')
                void s.enviar(texto)
              }}
              onAnexar={(arquivo) => void anexar(arquivo)}
              ocupado={s.ocupado}
              anexando={s.anexando}
              podeAnexar={temCaso}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** Tela de abertura: escolha do modelo (só aqui) e sessões anteriores. */
function AberturaDeSessao({
  versao,
  onVersao,
  onAbrir,
  abrindo,
  sessoes,
  onAbrirExistente,
}: {
  versao: VersaoSessao
  onVersao: (v: VersaoSessao) => void
  onAbrir: () => void
  abrindo: boolean
  sessoes: SessaoPecaControle['sessoes']
  onAbrirExistente: (id: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/30 p-3">
        <p className="text-sm leading-relaxed text-foreground">
          Converse com o agente sobre <strong className="font-semibold">esta peça</strong>, com o dossiê do caso à mão.
          Cada rodada volta como proposta por seção — o texto só muda quando você aplica.
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modelo da sessão</p>
        <div className="grid grid-cols-2 gap-2">
          <OpcaoVersao
            ativa={versao === 'padrao'}
            onClick={() => onVersao('padrao')}
            titulo="Padrão"
            descricao="Rápido e econômico. Serve para a maioria das rodadas."
          />
          <OpcaoVersao
            ativa={versao === 'avancado'}
            onClick={() => onVersao('avancado')}
            titulo="Raciocínio estendido"
            descricao="Mais lento e mais caro. Para teses difíceis e revisão crítica."
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          A escolha vale para a sessão inteira — trocar no meio jogaria fora o cache do dossiê.
        </p>
      </div>

      <Button onClick={onAbrir} disabled={abrindo} className="w-full gap-1.5" size="sm">
        {abrindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {abrindo ? 'Abrindo...' : 'Abrir sessão de lapidação'}
      </Button>

      {sessoes.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" />
            Sessões anteriores
          </p>
          <ul className="space-y-1">
            {sessoes.map((sessao) => (
              <li key={sessao.id}>
                <button
                  onClick={() => onAbrirExistente(sessao.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="truncate text-xs text-foreground">{dataCurta(sessao.criada_em)}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {sessao.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function OpcaoVersao({
  ativa,
  onClick,
  titulo,
  descricao,
}: {
  ativa: boolean
  onClick: () => void
  titulo: string
  descricao: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ativa}
      className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
        ativa ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
      }`}
    >
      <p className={`text-xs font-semibold ${ativa ? 'text-primary' : 'text-foreground'}`}>{titulo}</p>
      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{descricao}</p>
    </button>
  )
}
