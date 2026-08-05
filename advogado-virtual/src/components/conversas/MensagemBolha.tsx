'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  Check,
  Download,
  FileText,
  FolderPlus,
  Forward,
  Image as ImageIcon,
  MapPin,
  Mic,
  Pencil,
  Reply,
  RotateCw,
  ScanLine,
  StickyNote,
  User,
  Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { horaCurta } from '@/lib/conversas/formato'
import {
  classificarFalhaAudio,
  decidirPlayerAudio,
  mimeAudioDoAnexo,
  pareceAudio,
} from '@/lib/conversas/audio'
import { anexoEncaminhavel } from '@/lib/conversas/encaminhar'
import { autorCitacao, podeResponder, resumoCitacao } from '@/lib/conversas/citacao'
import { podeEditar, restanteEdicaoMs } from '@/lib/conversas/edicao'
import { baixarArquivo, mensagemErroDownload } from '@/lib/download'
import { useToast } from '@/components/ui/toast'
import type { Anexo, Mensagem } from '@/lib/conversas/tipos'
import { BlocoCitacao } from './BlocoCitacao'
import { ComprovanteModal } from './ComprovanteModal'
import { EncaminharModal } from './EncaminharModal'
import { SalvarNoClienteModal } from './SalvarNoClienteModal'

// Player ogv (WASM) carregado SOB DEMANDA: só entra no bundle quando um navegador
// que não toca Ogg nativamente (Safari) precisa dele. ssr:false — depende do DOM.
const AudioOgvPlayer = dynamic(() => import('./AudioOgvPlayer'), { ssr: false })

/** Encaminhável: tudo que tem BINÁRIO — imagem, arquivo (pdf/doc), vídeo e áudio.
 * A regra é pura e testada em lib/conversas/encaminhar; aqui só o adaptador. */
function podeEncaminhar(a: Anexo): boolean {
  return anexoEncaminhavel(a.tipo)
}

/** Nome default do arquivo ao salvar: último segmento da URL do anexo (o servidor
 * cai em 'anexo' se vier vazio). */
function nomeDoAnexo(a: Anexo): string {
  try {
    const p = new URL(a.url).pathname
    return decodeURIComponent(p.split('/').filter(Boolean).pop() ?? '')
  } catch {
    return ''
  }
}

/** Nome do arquivo ao BAIXAR: o da URL do Chatwoot; sem ele, um nome honesto
 * pelo tipo (o seletor de pasta exige um nome sugerido). */
function nomeParaBaixar(a: Anexo): string {
  return nomeDoAnexo(a) || `anexo-${a.tipo || 'arquivo'}`
}

/**
 * Baixar anexo COM escolha de pasta (Chromium) — o proxy é da mesma origem, o
 * fetch vai com o cookie de sessão. Safari/Firefox caem no download clássico.
 * Cancelar o seletor é silêncio; falha real vira toast honesto.
 */
function useBaixarAnexo() {
  const { error: toastError } = useToast()
  const [baixando, setBaixando] = useState(false)
  const baixar = useCallback(
    async (anexo: Anexo) => {
      setBaixando(true)
      try {
        await baixarArquivo({
          url: srcProxy(anexo),
          filename: nomeParaBaixar(anexo),
          mimetype: mimeAudioDoAnexo(anexo) || null,
        })
      } catch (erro) {
        toastError('Não foi possível salvar o arquivo', mensagemErroDownload(erro))
      } finally {
        setBaixando(false)
      }
    },
    [toastError],
  )
  return { baixar, baixando }
}

/** Ícone + rótulo pt-BR por tipo de anexo (file_type do Chatwoot normalizado pelo relay). */
function infoAnexo(tipo: string): { Icone: typeof FileText; rotulo: string } {
  switch (tipo) {
    case 'image':
      return { Icone: ImageIcon, rotulo: 'Imagem' }
    case 'audio':
      return { Icone: Mic, rotulo: 'Áudio' }
    case 'video':
      return { Icone: Video, rotulo: 'Vídeo' }
    case 'location':
      return { Icone: MapPin, rotulo: 'Localização' }
    case 'contact':
      return { Icone: User, rotulo: 'Contato' }
    default:
      return { Icone: FileText, rotulo: tipo || 'Arquivo' }
  }
}

/** URL do proxy autenticado que serve os bytes do anexo (imagem/áudio/vídeo/
 * arquivo) na mesma origem — PDF/imagem/vídeo abrem no navegador, tipos
 * desconhecidos baixam (octet-stream). */
function srcProxy(anexo: Anexo): string {
  return `/api/conversas/anexos?url=${encodeURIComponent(anexo.url)}`
}

/** Localização/contato não têm binário (o relay manda url vazia); e sem url não
 * há o que abrir — nesses casos o card fica estático. */
function anexoAbrivel(anexo: Anexo): boolean {
  return Boolean(anexo.url) && anexo.tipo !== 'location' && anexo.tipo !== 'contact'
}

/** Card de anexo (tipos sem preview inline, e fallback das imagens/áudios que
 * falham). Clicável quando há binário: abre em nova aba via proxy (pdf/vídeo no
 * navegador; desconhecido baixa). Localização/contato ficam estáticos.
 *
 * `modo='baixar'` (card do áudio que não toca) troca o abrir pelo SALVAR com
 * escolha de pasta — é o que o texto ao lado promete. A âncora e o visual são os
 * mesmos: sem suporte ao seletor, o clique segue pelo href de sempre. */
function AnexoCard({
  anexo,
  escuro,
  modo = 'abrir',
}: {
  anexo: Anexo
  escuro: boolean
  modo?: 'abrir' | 'baixar'
}) {
  const { Icone, rotulo } = infoAnexo(anexo.tipo)
  const { baixar } = useBaixarAnexo()
  const abrivel = anexoAbrivel(anexo)
  const classe = cn(
    'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
    escuro
      ? 'border-background/25 bg-background/10 text-background/90 dark:border-primary-foreground/25 dark:bg-primary-foreground/10 dark:text-primary-foreground/90'
      : 'border-border bg-background/60 text-muted-foreground',
    // Hover só realça; na bolha de SAÍDA o texto é claro sobre fundo escuro, então
    // hover:text-foreground o deixaria da cor do fundo (invisível) — brilha o próprio tom.
    abrivel && 'transition-colors hover:border-ring',
    abrivel && (escuro ? 'hover:text-background dark:hover:text-primary-foreground' : 'hover:text-foreground'),
  )
  const conteudo = (
    <>
      <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate font-medium">{rotulo}</span>
      {abrivel && <Download className="h-3 w-3 shrink-0 opacity-70" aria-hidden />}
    </>
  )
  if (!abrivel) return <div className={classe}>{conteudo}</div>
  if (modo === 'baixar') {
    return (
      <a
        href={srcProxy(anexo)}
        onClick={(e) => {
          e.preventDefault()
          void baixar(anexo)
        }}
        title="Baixar o anexo"
        className={classe}
      >
        {conteudo}
      </a>
    )
  }
  return (
    <a href={srcProxy(anexo)} target="_blank" rel="noreferrer" title="Abrir ou baixar o anexo em nova aba" className={classe}>
      {conteudo}
    </a>
  )
}

/** Placeholder discreto enquanto decidimos o player / o ogv carrega (mesma
 * altura do <audio> para não haver salto de layout). */
function AudioPlaceholder({ escuro }: { escuro: boolean }) {
  return (
    <div
      className={cn(
        'inline-flex h-10 w-64 max-w-full items-center gap-2 rounded-lg border px-2.5 text-xs',
        escuro
          ? 'border-background/25 text-background/80 dark:border-primary-foreground/25 dark:text-primary-foreground/80'
          : 'border-border bg-background/60 text-muted-foreground',
      )}
    >
      <RotateCw className="h-4 w-4 animate-spin" aria-hidden />
      Carregando áudio…
    </div>
  )
}

/** Falha de TRANSPORTE (proxy/HTTP fora): erro honesto com botão de tentar de
 * novo — nada de trocar para download em silêncio. */
function AudioErroCarregamento({ escuro, aoTentar }: { escuro: boolean; aoTentar: () => void }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
        escuro
          ? 'border-background/25 text-background/90 dark:border-primary-foreground/25 dark:text-primary-foreground/90'
          : 'border-border bg-background/60 text-muted-foreground',
      )}
    >
      <span>Não foi possível carregar o áudio</span>
      <button
        type="button"
        onClick={aoTentar}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium transition-colors',
          escuro
            ? 'border-background/30 hover:bg-background/15 dark:border-primary-foreground/30 dark:hover:bg-primary-foreground/15'
            : 'border-border hover:border-ring hover:text-foreground',
        )}
      >
        <RotateCw className="h-3 w-3" aria-hidden /> tentar de novo
      </button>
    </div>
  )
}

/** Falha de DECODIFICAÇÃO mesmo com o ogv (arquivo corrompido/codec exótico):
 * card de download com a explicação honesta. */
function AudioCardDownload({ anexo, escuro }: { anexo: Anexo; escuro: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className={cn(
          'text-[11px]',
          escuro ? 'text-background/70 dark:text-primary-foreground/70' : 'text-muted-foreground',
        )}
      >
        Este áudio não pôde ser reproduzido aqui — baixe para ouvir.
      </span>
      <AnexoCard anexo={anexo} escuro={escuro} modo="baixar" />
    </div>
  )
}

/** Ação "Baixar" do anexo: mesma cara dos outros botões da linha (Encaminhar /
 * Salvar no cliente). É leitura pura — aparece inclusive no modo somente leitura
 * e não depende de token pessoal. */
function BotaoBaixarAnexo({ anexo }: { anexo: Anexo }) {
  const { baixar, baixando } = useBaixarAnexo()
  return (
    <button
      type="button"
      onClick={() => void baixar(anexo)}
      disabled={baixando}
      className={cn(
        'inline-flex items-center gap-1 self-start rounded-md border border-border bg-background/70 px-2 py-0.5',
        'text-[11px] font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:text-muted-foreground',
      )}
      title="Baixar o anexo (no Chrome/Edge você escolhe a pasta)"
    >
      <Download className="h-3 w-3" aria-hidden /> {baixando ? 'Baixando…' : 'Baixar'}
    </button>
  )
}

type ModoAudio = 'checando' | 'nativo' | 'ogv'
type ErroAudio = null | 'carregamento' | 'download'

/**
 * Áudio inline via proxy. Decide no CLIENTE: se o navegador declara suporte ao
 * mimetype real (audio.canPlayType) usa o <audio> nativo (Chrome com Ogg/Opus);
 * senão, cai no AudioOgvPlayer (WASM), que só então baixa o bundle do ogv — o
 * Chrome NÃO muda de comportamento nem baixa o WASM.
 *
 * Erros são honestos (nada de virar download em silêncio): transporte → "tentar
 * de novo"; decodificação impossível → card de download explicado.
 */
function AnexoAudio({ anexo, escuro }: { anexo: Anexo; escuro: boolean }) {
  const src = srcProxy(anexo)
  const mimetype = useMemo(() => mimeAudioDoAnexo(anexo), [anexo])
  const [modo, setModo] = useState<ModoAudio>('checando')
  const [erro, setErro] = useState<ErroAudio>(null)
  const [tentativa, setTentativa] = useState(0)

  // canPlayType exige o DOM: decidimos no cliente (evita divergência de hidratação
  // — no servidor o modo inicial é sempre 'checando'). `tentativa` entra nas deps
  // para que "tentar de novo" (que volta o modo a 'checando') refaça a decisão e
  // saia do placeholder — sem ela, o modo ficaria preso em 'checando'.
  useEffect(() => {
    const el = document.createElement('audio')
    setModo(decidirPlayerAudio(mimetype, (t) => el.canPlayType(t)))
  }, [mimetype, tentativa])

  const tentarDeNovo = useCallback(() => {
    setErro(null)
    setTentativa((n) => n + 1) // re-monta o player (key) e refaz a decisão
    setModo('checando')
  }, [])

  const aoFalharCarregamento = useCallback(() => setErro('carregamento'), [])
  const aoFalharDecodificacao = useCallback(() => setErro('download'), [])

  if (erro === 'download') return <AudioCardDownload anexo={anexo} escuro={escuro} />
  if (erro === 'carregamento') return <AudioErroCarregamento escuro={escuro} aoTentar={tentarDeNovo} />
  if (modo === 'checando') return <AudioPlaceholder escuro={escuro} />

  if (modo === 'ogv') {
    return (
      <AudioOgvPlayer
        key={tentativa}
        src={src}
        escuro={escuro}
        aoFalharCarregamento={aoFalharCarregamento}
        aoFalharDecodificacao={aoFalharDecodificacao}
      />
    )
  }

  return (
    <audio
      key={tentativa}
      controls
      preload="none"
      src={src}
      onError={() => {
        // O canPlayType disse que dá para tocar: um erro aqui é transporte ou um
        // codec que o nativo não aguentou. Classifica honestamente em vez de cair
        // mudo no download.
        void classificarFalhaAudio(src).then((causa) =>
          setErro(causa === 'transporte' ? 'carregamento' : 'download'),
        )
      }}
      className="h-10 w-64 max-w-full"
    />
  )
}

/** Imagem inline via GET /api/conversas/anexos (proxy do relay). Se o proxy
 * estiver desligado/falhar (onError), degrada para o card de anexo atual. */
function AnexoImagem({ anexo, escuro }: { anexo: Anexo; escuro: boolean }) {
  const [falhou, setFalhou] = useState(false)
  if (falhou) return <AnexoCard anexo={anexo} escuro={escuro} />

  const src = srcProxy(anexo)
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Abrir a imagem em nova aba">
      {/* eslint-disable-next-line @next/next/no-img-element -- bytes vêm do proxy autenticado, sem otimização do Next */}
      <img
        src={src}
        alt="Imagem recebida na conversa"
        loading="lazy"
        onError={() => setFalhou(true)}
        className="max-h-64 w-auto max-w-full rounded-lg border border-border/50 object-contain"
      />
    </a>
  )
}

export function MensagemBolha({
  mensagem,
  conversaId,
  telefone,
  conectado = true,
  somenteLeitura = false,
  citada = null,
  nomeContato,
  nomeAgente,
  onResponder,
  onEditar,
  onIrParaCitada,
  ancoraId,
  destacada = false,
}: {
  mensagem: Mensagem
  /** Id da conversa — habilita "Ler comprovante (IA)" nas imagens de entrada. */
  conversaId?: number
  /** Telefone do contato (para casar o cliente na leitura do comprovante). */
  telefone?: string | null
  /** Encaminhar exige token pessoal (escrita): desabilita quando não conectado. */
  conectado?: boolean
  /** Leitura pura (ex.: histórico no dossiê): oculta ações de escrita
   * (Encaminhar, "Ler comprovante" e Responder). Retrocompatível: default mantém tudo. */
  somenteLeitura?: boolean
  /** Mensagem CITADA já resolvida pela thread (null = fora da página carregada:
   * cai no bloco genérico, sem nenhuma busca extra ao servidor). */
  citada?: Mensagem | null
  /** Nome do contato da conversa — autor da citação quando ela é de entrada. */
  nomeContato?: string | null
  /** Nome do agente conectado — citação da própria saída dele vira "Você". */
  nomeAgente?: string | null
  /** Habilita a ação "Responder" (a thread entra em modo resposta). */
  onResponder?: (mensagem: Mensagem) => void
  /** Habilita a ação "Editar" (a thread entra em modo edição). Só aparece
   * enquanto a mensagem PODE ser editada — ver podeEditar em lib/conversas/edicao. */
  onEditar?: (mensagem: Mensagem) => void
  /** Clique no bloco de citação: rola até a mensagem citada. */
  onIrParaCitada?: (id: number) => void
  /** id no DOM da âncora desta bolha (a thread usa para rolar até ela). */
  ancoraId?: string
  /** Destaque breve depois de chegar aqui por um clique na citação. */
  destacada?: boolean
}) {
  const { direcao, privada, conteudo, anexos, sender, timestamp } = mensagem
  const hora = horaCurta(timestamp)

  // Comprovante (IA): modal aberto para a URL da imagem clicada.
  const [comprovanteUrl, setComprovanteUrl] = useState<string | null>(null)
  // Encaminhar: anexo recebido a reenviar para outra conversa.
  const [encaminharAnexo, setEncaminharAnexo] = useState<Anexo | null>(null)
  // Salvar no cliente: anexo a guardar no dossiê (entrada ou saída).
  const [salvarAnexo, setSalvarAnexo] = useState<Anexo | null>(null)
  // URLs já salvas nesta sessão do componente — desabilita o botão pós-sucesso.
  const [salvos, setSalvos] = useState<Set<string>>(() => new Set())

  // "Editar": a janela do WhatsApp EXPIRA sozinha, então a idade não pode ser
  // congelada no primeiro render — um botão que promete e falha é pior do que
  // botão nenhum. `agora` é reavaliado por um único timer armado para o instante
  // exato em que a janela fecha (só nas bolhas que hoje são editáveis: no máximo
  // uma ou duas por thread, nunca um relógio global batendo em toda mensagem).
  const [agora, setAgora] = useState(() => Date.now())
  const mostraEditar = !somenteLeitura && !!onEditar && podeEditar(mensagem, agora)
  useEffect(() => {
    if (!mostraEditar) return
    const restante = restanteEdicaoMs(mensagem, Date.now())
    // +500 ms: acorda já do lado de fora da janela, sem depender do arredondamento.
    const t = setTimeout(() => setAgora(Date.now()), Math.max(restante, 0) + 500)
    return () => clearTimeout(t)
  }, [mostraEditar, mensagem])

  // Atividade do sistema: linha central discreta.
  if (direcao === 'atividade') {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
          {conteudo || sender.nome} {hora && <span className="opacity-70">· {hora}</span>}
        </span>
      </div>
    )
  }

  const cliente = direcao === 'entrada'
  const alinhaDireita = !cliente // saída (agente/bot) vai à direita
  const saidaEscura = alinhaDireita && !privada

  // Estilos por natureza da bolha (mock: entrada em muted; saída escura).
  const estilo = privada
    ? 'bg-warning/10 border border-warning/30 text-foreground'
    : cliente
      ? 'bg-muted text-foreground'
      : 'bg-foreground text-background dark:bg-primary/90'

  const primeiraImagem =
    !somenteLeitura && cliente && conversaId !== undefined
      ? (anexos ?? []).find((a) => a.tipo === 'image')
      : undefined

  // "Responder": vale para entrada E saída (no WhatsApp responde-se qualquer
  // mensagem), fora do modo leitura. Nota interna e atividade ficam de fora.
  const mostraResponder = !somenteLeitura && !!onResponder && podeResponder(mensagem)

  // Citação: a thread já resolveu (ou não) a mensagem citada nesta página.
  const temCitacao = typeof mensagem.emRespostaA === 'number'
  const resumo = citada ? resumoCitacao(citada) : null

  const botaoResponder = mostraResponder && (
    <button
      type="button"
      onClick={() => onResponder?.(mensagem)}
      disabled={!conectado}
      aria-label="Responder a esta mensagem"
      title={conectado ? 'Responder a esta mensagem' : 'Conecte sua conta para responder'}
      className={cn(
        'mt-5 shrink-0 self-start rounded-full border border-border bg-card p-1.5 text-muted-foreground shadow-card',
        'transition-opacity hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        // Sem hover no toque: fica discreto porém alcançável no celular e some
        // no desktop até o cursor/teclado chegar na bolha.
        'opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100',
      )}
    >
      <Reply className="h-3.5 w-3.5" aria-hidden />
    </button>
  )

  // "Editar" (padrão WhatsApp): mesma casa visual do Responder, ao lado dele.
  // Some sozinho quando a janela fecha — quem estiver com a tela aberta vê o
  // botão desaparecer em vez de descobrir o limite tomando um erro.
  const botaoEditar = mostraEditar && (
    <button
      type="button"
      onClick={() => onEditar?.(mensagem)}
      disabled={!conectado}
      aria-label="Editar esta mensagem"
      title={conectado ? 'Editar esta mensagem' : 'Conecte sua conta para editar'}
      className={cn(
        'mt-5 shrink-0 self-start rounded-full border border-border bg-card p-1.5 text-muted-foreground shadow-card',
        'transition-opacity hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        'opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100',
      )}
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden />
    </button>
  )

  return (
    <div
      className={cn(
        'group flex w-full items-start gap-1.5',
        alinhaDireita ? 'justify-end' : 'justify-start',
      )}
    >
      {alinhaDireita && botaoEditar}
      {alinhaDireita && botaoResponder}
      <div
        id={ancoraId}
        className={cn(
          'min-w-0 max-w-[85%] sm:max-w-[75%]',
          alinhaDireita ? 'items-end' : 'items-start',
        )}
      >
        {/* Rótulo do remetente + nota interna */}
        <div
          className={cn(
            'mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground',
            alinhaDireita && 'justify-end',
          )}
        >
          {privada && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-1.5 py-0.5 font-medium text-warning">
              <StickyNote className="h-3 w-3" aria-hidden /> Nota interna
            </span>
          )}
          {sender.nome && <span className="truncate">{sender.nome}</span>}
        </div>

        <div
          className={cn(
            'rounded-2xl px-3.5 py-2 text-sm shadow-card transition-shadow duration-300',
            estilo,
            destacada && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
          )}
        >
          {/* Citação (padrão WhatsApp): acima do texto. Clicável só quando a
              citada está nesta página; senão, bloco genérico honesto. */}
          {temCitacao &&
            (citada && resumo ? (
              <BlocoCitacao
                autor={autorCitacao(citada, { nomeContato, nomeAgente })}
                trecho={resumo.trecho}
                midia={resumo.midia}
                escuro={saidaEscura}
                className="mb-1.5"
                aoClicar={onIrParaCitada ? () => onIrParaCitada(citada.id) : undefined}
              />
            ) : (
              <BlocoCitacao trecho="Mensagem anterior" escuro={saidaEscura} className="mb-1.5" />
            ))}
          {conteudo && <p className="whitespace-pre-wrap break-words">{conteudo}</p>}
          {anexos && anexos.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {anexos.map((a, i) => {
                // Ações de escrita por anexo, ocultas no modo leitura. Salvar no
                // cliente vale para TODOS os anexos (dono, 2026-07-17); Encaminhar
                // vale para todo anexo com binário (mídia inclusive).
                const podeSalvar = !somenteLeitura && conversaId !== undefined && !!a.url
                // Baixar para o computador ESCOLHENDO A PASTA (pedido do dono):
                // leitura pura, vale em qualquer anexo com binário e também no
                // modo somente leitura.
                const podeBaixar = anexoAbrivel(a)
                const temAcoes = (!somenteLeitura && podeEncaminhar(a)) || podeSalvar || podeBaixar
                const salvo = salvos.has(a.url)
                return (
                  <div key={i} className="flex flex-col gap-1">
                    {a.tipo === 'image' ? (
                      <AnexoImagem anexo={a} escuro={saidaEscura} />
                    ) : pareceAudio(a) ? (
                      <AnexoAudio anexo={a} escuro={saidaEscura} />
                    ) : (
                      <AnexoCard anexo={a} escuro={saidaEscura} />
                    )}
                    {temAcoes && (
                      <div className="flex flex-wrap items-center gap-1">
                        {/* Baixar: escolhe a pasta no Chrome/Edge; nos demais cai
                            no download clássico do navegador. */}
                        {podeBaixar && <BotaoBaixarAnexo anexo={a} />}
                        {/* Encaminhar: só no anexo RECEBIDO do cliente (envio ao WhatsApp). */}
                        {cliente && podeEncaminhar(a) && (
                          <button
                            type="button"
                            onClick={() => setEncaminharAnexo(a)}
                            disabled={!conectado}
                            className={cn(
                              'inline-flex items-center gap-1 self-start rounded-md border border-border bg-background/70 px-2 py-0.5',
                              'text-[11px] font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground',
                              'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-muted-foreground',
                            )}
                            title={
                              conectado
                                ? 'Encaminhar este anexo para outra conversa ou número'
                                : 'Conecte sua conta para encaminhar'
                            }
                          >
                            <Forward className="h-3 w-3" aria-hidden /> Encaminhar
                          </button>
                        )}
                        {/* Salvar no cliente: vale para ENTRADA e SAÍDA (não exige token
                            pessoal — grava no dossiê do SIMAS). Precisa da conversa. */}
                        {podeSalvar && (
                          <button
                            type="button"
                            onClick={() => setSalvarAnexo(a)}
                            disabled={salvo}
                            className={cn(
                              'inline-flex items-center gap-1 self-start rounded-md border border-border bg-background/70 px-2 py-0.5',
                              'text-[11px] font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground',
                              'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:text-muted-foreground',
                            )}
                            title={
                              salvo
                                ? 'Já salvo no dossiê do cliente'
                                : 'Salvar este anexo no dossiê do cliente'
                            }
                          >
                            {salvo ? (
                              <>
                                <Check className="h-3 w-3" aria-hidden /> Salvo no cliente
                              </>
                            ) : (
                              <>
                                <FolderPlus className="h-3 w-3" aria-hidden /> Salvar no cliente
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {/* Imagem de ENTRADA: leitura de comprovante pela IA (só sugere;
              a baixa é sempre confirmada por um humano no modal). */}
          {primeiraImagem && (
            <button
              type="button"
              onClick={() => setComprovanteUrl(primeiraImagem.url)}
              className={cn(
                'mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 py-1',
                'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors',
                'hover:border-ring hover:text-foreground',
              )}
              title="Extrair os dados do comprovante com IA e sugerir a parcela"
            >
              <ScanLine className="h-3.5 w-3.5" aria-hidden /> Ler comprovante (IA)
            </button>
          )}
          {hora && (
            <div
              className={cn(
                'mt-0.5 flex items-center justify-end gap-1 text-[10px]',
                saidaEscura ? 'text-background/70 dark:text-primary-foreground/70' : 'text-muted-foreground',
              )}
            >
              <span>{hora}</span>
              {saidaEscura && <Check className="h-3 w-3 opacity-80" aria-hidden />}
            </div>
          )}
        </div>
      </div>
      {!alinhaDireita && botaoResponder}

      {conversaId !== undefined && comprovanteUrl && (
        <ComprovanteModal
          aberto
          conversaId={conversaId}
          anexoUrl={comprovanteUrl}
          telefone={telefone ?? null}
          onFechar={() => setComprovanteUrl(null)}
        />
      )}

      {encaminharAnexo && (
        <EncaminharModal
          aberto
          anexo={encaminharAnexo}
          origemConversaId={conversaId}
          onFechar={() => setEncaminharAnexo(null)}
        />
      )}

      {salvarAnexo && conversaId !== undefined && (
        <SalvarNoClienteModal
          aberto
          conversaId={conversaId}
          anexoUrl={salvarAnexo.url}
          telefone={telefone ?? null}
          nomeSugerido={nomeDoAnexo(salvarAnexo)}
          onFechar={() => setSalvarAnexo(null)}
          onSalvo={() => {
            const url = salvarAnexo.url
            setSalvos((prev) => {
              const s = new Set(prev)
              s.add(url)
              return s
            })
          }}
        />
      )}
    </div>
  )
}
