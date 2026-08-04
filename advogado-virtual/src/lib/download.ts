// Download de arquivo COM ESCOLHA DE PASTA (pedido do dono: "cai direto em
// Downloads, quero escolher onde salvar").
//
// REALIDADE TÉCNICA (sem promessa falsa): só o File System Access API
// (window.showSaveFilePicker) deixa o site abrir o seletor de pasta do sistema,
// e ele só existe em navegadores Chromium (Chrome/Edge). Safari e Firefox NÃO
// têm — lá o download continua exatamente como sempre foi (âncora com
// `download` / navegação para a URL), caindo na pasta padrão do navegador.
//
// Regras desta camada:
//  • O seletor é aberto ANTES do fetch. `showSaveFilePicker` exige "user
//    gesture" (ativação transitória) e ela se perde durante um await de rede —
//    em arquivo grande o picker morreria com NotAllowedError. Então: clique →
//    picker → rede → grava no handle escolhido.
//  • CANCELAR o seletor é silêncio (AbortError não é erro; o usuário desistiu).
//  • Qualquer outra falha do PRÓPRIO seletor (iframe sem permissão, gesto
//    perdido, API capada) NÃO quebra o download: cai no clássico.
//  • Falha real de rede ou de gravação é LANÇADA para o chamador mostrar um
//    toast honesto — nunca "baixado com sucesso" mentindo.

// ── Tipos do File System Access API ──────────────────────────────────────────
// O lib.dom do TypeScript 5.9 ainda não declara showSaveFilePicker; declaramos
// aqui o mínimo que usamos (nomes próprios, sem colidir com o lib.dom).

/** Item de `types` do seletor: descrição + mapa mimetype → extensões. */
export interface TipoAceitoPicker {
  description?: string
  accept: Record<string, string[]>
}

interface OpcoesSeletorSalvar {
  suggestedName?: string
  types?: TipoAceitoPicker[]
}

interface EscritorArquivo {
  write(dados: Blob): Promise<void>
  close(): Promise<void>
  abort?(motivo?: unknown): Promise<void>
}

interface HandleArquivo {
  createWritable(): Promise<EscritorArquivo>
}

/** Janela que (talvez) tenha o seletor de destino. */
export interface JanelaComSeletor {
  showSaveFilePicker?: (opcoes?: OpcoesSeletorSalvar) => Promise<HandleArquivo>
}

// ── Parte pura (testável) ────────────────────────────────────────────────────

/** O navegador permite ESCOLHER A PASTA? Só Chromium. Recebe a janela para dar
 * testabilidade (em Node/vitest não há `window`). */
export function suportaEscolhaDePasta(
  janela: unknown = typeof window !== 'undefined' ? window : undefined,
): boolean {
  const w = janela as JanelaComSeletor | null | undefined
  return typeof w?.showSaveFilePicker === 'function'
}

/** Cancelamento do seletor pelo usuário — NÃO é erro. */
export function ehCancelamento(erro: unknown): boolean {
  return (erro as { name?: string } | null)?.name === 'AbortError'
}

/** Extensão do nome do arquivo, minúscula e com ponto ('.docx'); '' se não houver
 * uma extensão simples e plausível. */
export function extensaoDe(nome: string): string {
  const base = (nome ?? '').split(/[\\/]/).pop() ?? ''
  const ponto = base.lastIndexOf('.')
  if (ponto <= 0 || ponto === base.length - 1) return ''
  const ext = base.slice(ponto).toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
}

/**
 * Encurta o nome PRESERVANDO a extensão (um `.docx` cortado fora vira arquivo
 * que o Word não abre) e sem partir emoji ao meio — `slice` quebra par
 * surrogado e o seletor receberia um nome inválido.
 */
function encurtarNome(nome: string, limite: number): string {
  if (nome.length <= limite) return nome
  const ext = extensaoDe(nome)
  const corpo = ext ? nome.slice(0, nome.length - ext.length) : nome
  const cabem = Math.max(1, limite - ext.length)
  return Array.from(corpo).slice(0, cabem).join('').trimEnd() + ext
}

/** Nome sugerido seguro para o seletor: o Chromium recusa caminho, controle e
 * caracteres proibidos do sistema de arquivos. Nome longo é encurtado sem
 * perder a extensão. Vazio vira 'arquivo'. */
export function nomeSeguro(nome: string, padrao = 'arquivo'): string {
  const base = (nome ?? '').split(/[\\/]/).pop() ?? ''
  const limpo = base
    // eslint-disable-next-line no-control-regex -- caracteres de controle são inválidos em nome de arquivo
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
  return encurtarNome(limpo, 120) || padrao
}

// Extensão → mimetype dos formatos que o SIMAS realmente entrega/recebe.
const MIME_POR_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.amr': 'audio/amr',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.3gp': 'video/3gpp',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
}

// Mimetype → extensão canônica (caminho inverso: quando só sabemos o mimetype).
const EXT_POR_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/rtf': '.rtf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/zip': '.zip',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
}

// Rótulo pt-BR do formato (aparece no seletor do sistema).
const DESCRICAO_POR_MIME: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Documento do Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Documento do Word',
  'application/vnd.ms-excel': 'Planilha do Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Planilha do Excel',
  'application/vnd.oasis.opendocument.text': 'Documento de texto',
  'application/rtf': 'Documento de texto',
  'text/plain': 'Arquivo de texto',
  'text/markdown': 'Arquivo de texto',
  'text/csv': 'Planilha CSV',
  'application/zip': 'Arquivo compactado',
}

/** Mimetype genérico/sem informação: não serve para filtrar no seletor. */
function mimeUtil(mimetype: string | null | undefined): string | null {
  const m = (mimetype ?? '').split(';')[0].trim().toLowerCase()
  if (!m) return null
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(m)) return null
  if (m === 'application/octet-stream' || m === 'binary/octet-stream') return null
  return m
}

/** Rótulo do formato para o seletor (pt-BR). */
function descricaoDoTipo(mime: string, ext: string): string {
  const conhecida = DESCRICAO_POR_MIME[mime]
  if (conhecida) return conhecida
  if (mime.startsWith('image/')) return 'Imagem'
  if (mime.startsWith('audio/')) return 'Áudio'
  if (mime.startsWith('video/')) return 'Vídeo'
  return ext ? `Arquivo ${ext.slice(1).toUpperCase()}` : 'Arquivo'
}

/**
 * Monta o `types` do seletor a partir do nome + mimetype. `undefined` quando o
 * formato é desconhecido/genérico — aí o seletor abre sem filtro (que é o certo:
 * filtro errado atrapalharia mais do que ajuda).
 *
 * O mimetype declarado ganha do deduzido pela extensão; se ele for genérico
 * (octet-stream — caso comum do proxy de anexos), cai na extensão.
 */
export function tiposDoPicker(
  nome: string,
  mimetype?: string | null,
): TipoAceitoPicker[] | undefined {
  const extNome = extensaoDe(nome)
  const mime = mimeUtil(mimetype) ?? (extNome ? MIME_POR_EXT[extNome] : undefined) ?? null
  if (!mime) return undefined
  const ext = extNome || EXT_POR_MIME[mime] || ''
  if (!ext) return undefined
  return [{ description: descricaoDoTipo(mime, ext), accept: { [mime]: [ext] } }]
}

/** Extensão canônica de um mimetype ('.pdf'); '' quando desconhecido. */
export function extensaoDoMime(mimetype: string | null | undefined): string {
  const m = mimeUtil(mimetype)
  return (m && EXT_POR_MIME[m]) || ''
}

/**
 * Nome do arquivo embutido na signed URL do Supabase (`?download=nome.ext`) —
 * é o nome que o SERVIDOR já escolheu para o anexo. `null` quando a URL não o
 * traz (inclusive `?download` sozinho ou `?download=true`).
 */
export function nomeDaUrlDeDownload(url: string): string | null {
  let bruto: string | null = null
  try {
    bruto = new URL(url, 'http://local.invalid').searchParams.get('download')
  } catch {
    return null
  }
  const nome = (bruto ?? '').trim()
  if (!nome || nome === 'true') return null
  return nome
}

// ── Parte de navegador ───────────────────────────────────────────────────────

type Destino =
  | { tipo: 'handle'; handle: HandleArquivo }
  | { tipo: 'sem-suporte' }
  | { tipo: 'cancelado' }

/**
 * Abre o seletor de destino. DEVE ser chamado ainda no gesto do usuário (a
 * chamada ao picker acontece antes de qualquer await interno).
 */
async function escolherDestino(filename: string, mimetype?: string | null): Promise<Destino> {
  const janela = (typeof window !== 'undefined' ? window : undefined) as
    | (Window & JanelaComSeletor)
    | undefined
  const abrir = janela?.showSaveFilePicker
  if (typeof abrir !== 'function') return { tipo: 'sem-suporte' }

  const tipos = tiposDoPicker(filename, mimetype)
  try {
    const handle = await abrir.call(janela, {
      suggestedName: nomeSeguro(filename),
      ...(tipos ? { types: tipos } : {}),
    })
    return { tipo: 'handle', handle }
  } catch (erro) {
    // Desistência do usuário: silêncio total.
    if (ehCancelamento(erro)) return { tipo: 'cancelado' }
    // Seletor indisponível na prática (iframe sem permissão, gesto expirado,
    // política do navegador): NÃO perde o download — cai no clássico.
    return { tipo: 'sem-suporte' }
  }
}

/** Grava o blob no arquivo escolhido. Erro aqui é erro de verdade: aborta o
 * stream (não deixa arquivo pela metade) e propaga. */
async function gravarNoDestino(handle: HandleArquivo, blob: Blob): Promise<void> {
  const escritor = await handle.createWritable()
  try {
    await escritor.write(blob)
  } catch (erro) {
    await escritor.abort?.().catch(() => {})
    throw erro
  }
  await escritor.close()
}

/** Download clássico (Safari/Firefox e qualquer fallback): âncora com `download`.
 * Em URL de outra origem o atributo é ignorado pelo navegador — vale então o
 * Content-Disposition do servidor, que é o comportamento atual. */
export function baixarPorAncora(url: string, filename?: string): void {
  const a = document.createElement('a')
  a.href = url
  if (filename) a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Busca os bytes com o cookie de sessão (mesma origem) e traduz a falha para
 * uma frase que o usuário entende — o toast do chamador usa essa mensagem. */
async function buscarBytes(url: string): Promise<Blob> {
  let resp: Response
  try {
    resp = await fetch(url, { credentials: 'same-origin' })
  } catch {
    throw new Error('Não foi possível buscar o arquivo (verifique a conexão e tente de novo)')
  }
  if (!resp.ok) throw new Error(`O servidor recusou o arquivo (HTTP ${resp.status})`)
  return resp.blob()
}

function baixarBlobPorAncora(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  baixarPorAncora(url, filename)
  // Revogar na hora cancelaria o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export interface ArquivoParaBaixar {
  /** URL dos bytes (mesma origem com cookies, ou signed URL). */
  url: string
  /** Nome sugerido do arquivo (com extensão). */
  filename: string
  /** Mimetype, quando conhecido — melhora o filtro do seletor. */
  mimetype?: string | null
}

/**
 * Baixa um arquivo de uma URL deixando o usuário ESCOLHER A PASTA (Chromium).
 *
 * Retorna `true` se o download aconteceu (ou foi entregue ao navegador no
 * fallback) e `false` se o usuário cancelou o seletor. LANÇA em falha real de
 * rede ou de gravação — o chamador mostra o toast.
 */
export async function baixarArquivo({ url, filename, mimetype }: ArquivoParaBaixar): Promise<boolean> {
  const destino = await escolherDestino(filename, mimetype)
  if (destino.tipo === 'cancelado') return false
  // Safari/Firefox: comportamento de sempre, sem baixar bytes para a memória.
  if (destino.tipo === 'sem-suporte') {
    baixarPorAncora(url, filename)
    return true
  }
  await gravarNoDestino(destino.handle, await buscarBytes(url))
  return true
}

export interface UrlSobDemandaParaBaixar {
  filename: string
  mimetype?: string | null
  /** Resolve a URL dos bytes (ex.: pedir uma signed URL curta ao servidor).
   * `null` = o chamador já avisou o usuário; aqui é só desistir em silêncio. */
  obterUrl: () => Promise<string | null>
  /** O que fazer em Safari/Firefox — default: download clássico por âncora.
   * Existe para preservar comportamentos atuais (ex.: abrir em nova aba). */
  aoSemSuporte?: (url: string) => void
}

/**
 * Baixa de uma URL que só é conhecida DEPOIS de uma ida ao servidor (signed URL
 * curta). Mesma regra de ouro: o seletor de pasta abre ANTES da rede.
 */
export async function baixarUrlSobDemanda({
  filename,
  mimetype,
  obterUrl,
  aoSemSuporte,
}: UrlSobDemandaParaBaixar): Promise<boolean> {
  const destino = await escolherDestino(filename, mimetype)
  if (destino.tipo === 'cancelado') return false
  const url = await obterUrl()
  if (!url) return false
  if (destino.tipo === 'sem-suporte') {
    if (aoSemSuporte) aoSemSuporte(url)
    else baixarPorAncora(url, filename)
    return true
  }
  await gravarNoDestino(destino.handle, await buscarBytes(url))
  return true
}

export interface GeradoParaBaixar {
  filename: string
  mimetype?: string | null
  /** Produz os bytes (POST de exportação, etc.). `null` = o chamador já tratou
   * o erro e mostrou o próprio aviso — aqui é só desistir em silêncio. */
  obterBlob: () => Promise<Blob | null>
}

/**
 * Baixa um arquivo GERADO sob demanda (exportar DOCX/PDF, etc.): abre o seletor
 * ANTES de chamar a rede, para não perder o gesto do usuário na espera.
 */
export async function baixarGerado({ filename, mimetype, obterBlob }: GeradoParaBaixar): Promise<boolean> {
  const destino = await escolherDestino(filename, mimetype)
  if (destino.tipo === 'cancelado') return false
  const blob = await obterBlob()
  if (!blob) return false
  if (destino.tipo === 'sem-suporte') {
    baixarBlobPorAncora(blob, filename)
    return true
  }
  await gravarNoDestino(destino.handle, blob)
  return true
}

/** Baixa um blob que já está na memória (transcrição, gravação recuperada). */
export async function baixarBlob({
  blob,
  filename,
  mimetype,
}: {
  blob: Blob
  filename: string
  mimetype?: string | null
}): Promise<boolean> {
  return baixarGerado({
    filename,
    mimetype: mimetype ?? blob.type,
    obterBlob: async () => blob,
  })
}

/** Mensagem honesta para o toast quando o download falha de verdade. */
export function mensagemErroDownload(erro: unknown, padrao = 'Tente de novo ou escolha outra pasta'): string {
  const msg = (erro as { message?: unknown } | null)?.message
  return typeof msg === 'string' && msg.trim() && !/^failed to fetch$/i.test(msg.trim())
    ? msg.trim()
    : padrao
}
