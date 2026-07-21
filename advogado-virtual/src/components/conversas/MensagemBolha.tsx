'use client'

import { useState } from 'react'
import {
  Check,
  Download,
  FileText,
  FolderPlus,
  Forward,
  Image as ImageIcon,
  MapPin,
  Mic,
  ScanLine,
  StickyNote,
  User,
  Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { horaCurta } from '@/lib/conversas/formato'
import type { Anexo, Mensagem } from '@/lib/conversas/tipos'
import { ComprovanteModal } from './ComprovanteModal'
import { EncaminharModal } from './EncaminharModal'
import { SalvarNoClienteModal } from './SalvarNoClienteModal'

/** Imagem/arquivo (pdf/doc): mesma família aceita para encaminhar E para salvar
 * no dossiê (áudio/vídeo/localização/contato ficam de fora — a allowlist de
 * documento/relay os recusa de qualquer forma). */
function podeEncaminhar(a: Anexo): boolean {
  return a.tipo === 'image' || a.tipo === 'file'
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
 * navegador; desconhecido baixa). Localização/contato ficam estáticos. */
function AnexoCard({ anexo, escuro }: { anexo: Anexo; escuro: boolean }) {
  const { Icone, rotulo } = infoAnexo(anexo.tipo)
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
  return (
    <a href={srcProxy(anexo)} target="_blank" rel="noreferrer" title="Abrir ou baixar o anexo em nova aba" className={classe}>
      {conteudo}
    </a>
  )
}

/** Extensões de áudio comuns do WhatsApp/encaminhamentos. Áudio enviado como
 * ARQUIVO (documento) chega com tipo 'file' — pela extensão ainda ganha player
 * (caso real: áudio da equipe encaminhado não reproduzia, só baixava). */
const EXT_AUDIO = /\.(ogg|oga|opus|mp3|m4a|aac|amr|wav|weba|webm)(\?|$)/i
function pareceAudio(a: Anexo): boolean {
  if (a.tipo === 'audio') return true
  if (a.tipo !== 'file' || !a.url) return false
  try {
    return EXT_AUDIO.test(new URL(a.url).pathname)
  } catch {
    return EXT_AUDIO.test(a.url)
  }
}

/** Áudio inline (player nativo) via proxy, nas duas direções. onError (proxy
 * desligado/codec sem suporte) degrada para o card clicável com download. */
function AnexoAudio({ anexo, escuro }: { anexo: Anexo; escuro: boolean }) {
  const [falhou, setFalhou] = useState(false)
  if (falhou) return <AnexoCard anexo={anexo} escuro={escuro} />
  return (
    <audio
      controls
      preload="none"
      src={srcProxy(anexo)}
      onError={() => setFalhou(true)}
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
}: {
  mensagem: Mensagem
  /** Id da conversa — habilita "Ler comprovante (IA)" nas imagens de entrada. */
  conversaId?: number
  /** Telefone do contato (para casar o cliente na leitura do comprovante). */
  telefone?: string | null
  /** Encaminhar exige token pessoal (escrita): desabilita quando não conectado. */
  conectado?: boolean
  /** Leitura pura (ex.: histórico no dossiê): oculta ações de escrita
   * (Encaminhar e "Ler comprovante"). Retrocompatível: default mantém tudo. */
  somenteLeitura?: boolean
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

  return (
    <div className={cn('flex w-full', alinhaDireita ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[85%] sm:max-w-[75%]', alinhaDireita ? 'items-end' : 'items-start')}>
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

        <div className={cn('rounded-2xl px-3.5 py-2 text-sm shadow-card', estilo)}>
          {conteudo && <p className="whitespace-pre-wrap break-words">{conteudo}</p>}
          {anexos && anexos.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {anexos.map((a, i) => {
                // Ações de escrita por anexo, ocultas no modo leitura. Salvar no
                // cliente vale para TODOS os anexos (dono, 2026-07-17) — áudio e
                // vídeo inclusive; Encaminhar segue restrito a imagem/pdf/doc.
                const podeSalvar = !somenteLeitura && conversaId !== undefined && !!a.url
                const temAcoes = (!somenteLeitura && podeEncaminhar(a)) || podeSalvar
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
                                ? 'Encaminhar este anexo para outra conversa'
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
