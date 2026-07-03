'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { SeletorCliente } from '@/components/atendimento/SeletorCliente'
import { GravadorAudio } from '@/components/atendimento/GravadorAudio'
import { UploadAudioTranscricao } from '@/components/atendimento/UploadAudioTranscricao'
import { TranscricaoActions } from '@/components/atendimento/TranscricaoActions'
import type { ResultadoAnaliseGeral } from '@/app/api/ia/analise-geral/route'
import { MicrofoneInline } from '@/components/atendimento/MicrofoneInline'
import { UploadDocumentos } from '@/components/atendimento/UploadDocumentos'
import { SeletorVersaoIA } from '@/components/atendimento/SeletorVersaoIA'
import { VERSAO_IA_PADRAO, type VersaoIA } from '@/lib/anthropic/versoes'
import { Select } from '@/components/ui/select'
import { AREAS } from '@/lib/constants/areas'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import {
  Users, MessageSquare, Mic, Keyboard, Brain, Loader2, Save,
  AlertTriangle, CheckCircle, Clock, ArrowRight, FileText, HelpCircle,
  Printer, Mail, Paperclip,
} from 'lucide-react'
import { ChatDiagnostico } from '@/components/atendimento/ChatDiagnostico'

const COR_URGENCIA: Record<string, string> = {
  alta:  'border-destructive/20 bg-destructive/5 text-destructive',
  media: 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200',
  baixa: 'border-success/20 bg-success/5 text-success',
}
const ICONE_URGENCIA: Record<string, React.ComponentType<{ className?: string }>> = {
  alta:  AlertTriangle,
  media: Clock,
  baixa: CheckCircle,
}

const LABEL_RELEVANCIA: Record<string, string> = {
  principal:  'Área principal',
  secundaria: 'Área relacionada',
}

// Áreas ativas — fonte única em areas.ts (campo `ativo`). Evita lista desatualizada.
const AREAS_ATIVAS: string[] = Object.values(AREAS).filter((a) => a.ativo).map((a) => a.id)

export function AnaliseCasoClient({ atendimentoIdInicial }: { atendimentoIdInicial?: string }) {
  const router   = useRouter()
  const pathname = usePathname()
  const { success, error: toastError } = useToast()

  const [cliente,          setCliente]          = useState<{ id: string; nome: string } | null>(null)
  const [modoInput,        setModoInput]        = useState<'audio' | 'texto'>('audio')
  const [comClientePresente, setComClientePresente] = useState(true)
  const [textoRelato,      setTextoRelato]      = useState('')
  const [transcricao,      setTranscricao]      = useState('')
  const [pedido,           setPedido]           = useState('')
  const [versaoIA,         setVersaoIA]         = useState<VersaoIA>(VERSAO_IA_PADRAO)
  const [analisando,       setAnalisando]       = useState(false)
  const [resultado,        setResultado]        = useState<ResultadoAnaliseGeral | null>(null)
  const [atendimentoId,    setAtendimentoId]    = useState<string | null>(atendimentoIdInicial ?? null)
  const [analise_id,       setAnaliseId]        = useState<string | null>(null)
  const [carregando,       setCarregando]       = useState(!!atendimentoIdInicial)
  const [salvando,         setSalvando]         = useState(false)
  const [documentosExistentes, setDocumentosExistentes] = useState<Array<{ id: string; file_name: string; tipo: string; texto_extraido?: string }>>([])
  // Anexo de resumo/transcrição no modo "Digitar": o texto extraído entra no relato (e na análise)
  const arquivoTextoRef = useRef<HTMLInputElement>(null)
  const [extraindoArquivo, setExtraindoArquivo] = useState(false)

  async function anexarArquivoTexto(file: File) {
    setExtraindoArquivo(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/extrair-texto', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Erro', data.error ?? 'Não foi possível ler o arquivo')
        return
      }
      const extraido = String(data.texto ?? '').trim()
      if (!extraido) {
        const detalhe = data.erro ? ` (${data.erro})` : ''
        toastError('Sem texto', `Não foi encontrado texto extraível no arquivo${detalhe}.`)
        return
      }
      // Limita p/ não estourar o contexto da análise (arquivos muito grandes)
      const MAX = 40_000
      const trecho = extraido.length > MAX ? extraido.slice(0, MAX) : extraido
      setTextoRelato(prev => {
        const cabecalho = `--- Conteúdo de ${file.name} ---\n`
        return prev.trim() ? `${prev.trim()}\n\n${cabecalho}${trecho}` : `${cabecalho}${trecho}`
      })
      success(
        'Arquivo anexado',
        extraido.length > MAX
          ? 'Texto adicionado ao relato (arquivo grande — usei o início do conteúdo).'
          : 'Texto adicionado ao relato e será usado na análise.',
      )
    } catch {
      toastError('Erro', 'Falha de rede ao processar o arquivo')
    } finally {
      setExtraindoArquivo(false)
      if (arquivoTextoRef.current) arquivoTextoRef.current.value = ''
    }
  }

  // Atualizar URL com atendimentoId sem navegar (preserva resultado ao voltar)
  const atualizarUrl = useCallback((id: string) => {
    const url = `${pathname}?atendimentoId=${id}`
    window.history.replaceState(null, '', url)
  }, [pathname])

  // Carregar atendimento existente quando atendimentoIdInicial é fornecido
  useEffect(() => {
    if (!atendimentoIdInicial) return
    let cancelado = false
    setCarregando(true)
    fetch(`/api/atendimentos/${atendimentoIdInicial}`)
      .then(r => r.json())
      .then(data => {
        if (cancelado) return
        const at = data.atendimento
        if (!at) return
        if (at.clientes) setCliente({ id: at.clientes.id, nome: at.clientes.nome })
        // Carregar transcrição (editada ou raw como fallback)
        const texto = at.transcricao_editada ?? at.transcricao_raw ?? ''
        if (texto) {
          setTextoRelato(texto)
          setTranscricao(texto)
        }
        if (at.pedidos_especificos) setPedido(at.pedidos_especificos)
        setModoInput(at.modo_input === 'texto' ? 'texto' : 'audio')
        // Carregar documentos existentes
        if (at.documentos) setDocumentosExistentes(at.documentos)
        // Carregar diagnóstico salvo
        const analises = at.analises as Array<{ id: string; plano_a: ResultadoAnaliseGeral }> | undefined
        if (analises && analises.length > 0 && analises[0].plano_a) {
          setResultado(analises[0].plano_a)
          setAnaliseId(analises[0].id)
        }
      })
      .catch(() => { /* silencioso */ })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [atendimentoIdInicial])

  // Criar atendimento ao selecionar cliente (área 'geral')
  const handleClienteSelecionado = useCallback(async (c: { id: string; nome: string } | null) => {
    if (!c) { setCliente(null); setAtendimentoId(null); return }
    setCliente(c)
    if (!atendimentoId) {
      try {
        const res = await fetch('/api/atendimentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliente_id: c.id, area: 'geral', modo_input: modoInput === 'texto' ? 'texto' : 'audio' }),
        })
        const data = await res.json()
        if (data.id) {
          setAtendimentoId(data.id)
          atualizarUrl(data.id)
        }
      } catch {
        // Silencioso — análise funciona sem atendimento salvo
      }
    }
  }, [atendimentoId, modoInput, atualizarUrl])

  const handleTranscricao = useCallback((texto: string) => {
    setTranscricao(texto)
    setTextoRelato(texto)
    success('Áudio transcrito', 'Revise o texto e clique em Analisar Caso')
  }, [success])

  async function analisar() {
    const texto = textoRelato.trim()
    if (!texto) {
      toastError('Atenção', 'Descreva o caso antes de analisar')
      return
    }

    setAnalisando(true)
    setResultado(null)
    try {
      // Garantir que existe um atendimento para salvar a análise
      let aidAtual = atendimentoId
      if (!aidAtual && cliente) {
        try {
          const resAt = await fetch('/api/atendimentos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cliente_id: cliente.id, area: 'geral', modo_input: modoInput === 'texto' ? 'texto' : 'audio' }),
          })
          const dataAt = await resAt.json()
          if (dataAt.id) {
            aidAtual = dataAt.id
            setAtendimentoId(dataAt.id)
            atualizarUrl(dataAt.id)
          }
        } catch { /* continua mesmo sem atendimento */ }
      }

      const res = await fetch('/api/ia/analise-geral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcricao: texto, pedidoEspecifico: pedido, atendimentoId: aidAtual, versao: versaoIA }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro na análise', data.error ?? 'Tente novamente')
        return
      }
      const { analise_id: aid, ...resultado } = data
      setResultado(resultado as ResultadoAnaliseGeral)
      if (aid) setAnaliseId(aid)

      // Salvar transcrição/pedido no atendimento para persistir ao recarregar
      if (aidAtual) {
        fetch(`/api/atendimentos/${aidAtual}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcricao_editada: texto,
            pedidos_especificos: pedido || undefined,
            modo_input: modoInput === 'texto' ? 'texto' : 'audio',
          }),
        }).catch(() => {})
      }

      success('Análise concluída!', 'Veja o resultado abaixo.')
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setAnalisando(false)
    }
  }

  async function salvar() {
    if (!atendimentoId) return
    setSalvando(true)
    try {
      await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcricao_editada: textoRelato,
          pedidos_especificos: pedido,
          modo_input: modoInput === 'texto' ? 'texto' : 'audio',
        }),
      })
      success('Salvo!', 'Dados do atendimento atualizados')
    } catch {
      toastError('Erro', 'Não foi possível salvar')
    } finally {
      setSalvando(false)
    }
  }

  // Persiste o relato/pedido atuais no atendimento antes de navegar (best-effort)
  async function salvarRelatoAtual() {
    if (atendimentoId && textoRelato.trim()) {
      try {
        await fetch(`/api/atendimentos/${atendimentoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcricao_editada: textoRelato,
            pedidos_especificos: pedido,
            modo_input: modoInput === 'texto' ? 'texto' : 'audio',
          }),
        })
      } catch {
        // Silencioso — navega mesmo assim
      }
    }
  }

  // Gera a peça direto a partir do estudo, levando o contexto do caso (atendimentoId)
  async function gerarPecaDireto(area: string, tipo: string) {
    await salvarRelatoAtual()
    router.push(atendimentoId ? `/${area}/pecas/${tipo}?id=${atendimentoId}` : `/${area}/pecas/${tipo}`)
  }

  // Caminho opcional: aprofundar a análise (parecer/estratégia) na área
  async function aprofundarConsultoria(area: string) {
    await salvarRelatoAtual()
    router.push(atendimentoId ? `/${area}/consultoria?atendimentoId=${atendimentoId}` : `/${area}/consultoria`)
  }

  const podeAnalisar = textoRelato.trim().length > 20

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* 1. Cliente (opcional) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-muted-foreground" />
            Cliente
            <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SeletorCliente
            onSelecionado={handleClienteSelecionado}
            clienteSelecionado={cliente}
          />
        </CardContent>
      </Card>

      {/* 2. Relato */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            Relato de Caso | Atendimento Cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Tabs: 2 modos */}
          <div className="flex rounded-lg border bg-muted/50 p-1 gap-1">
            <button
              onClick={() => setModoInput('audio')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                modoInput === 'audio' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Mic className="h-4 w-4" />
              Áudio
            </button>
            <button
              onClick={() => setModoInput('texto')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                modoInput === 'texto' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Keyboard className="h-4 w-4" />
              Digitar
            </button>
          </div>

          {modoInput === 'audio' && (
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={comClientePresente}
                  onChange={(e) => setComClientePresente(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-primary"
                />
                Gravação <strong className="font-semibold text-foreground">com o cliente presente</strong> — solicita o consentimento LGPD antes de gravar
              </label>
              <GravadorAudio
                onTranscricao={handleTranscricao}
                atendimentoId={atendimentoId}
                disabled={false}
                requerConsentimento={comClientePresente}
              />

              {/* Separador */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">ou envie um arquivo de áudio</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Upload de arquivo de áudio */}
              <UploadAudioTranscricao
                onTranscricao={handleTranscricao}
                atendimentoId={atendimentoId}
                disabled={false}
              />

              {transcricao && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">Transcrição (edite se necessário)</span>
                    <TranscricaoActions texto={textoRelato} />
                  </div>
                  <Textarea
                    value={textoRelato}
                    onChange={(e) => setTextoRelato(e.target.value)}
                    rows={8}
                  />
                </div>
              )}
            </div>
          )}

          {modoInput === 'texto' && (
            <div className="space-y-3">
              <Textarea
                label="Descreva o caso do cliente"
                value={textoRelato}
                onChange={(e) => setTextoRelato(e.target.value)}
                placeholder="Ex.: Cliente trabalhou por 30 anos com carteira assinada, foi demitido sem justa causa e não recebeu todas as verbas rescisórias. Também tem problemas de saúde que podem ter relação com o trabalho..."
                hint="Quanto mais detalhes, mais precisa será a análise da área jurídica"
                rows={8}
              />

              {/* Anexar resumo / transcrição — o texto extraído entra no relato e na análise */}
              <input
                ref={arquivoTextoRef}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) anexarArquivoTexto(f) }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => arquivoTextoRef.current?.click()}
                  disabled={extraindoArquivo}
                  className="gap-1.5"
                >
                  {extraindoArquivo
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Extraindo texto…</>
                    : <><Paperclip className="h-4 w-4" /> Anexar resumo / transcrição</>}
                </Button>
                <span className="text-xs text-muted-foreground">
                  PDF, DOCX ou TXT — o conteúdo é adicionado ao relato e usado na análise
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Questão específica */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <HelpCircle className="h-5 w-5 text-muted-foreground" />
            Questão específica
            <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            label="Há alguma dúvida ou foco específico?"
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            placeholder="Ex.: Quero saber se vale a pena entrar com ação judicial ou resolver administrativamente primeiro"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Ou dite:</span>
            <MicrofoneInline
              onTranscricao={(t) => setPedido(prev => prev ? prev + ' ' + t : t)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Documentos (só quando há atendimento) */}
      {atendimentoId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-muted-foreground" />
              Documentos
              {documentosExistentes.length > 0 && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">({documentosExistentes.length} anexados)</span>
              )}
              {documentosExistentes.length === 0 && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UploadDocumentos
              atendimentoId={atendimentoId}
              tiposDocumento={['rg_cpf', 'comprovante_residencia', 'cnis', 'ctps', 'outro']}
              documentosIniciais={documentosExistentes}
            />
          </CardContent>
        </Card>
      )}


      {/* Versão da IA + Botões: Salvar + Analisar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Versão da IA para a análise</p>
          <SeletorVersaoIA value={versaoIA} onChange={setVersaoIA} disabled={analisando} />
        </div>
        <div className="flex justify-end gap-3">
        {atendimentoId && (
          <Button
            size="lg"
            variant="secondary"
            onClick={salvar}
            disabled={salvando || analisando}
            className="gap-2"
          >
            {salvando ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
            ) : (
              <><Save className="h-4 w-4" /> Salvar</>
            )}
          </Button>
        )}
        <Button
          size="lg"
          onClick={analisar}
          disabled={!podeAnalisar || analisando}
          className="gap-2 bg-primary/80 hover:bg-primary min-w-52"
        >
          {analisando ? (
            <><Loader2 className="h-5 w-5 animate-spin" /> Analisando... (até 30s)</>
          ) : (
            <><Brain className="h-5 w-5" /> Analisar Caso</>
          )}
        </Button>
        </div>
      </div>

      {/* 4. Resultado */}
      {resultado && (
        <div className="space-y-4 rounded-2xl border-2 border-primary/20 bg-primary/5 p-6">
          <h2 className="text-xl font-bold text-foreground">Resultado da Análise</h2>

          {/* Urgência */}
          {resultado.urgencia && (
            <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${COR_URGENCIA[resultado.urgencia] ?? COR_URGENCIA.media}`}>
              {(() => {
                const Icone = ICONE_URGENCIA[resultado.urgencia] ?? Clock
                return <Icone className="mt-0.5 h-5 w-5 shrink-0" />
              })()}
              <div>
                <p className="font-semibold capitalize">
                  Urgência {resultado.urgencia}
                  {resultado.classificacao_provavel && ` — ${resultado.classificacao_provavel}`}
                </p>
                <p className="mt-0.5 text-sm">{resultado.justificativa_urgencia}</p>
              </div>
            </div>
          )}

          {/* Resumo */}
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm font-semibold text-muted-foreground mb-1">Resumo do caso</p>
              <p className="text-foreground leading-relaxed">{resultado.resumo_caso}</p>
            </CardContent>
          </Card>

          {/* Áreas identificadas */}
          {resultado.areas_identificadas?.length > 0 && (
            <div>
              <p className="mb-3 text-sm font-semibold text-muted-foreground">
                Área(s) do Direito identificadas
              </p>
              <div className="space-y-2">
                {resultado.areas_identificadas.map((a) => {
                  const ativa = AREAS_ATIVAS.includes(a.area)
                  return (
                    <div
                      key={a.area}
                      className="flex flex-col gap-2 rounded-xl border-2 border-border bg-card p-4 sm:flex-row sm:items-center"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{a.nome}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            a.relevancia === 'principal'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {LABEL_RELEVANCIA[a.relevancia] ?? a.relevancia}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{a.justificativa}</p>
                      </div>
                      {ativa && (
                        <AcoesGerarPeca
                          areaId={a.area}
                          onGerar={gerarPecaDireto}
                          onAprofundar={aprofundarConsultoria}
                        />
                      )}
                      {!ativa && (
                        <span className="shrink-0 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                          Em breve no sistema
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Recomendação */}
          {resultado.recomendacao_imediata && (
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" />
                  Recomendação imediata
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <p className="text-foreground leading-relaxed">{resultado.recomendacao_imediata}</p>
              </CardContent>
            </Card>
          )}

          {/* Chat com IA sobre o diagnóstico */}
          <ChatDiagnostico
            diagnostico={resultado as unknown as Record<string, unknown>}
            transcricao={textoRelato}
            pedidoEspecifico={pedido}
          />

          {/* Mais detalhes (secundários, recolhidos por padrão) */}
          {(resultado.documentos_solicitar?.length > 0 || resultado.perguntas_ao_cliente?.length > 0 || resultado.observacoes) && (
          <details className="rounded-xl border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-foreground hover:text-primary">
              ▸ Mais detalhes — documentos a solicitar, perguntas ao cliente, observações
            </summary>
            <div className="space-y-4 px-4 pb-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {resultado.documentos_solicitar?.length > 0 && (
              <Card>
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Documentos a solicitar
                    </span>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const conteudo = resultado.documentos_solicitar
                            .map((d, i) => `${i + 1}. ${d}`)
                            .join('\n')
                          const win = window.open('', '_blank', 'width=600,height=500')
                          if (!win) return
                          win.document.write(`
                            <html><head><title>Documentos a solicitar</title>
                            <style>body{font-family:Arial,sans-serif;padding:32px;font-size:14px}
                            h2{margin-bottom:16px;font-size:18px}
                            li{margin-bottom:6px}
                            @media print{button{display:none}}</style></head>
                            <body>
                            <h2>Documentos a solicitar${cliente ? ` — ${cliente.nome}` : ''}</h2>
                            <ol>${resultado.documentos_solicitar.map(d => `<li>${d}</li>`).join('')}</ol>
                            <br><button onclick="window.print()">Imprimir</button>
                            </body></html>
                          `)
                          win.document.close()
                          win.focus()
                          win.print()
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
                        title="Imprimir lista"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const lista = resultado.documentos_solicitar
                            .map((d, i) => `${i + 1}. ${d}`)
                            .join('\n')
                          const assunto = encodeURIComponent('Documentos necessários para o seu caso')
                          const corpo = encodeURIComponent(
                            `Prezado(a)${cliente ? ` ${cliente.nome}` : ''},\n\nSegue a lista de documentos necessários para dar andamento ao seu caso:\n\n${lista}\n\nPor favor, providencie os documentos listados acima o mais breve possível.\n\nAtenciosamente.`
                          )
                          const mailto = `mailto:?subject=${assunto}&body=${corpo}`
                          window.open(mailto, '_self')
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
                        title="Enviar por e-mail"
                      >
                        <Mail className="h-4 w-4" />
                      </button>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <ul className="space-y-1.5">
                    {resultado.documentos_solicitar.map((doc, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        {doc}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {resultado.perguntas_ao_cliente?.length > 0 && (
              <Card>
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    Perguntas ao cliente
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <ul className="space-y-1.5">
                    {resultado.perguntas_ao_cliente.map((q, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                        <span className="mt-0.5 shrink-0 font-bold text-primary">{i + 1}.</span>
                        {q}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Observações */}
          {resultado.observacoes && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-1">Observações</p>
              <p className="text-sm text-warning">{resultado.observacoes}</p>
            </div>
          )}
            </div>
          </details>
          )}

          {/* Nova análise */}
          <div className="pt-2 flex justify-end">
            <button
              onClick={() => { setResultado(null); setTextoRelato(''); setTranscricao(''); setPedido('') }}
              className="text-sm font-medium text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Nova análise
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Ações por área no resultado do Estudo: escolher o tipo de peça e gerar direto
// (caminho principal), ou aprofundar a análise/parecer (opcional).
function AcoesGerarPeca({
  areaId,
  onGerar,
  onAprofundar,
}: {
  areaId: string
  onGerar: (area: string, tipo: string) => void
  onAprofundar: (area: string) => void
}) {
  const pecas = ((AREAS as Record<string, { pecas?: readonly string[] }>)[areaId]?.pecas ?? []) as readonly string[]
  const tipoPadrao = pecas.includes('peticao_inicial') ? 'peticao_inicial' : (pecas[0] ?? '')
  const [tipo, setTipo] = useState(tipoPadrao)

  // Sem peças mapeadas para a área: oferece apenas o caminho de análise
  if (pecas.length === 0) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAprofundar(areaId)}
        className="shrink-0 gap-1.5"
      >
        Aprofundar análise
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    )
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:w-72 sm:shrink-0">
      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <Select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            options={pecas.map((p) => ({ value: p, label: TIPOS_PECA[p]?.nome ?? p }))}
          />
        </div>
        <Button size="sm" onClick={() => onGerar(areaId, tipo)} className="gap-1.5">
          Gerar peça
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <button
        onClick={() => onAprofundar(areaId)}
        className="self-end text-xs font-medium text-muted-foreground hover:text-primary underline underline-offset-2"
      >
        ou aprofundar análise (parecer)
      </button>
    </div>
  )
}
