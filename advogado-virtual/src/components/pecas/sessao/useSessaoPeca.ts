'use client'

// Estado da SESSÃO DE LAPIDAÇÃO no navegador (F0.4).
//
// O hook vive no EditorPecaClient, não dentro do painel: assim a conversa
// sobrevive ao remount do editor (que acontece toda vez que uma proposta vira
// versão nova da peça) e o badge de "proposta pendente" existe mesmo com o
// painel fechado.
//
// A VERDADE da sessão é sempre o banco. O stream serve para o advogado ver a
// resposta nascendo; ao fim de cada rodada o hook recarrega o GET e joga fora o
// que acumulou na tela. Por isso uma queda de conexão não perde nada: o
// servidor termina e persiste a rodada mesmo com a aba fechada (rodada.ts), e
// aqui basta voltar a perguntar.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createSSEParser } from '@/lib/sse-parser'
import { subirDocumentoDoCaso } from '@/lib/documentos/upload-cliente'
import type { PropostaPeca, SessaoPeca, TurnoPeca } from '@/lib/ia/sessao/sessoes'

export type EstadoSessao = 'idle' | 'enviando' | 'streaming' | 'aguardando_decisao' | 'erro'

export type VersaoSessao = 'padrao' | 'avancado'

/** Estimativa da próxima rodada (GET da sessão). */
export interface EstimativaSessao {
  custoUsd: number
  tokensEntrada: number
  tokensSaida: number
  base: 'ultima_rodada' | 'caracteres'
  /** A conta ainda não mediu o dossiê — é um piso, não um teto. */
  parcial: boolean
}

/** O que a tela manda ao endpoint de decisão da proposta. */
export interface EntradaDecisaoUI {
  decisoes?: Array<{ titulo: string; decisao: 'aceitar' | 'rejeitar' }>
  aceitarTudo?: boolean
  rejeitarTudo?: boolean
  /** Confirma por cima dos avisos "a peça mudou" / "conteúdo menor". */
  forcar?: boolean
}

export interface ResultadoDecisaoUI {
  ok: boolean
  status?: number
  erro?: string
  detalhes?: Record<string, unknown>
  versao?: number | null
  aceitas?: number
  rejeitadas?: number
}

/** Intervalo e teto da retomada após queda de conexão (5s × 60 ≈ 5 min). */
const POLL_MS = 5_000
const POLL_MAX = 60

async function lerErro(res: Response, padrao: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null
  return data?.error ?? padrao
}

export function useSessaoPeca(params: { pecaId: string; atendimentoId?: string }) {
  const { pecaId, atendimentoId } = params

  const [carregando, setCarregando] = useState(true)
  const [sessoes, setSessoes] = useState<SessaoPeca[]>([])
  const [sessao, setSessao] = useState<SessaoPeca | null>(null)
  const [turnos, setTurnos] = useState<TurnoPeca[]>([])
  const [propostas, setPropostas] = useState<PropostaPeca[]>([])
  const [estimativa, setEstimativa] = useState<EstimativaSessao | null>(null)
  const [estado, setEstado] = useState<EstadoSessao>('idle')
  const [erro, setErro] = useState<string | null>(null)
  /** Resposta do agente enquanto ela ainda está sendo escrita. */
  const [parcial, setParcial] = useState('')
  /** Instrução já enviada e ainda não persistida — a bolha otimista. */
  const [instrucaoEmVoo, setInstrucaoEmVoo] = useState<string | null>(null)
  /** Rascunho do composer: mora aqui para sobreviver ao remount do editor. */
  const [rascunho, setRascunho] = useState('')
  const [anexando, setAnexando] = useState(false)
  const [custoRodadaUsd, setCustoRodadaUsd] = useState(0)
  /** Stream caiu: a rodada continua no servidor e a tela busca o resultado. */
  const [reconectando, setReconectando] = useState(false)

  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  const propostaPendente = [...propostas].reverse().find((p) => p.status === 'pendente') ?? null
  const encerrada = sessao?.status === 'encerrada'

  /** GET da sessão inteira — a fonte da verdade de turnos, propostas e custo. */
  const carregarSessao = useCallback(
    async (sid: string): Promise<{ turnos: TurnoPeca[] } | null> => {
      const res = await fetch(`/api/pecas/${pecaId}/sessao/${sid}`)
      if (!res.ok) return null
      const data = await res.json()
      if (!montado.current) return null
      setSessao(data.sessao as SessaoPeca)
      setTurnos((data.turnos ?? []) as TurnoPeca[])
      setPropostas((data.propostas ?? []) as PropostaPeca[])
      setEstimativa((data.estimativa ?? null) as EstimativaSessao | null)
      return { turnos: (data.turnos ?? []) as TurnoPeca[] }
    },
    [pecaId],
  )

  /** Lista de sessões da peça; abre a ATIVA, se houver. */
  const carregarLista = useCallback(async () => {
    try {
      const res = await fetch(`/api/pecas/${pecaId}/sessao`)
      if (!res.ok) return
      const data = await res.json()
      const lista = (data.sessoes ?? []) as SessaoPeca[]
      if (!montado.current) return
      setSessoes(lista)
      const ativa = lista.find((s) => s.status === 'ativa')
      if (ativa) await carregarSessao(ativa.id)
    } finally {
      if (montado.current) setCarregando(false)
    }
  }, [pecaId, carregarSessao])

  useEffect(() => {
    void carregarLista()
  }, [carregarLista])

  const recarregar = useCallback(async () => {
    if (sessao) await carregarSessao(sessao.id)
    else await carregarLista()
  }, [sessao, carregarSessao, carregarLista])

  /** Abre uma sessão nova (o modelo fica fixo por toda ela). */
  const criarSessao = useCallback(
    async (versao: VersaoSessao = 'padrao'): Promise<boolean> => {
      setErro(null)
      try {
        const res = await fetch(`/api/pecas/${pecaId}/sessao`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versao }),
        })
        const data = await res.json().catch(() => ({}))

        // Já havia uma sessão aberta (outra aba): abre AQUELA em vez de falhar.
        if (res.status === 409 && data?.detalhes?.sessaoId) {
          await carregarSessao(data.detalhes.sessaoId as string)
          await carregarLista()
          return true
        }
        if (!res.ok) {
          setErro((data as { error?: string }).error ?? 'Não foi possível abrir a sessão.')
          setEstado('erro')
          return false
        }

        const nova = data.sessao as SessaoPeca
        setSessoes((prev) => [nova, ...prev])
        await carregarSessao(nova.id)
        setEstado('idle')
        return true
      } catch {
        setErro('Falha de rede ao abrir a sessão.')
        setEstado('erro')
        return false
      }
    },
    [pecaId, carregarSessao, carregarLista],
  )

  const abrirSessao = useCallback(
    async (sid: string) => {
      setErro(null)
      setParcial('')
      await carregarSessao(sid)
    },
    [carregarSessao],
  )

  /** Volta à lista (sem encerrar nada): a sessão continua onde estava. */
  const fecharSessao = useCallback(() => {
    setSessao(null)
    setTurnos([])
    setPropostas([])
    setEstimativa(null)
    setParcial('')
    setErro(null)
    setEstado('idle')
    void carregarLista()
  }, [carregarLista])

  /** Nº de turnos no momento em que o stream caiu (base da retomada). */
  const pollBaseRef = useRef(0)

  /** UMA rodada: envia a instrução e consome o SSE até o fim. */
  const enviar = useCallback(
    async (texto: string) => {
      const instrucao = texto.trim()
      if (!instrucao || !sessao || estado === 'enviando' || estado === 'streaming') return

      setErro(null)
      setParcial('')
      setCustoRodadaUsd(0)
      setInstrucaoEmVoo(instrucao)
      setEstado('enviando')

      const numeroBase = turnos.length

      try {
        const res = await fetch(`/api/pecas/${pecaId}/sessao/${sessao.id}/mensagem`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instrucao }),
        })

        if (!res.ok || !res.body) {
          setErro(await lerErro(res, 'Não foi possível iniciar a rodada.'))
          setEstado('erro')
          setInstrucaoEmVoo(null)
          await recarregar()
          return
        }

        setEstado('streaming')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        const parser = createSSEParser()
        let acumulado = ''
        const falha: { mensagem: string | null } = { mensagem: null }

        const despachar = (ev: { type: string; [k: string]: unknown }) => {
          if (ev.type === 'text') {
            acumulado += (ev.text as string) ?? ''
            setParcial(acumulado)
          } else if (ev.type === 'custo') {
            setCustoRodadaUsd(Number(ev.custoUsd ?? 0))
          } else if (ev.type === 'done') {
            const final = (ev.respostaMarkdown as string) ?? ''
            if (final) {
              acumulado = final
              setParcial(final)
            }
            setCustoRodadaUsd(Number(ev.custoUsd ?? 0))
          } else if (ev.type === 'error') {
            falha.mensagem = (ev.error as string) ?? 'A rodada falhou.'
          }
        }

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          for (const ev of parser.feed(decoder.decode(value, { stream: true }))) despachar(ev)
        }
        for (const ev of parser.flush()) despachar(ev)

        await carregarSessao(sessao.id)
        if (!montado.current) return
        setParcial('')
        setInstrucaoEmVoo(null)
        if (falha.mensagem) {
          setErro(falha.mensagem)
          setEstado('erro')
        } else {
          setEstado('idle')
        }
      } catch {
        // A rodada NÃO foi cancelada: o servidor a termina e a persiste. A tela
        // só perdeu o fio — e volta a buscá-la pelo GET.
        if (!montado.current) return
        setErro('A conexão caiu no meio da rodada. Ela continua rodando no servidor — buscando o resultado...')
        setEstado('erro')
        setParcial('')
        pollBaseRef.current = numeroBase
        setReconectando(true)
      }
    },
    [pecaId, sessao, estado, turnos.length, recarregar, carregarSessao],
  )

  // Retomada após queda: pergunta ao GET até o turno do agente aparecer.
  useEffect(() => {
    if (!reconectando || !sessao) return
    let tentativas = 0
    const timer = setInterval(async () => {
      tentativas++
      const r = await carregarSessao(sessao.id)
      if (!montado.current) return
      if (r && r.turnos.length > pollBaseRef.current + 1) {
        setReconectando(false)
        setErro(null)
        setInstrucaoEmVoo(null)
        setEstado('idle')
      } else if (tentativas >= POLL_MAX) {
        setReconectando(false)
        setErro('A rodada não voltou a tempo. Recarregue a sessão para ver o resultado.')
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [reconectando, sessao, carregarSessao])

  /** Anexa um arquivo do computador: sobe ao dossiê e vincula à sessão. */
  const anexar = useCallback(
    async (arquivo: File): Promise<{ ok: boolean; erro?: string; grande?: boolean }> => {
      if (!sessao) return { ok: false, erro: 'Nenhuma sessão aberta.' }
      if (!atendimentoId) return { ok: false, erro: 'Esta peça não está ligada a um caso.' }

      setAnexando(true)
      try {
        const subido = await subirDocumentoDoCaso({ atendimentoId, arquivo })
        if (!subido.ok) return { ok: false, erro: subido.erro }

        const res = await fetch(`/api/pecas/${pecaId}/sessao/${sessao.id}/anexos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentoId: subido.documento.id }),
        })
        if (!res.ok) return { ok: false, erro: await lerErro(res, 'Não foi possível anexar o documento.') }

        const data = await res.json().catch(() => ({}))
        await carregarSessao(sessao.id)
        return { ok: true, grande: Boolean(data.grande) }
      } catch {
        return { ok: false, erro: 'Falha de rede ao anexar o documento.' }
      } finally {
        if (montado.current) setAnexando(false)
      }
    },
    [pecaId, sessao, atendimentoId, carregarSessao],
  )

  /** Decide a proposta (aceite por seção). É o único caminho que muda a peça. */
  const decidir = useCallback(
    async (propostaId: string, entrada: EntradaDecisaoUI): Promise<ResultadoDecisaoUI> => {
      if (!sessao) return { ok: false, erro: 'Nenhuma sessão aberta.' }
      try {
        const res = await fetch(
          `/api/pecas/${pecaId}/sessao/${sessao.id}/propostas/${propostaId}/decidir`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entrada),
          },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          return {
            ok: false,
            status: res.status,
            erro: (data as { error?: string }).error ?? 'Não foi possível aplicar a decisão.',
            detalhes: (data as { detalhes?: Record<string, unknown> }).detalhes,
          }
        }
        await carregarSessao(sessao.id)
        return {
          ok: true,
          versao: (data.versao ?? null) as number | null,
          aceitas: data.aceitas as number,
          rejeitadas: data.rejeitadas as number,
        }
      } catch {
        return { ok: false, erro: 'Falha de rede ao aplicar a decisão.' }
      }
    },
    [pecaId, sessao, carregarSessao],
  )

  const encerrar = useCallback(async (): Promise<boolean> => {
    if (!sessao) return false
    try {
      const res = await fetch(`/api/pecas/${pecaId}/sessao/${sessao.id}/encerrar`, { method: 'POST' })
      if (!res.ok) {
        setErro(await lerErro(res, 'Não foi possível encerrar a sessão.'))
        return false
      }
      await carregarSessao(sessao.id)
      await carregarLista()
      return true
    } catch {
      setErro('Falha de rede ao encerrar a sessão.')
      return false
    }
  }, [pecaId, sessao, carregarSessao, carregarLista])

  const ocupado = estado === 'enviando' || estado === 'streaming' || reconectando
  const estadoUI: EstadoSessao = ocupado
    ? estado
    : erro
      ? 'erro'
      : propostaPendente
        ? 'aguardando_decisao'
        : 'idle'

  return {
    carregando,
    sessoes,
    sessao,
    turnos,
    propostas,
    propostaPendente,
    estimativa,
    estado: estadoUI,
    erro,
    parcial,
    instrucaoEmVoo,
    rascunho,
    setRascunho,
    anexando,
    reconectando,
    ocupado,
    encerrada,
    custoRodadaUsd,
    custoSessaoUsd: Number(sessao?.custo_lista_usd ?? 0),
    criarSessao,
    abrirSessao,
    fecharSessao,
    enviar,
    anexar,
    decidir,
    encerrar,
    recarregar,
    limparErro: () => setErro(null),
  }
}

export type SessaoPecaControle = ReturnType<typeof useSessaoPeca>
