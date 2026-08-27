// ARTEFATOS DE APOIO gerados pela IA (F0.5) — materialização AUTOMÁTICA no
// dossiê, sem confirmação do advogado.
//
// Exigência do dono, literal: "Tem casos que o claude gera outros arquivos para
// apoio à peça, como planilha de cálculos. Estes arquivos também precisam ser
// anexados automaticamente no SIMAS."
//
// O caminho é o MESMO de src/lib/pecas/materializar.ts (bucket `documentos` →
// linha em `documentos` → `documento_vinculos` na pasta do caso/processo →
// `enfileirarDriveSync`), com duas diferenças que importam:
//
//  1. VERSIONAMENTO POR NOME LÓGICO: regerar "a planilha de cálculos" na mesma
//     sessão SUBSTITUI o arquivo e ATUALIZA a mesma linha — não enche o dossiê
//     de cópias. A chave é (sessao_id, slug) em `pecas_sessoes_anexos`, com
//     `origem = 'gerado'` (migration 086), o mesmo espírito do uq_documentos_peca.
//  2. BEST-EFFORT ABSOLUTO: falha aqui NUNCA derruba a rodada. O advogado
//     recebe a resposta e um aviso de sistema; o que ele pagou não se perde.
//
// LGPD: logs só com ids, extensões e contagens — nunca nome de arquivo (o nome
// vem do modelo e pode carregar o nome do cliente) nem conteúdo.
// SERVER-ONLY.

import { enfileirarDriveSync } from '@/lib/drive/fila'
import { logger } from '@/lib/logger'
import type { ArquivoAnthropic } from '@/lib/anthropic/files'
import type { SupabaseAdmin } from './sessoes'

/** Tipo do documento no dossiê. Não é peça, não é prova: é apoio da IA. */
export const TIPO_DOCUMENTO_ARTEFATO = 'apoio_ia'

/**
 * Allowlist de extensões. O sandbox pode escrever qualquer coisa; no dossiê do
 * cliente só entra o que o escritório abre e revisa. Tudo fora daqui é
 * ignorado com aviso no turno.
 */
export const EXTENSOES_ARTEFATO = ['xlsx', 'csv', 'docx', 'pdf', 'md', 'png'] as const
export type ExtensaoArtefato = (typeof EXTENSOES_ARTEFATO)[number]

/** Teto por arquivo. Acima disso não é apoio à peça — é outro problema. */
export const TETO_ARTEFATO_BYTES = 25 * 1024 * 1024

/** Teto de arquivos materializados por rodada (guarda contra um loop do modelo). */
export const MAX_ARTEFATOS_POR_RODADA = 8

/** Quanto do texto extraído vai para a busca (mesmo corte de materializar.ts). */
export const MAX_TEXTO_EXTRAIDO = 5_000

const MIME_POR_EXT: Record<ExtensaoArtefato, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  md: 'text/markdown',
  png: 'image/png',
}

/** Extensões cujo conteúdo é texto puro — dá para indexar sem biblioteca nova. */
const EXTENSOES_TEXTUAIS = new Set<string>(['csv', 'md'])

// ---------------------------------------------------------------------------
// Política (puro — é o que os testes travam)
// ---------------------------------------------------------------------------

/** Extensão em minúsculas, sem ponto. '' quando o nome não tem uma. */
export function extensaoDe(nome: string): string {
  const base = (nome ?? '').trim().split(/[\\/]/).pop() ?? ''
  const ponto = base.lastIndexOf('.')
  if (ponto <= 0 || ponto === base.length - 1) return ''
  return base.slice(ponto + 1).toLowerCase()
}

export type MotivoIgnorado = 'sem_nome' | 'extensao' | 'tamanho' | 'vazio'

export interface VeredictoArquivo {
  ok: boolean
  ext?: ExtensaoArtefato
  motivo?: MotivoIgnorado
}

/**
 * O arquivo pode entrar no dossiê? Extensão na allowlist e tamanho entre 1 byte
 * e o teto. `tamanho` é o REAL (bytes baixados), nunca o prometido.
 */
export function arquivoPermitido(params: { nome: string; tamanho: number }): VeredictoArquivo {
  const nome = (params.nome ?? '').trim()
  if (!nome) return { ok: false, motivo: 'sem_nome' }

  const ext = extensaoDe(nome)
  if (!(EXTENSOES_ARTEFATO as readonly string[]).includes(ext)) return { ok: false, motivo: 'extensao' }

  if (!Number.isFinite(params.tamanho) || params.tamanho <= 0) return { ok: false, motivo: 'vazio' }
  if (params.tamanho > TETO_ARTEFATO_BYTES) return { ok: false, motivo: 'tamanho' }

  return { ok: true, ext: ext as ExtensaoArtefato }
}

/** Frase para o turno de sistema quando um arquivo é recusado. */
export function motivoLegivel(motivo: MotivoIgnorado): string {
  switch (motivo) {
    case 'extensao':
      return `tipo de arquivo fora da lista aceita (${EXTENSOES_ARTEFATO.join(', ')})`
    case 'tamanho':
      return `acima do limite de ${Math.round(TETO_ARTEFATO_BYTES / (1024 * 1024))} MB`
    case 'vazio':
      return 'arquivo vazio'
    default:
      return 'arquivo sem nome'
  }
}

/** Título legível do artefato: o nome que o modelo deu, sem a extensão. */
export function tituloArtefato(nome: string): string {
  const base = (nome ?? '').trim().split(/[\\/]/).pop() ?? ''
  const ext = extensaoDe(base)
  const semExt = ext ? base.slice(0, base.length - ext.length - 1) : base
  return semExt.replace(/[_]+/g, ' ').trim() || 'arquivo'
}

/**
 * NOME LÓGICO do artefato dentro da sessão. É a chave do versionamento: o
 * modelo que regera "Cálculos de Rescisão.xlsx" produz o MESMO slug e substitui
 * a planilha anterior em vez de criar uma segunda.
 */
export function slugArtefato(nome: string): string {
  const bruto = tituloArtefato(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (bruto || 'arquivo').slice(0, 60).replace(/-+$/, '')
}

/** `file_name` gravado em `documentos` (o rótulo que aparece no dossiê). */
export function nomeArtefato(nome: string): string {
  return `Apoio IA — ${tituloArtefato(nome)}`
}

/**
 * Caminho no bucket `documentos`. Determinístico por (sessão, nome lógico) —
 * é ele que faz o upsert do Storage SUBSTITUIR o arquivo anterior.
 */
export function caminhoArtefato(params: {
  tenantId: string
  clienteId: string
  atendimentoId: string
  sessaoId: string
  slug: string
  ext: string
}): string {
  return `${params.tenantId}/clientes/${params.clienteId}/casos/${params.atendimentoId}/apoio-ia/${params.sessaoId}_${params.slug}.${params.ext}`
}

/** MIME do artefato: o da extensão manda (o do sandbox costuma ser genérico). */
export function mimeArtefato(ext: string, mimeOriginal?: string | null): string {
  return MIME_POR_EXT[ext as ExtensaoArtefato] ?? mimeOriginal ?? 'application/octet-stream'
}

/**
 * Texto para a busca do dossiê. CSV e Markdown são texto puro e entram direto;
 * xlsx/docx/pdf/png exigiriam biblioteca de leitura e ficam vazios.
 *
 * TODO (F2): extrair xlsx/docx com a mesma rotina de extração de documentos
 * (hoje o projeto não tem lib de planilha; ler .xlsx só para indexar não paga).
 */
export function textoExtraidoDeArtefato(params: { ext: string; bytes: Buffer }): string {
  if (!EXTENSOES_TEXTUAIS.has(params.ext)) return ''
  try {
    return params.bytes.toString('utf8').slice(0, MAX_TEXTO_EXTRAIDO)
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Leitura dos blocos da resposta (puro)
// ---------------------------------------------------------------------------

export interface ArquivosDaResposta {
  /** Ids na Files API dos arquivos criados no container, na ordem de criação. */
  fileIds: string[]
  /** Quantas vezes o modelo rodou código no sandbox (entra no turno). */
  execucoes: number
  /** Execuções que voltaram erro (o modelo costuma corrigir e rodar de novo). */
  erros: number
}

type BlocoDesconhecido = { type?: unknown; name?: unknown; content?: unknown }

/**
 * Varre os blocos da resposta atrás dos arquivos criados no sandbox.
 *
 * Forma dos blocos (skill claude-api → typescript/claude-api/tool-use.md,
 * "Retrieve Generated Files"): o resultado do `code_execution` chega como
 * `bash_code_execution_tool_result` → `content: { type: 'bash_code_execution_result',
 * content: [{ type: 'bash_code_execution_output', file_id }] }`. A forma legada
 * (`code_execution_tool_result` → `code_execution_result` → `code_execution_output`)
 * é aceita também: o tipo do tool é configurável por env e a variante antiga
 * ainda existe em modelos mais velhos.
 */
export function arquivosDaResposta(blocos: readonly unknown[]): ArquivosDaResposta {
  const fileIds: string[] = []
  let execucoes = 0
  let erros = 0

  for (const bruto of blocos ?? []) {
    const bloco = (bruto ?? {}) as BlocoDesconhecido
    const tipo = typeof bloco.type === 'string' ? bloco.type : ''

    if (tipo === 'server_tool_use') {
      const nome = typeof bloco.name === 'string' ? bloco.name : ''
      if (nome === 'code_execution' || nome === 'bash_code_execution') execucoes++
      continue
    }

    if (tipo !== 'bash_code_execution_tool_result' && tipo !== 'code_execution_tool_result') continue

    const conteudo = (bloco.content ?? {}) as BlocoDesconhecido
    const tipoConteudo = typeof conteudo.type === 'string' ? conteudo.type : ''
    if (tipoConteudo.endsWith('_error')) {
      erros++
      continue
    }

    const saidas = Array.isArray(conteudo.content) ? conteudo.content : []
    for (const saidaBruta of saidas) {
      const saida = (saidaBruta ?? {}) as { type?: unknown; file_id?: unknown }
      const tipoSaida = typeof saida.type === 'string' ? saida.type : ''
      if (tipoSaida !== 'bash_code_execution_output' && tipoSaida !== 'code_execution_output') continue
      if (typeof saida.file_id === 'string' && saida.file_id && !fileIds.includes(saida.file_id)) {
        fileIds.push(saida.file_id)
      }
    }
  }

  return { fileIds, execucoes, erros }
}

// ---------------------------------------------------------------------------
// Materialização no dossiê
// ---------------------------------------------------------------------------

/** O que o turno do agente registra sobre cada artefato (payload.artefatos). */
export interface ArtefatoTurno {
  documentoId: string
  /** `file_name` gravado no dossiê ("Apoio IA — ..."). */
  nome: string
  ext: string
  tamanho: number
  /** true = substituiu a versão anterior do MESMO nome lógico nesta sessão. */
  atualizado: boolean
}

export interface ResultadoArtefatos {
  artefatos: ArtefatoTurno[]
  /** Recusados pela política (extensão/tamanho) — viram aviso no turno. */
  ignorados: Array<{ titulo: string; motivo: MotivoIgnorado }>
  /** Falhas de gravação (storage/banco). O advogado precisa saber que houve. */
  falhas: number
}

const VAZIO: ResultadoArtefatos = { artefatos: [], ignorados: [], falhas: 0 }

/**
 * Materializa no dossiê os arquivos que a rodada produziu. NUNCA lança: o pior
 * caso devolve `falhas > 0` e a rodada segue.
 *
 * `admin` é o client service_role (as tabelas da sessão são service-only) — a
 * posse do tenant já foi conferida por quem abriu a rodada.
 */
export async function materializarArtefatosDaSessao(
  admin: SupabaseAdmin,
  params: {
    tenantId: string
    sessaoId: string
    atendimentoId: string | null
    arquivos: ArquivoAnthropic[]
  },
): Promise<ResultadoArtefatos> {
  if (!params.arquivos.length) return VAZIO
  if (!params.atendimentoId) {
    // Peça sem caso não tem pasta no dossiê — nada a fazer (nem erro).
    logger.warn('ia.sessao.artefato.sem_caso', {
      sessaoId: params.sessaoId,
      arquivos: params.arquivos.length,
    })
    return VAZIO
  }

  const resultado: ResultadoArtefatos = { artefatos: [], ignorados: [], falhas: 0 }

  try {
    const { data: atendimento } = await admin
      .from('atendimentos')
      .select('id, cliente_id, vinculo_processo_id')
      .eq('id', params.atendimentoId)
      .eq('tenant_id', params.tenantId)
      .maybeSingle()

    const clienteId = (atendimento?.cliente_id as string | undefined) ?? null
    if (!clienteId) {
      logger.warn('ia.sessao.artefato.sem_cliente', { sessaoId: params.sessaoId })
      return VAZIO
    }
    const processoId = (atendimento?.vinculo_processo_id as string | null) ?? null

    for (const arquivo of params.arquivos.slice(0, MAX_ARTEFATOS_POR_RODADA)) {
      const veredicto = arquivoPermitido({ nome: arquivo.nome, tamanho: arquivo.tamanho })
      if (!veredicto.ok || !veredicto.ext) {
        resultado.ignorados.push({
          titulo: tituloArtefato(arquivo.nome),
          motivo: veredicto.motivo ?? 'sem_nome',
        })
        continue
      }

      const um = await materializarUm(admin, {
        tenantId: params.tenantId,
        sessaoId: params.sessaoId,
        atendimentoId: params.atendimentoId,
        clienteId,
        processoId,
        arquivo,
        ext: veredicto.ext,
      })

      if (um) resultado.artefatos.push(um)
      else resultado.falhas++
    }

    if (resultado.artefatos.length > 0) {
      // Espelho do Drive: pega carona no fluxo NORMAL, como qualquer upload.
      await enfileirarDriveSync(admin, params.tenantId, clienteId)
    }

    logger.info('ia.sessao.artefatos', {
      sessaoId: params.sessaoId,
      gerados: resultado.artefatos.length,
      ignorados: resultado.ignorados.length,
      falhas: resultado.falhas,
      exts: resultado.artefatos.map((a) => a.ext),
    })
  } catch (e) {
    logger.error('ia.sessao.artefatos.falha', { sessaoId: params.sessaoId }, e)
    resultado.falhas++
  }

  return resultado
}

/** Um artefato: Storage → linha em `documentos` → vínculos → mapa da sessão. */
async function materializarUm(
  admin: SupabaseAdmin,
  params: {
    tenantId: string
    sessaoId: string
    atendimentoId: string
    clienteId: string
    processoId: string | null
    arquivo: ArquivoAnthropic
    ext: ExtensaoArtefato
  },
): Promise<ArtefatoTurno | null> {
  const { arquivo, ext } = params
  const slug = slugArtefato(arquivo.nome)
  const path = caminhoArtefato({
    tenantId: params.tenantId,
    clienteId: params.clienteId,
    atendimentoId: params.atendimentoId,
    sessaoId: params.sessaoId,
    slug,
    ext,
  })

  try {
    // Mesmo nome lógico nesta sessão? Então é REGERAÇÃO: mesma linha, mesmo path.
    const { data: anexo } = await admin
      .from('pecas_sessoes_anexos')
      .select('id, documento_id')
      .eq('sessao_id', params.sessaoId)
      .eq('slug', slug)
      .eq('origem', 'gerado')
      .maybeSingle()

    const documentoAnterior = (anexo?.documento_id as string | undefined) ?? null

    const { error: upErr } = await admin.storage
      .from('documentos')
      .upload(path, arquivo.bytes, {
        contentType: mimeArtefato(ext, arquivo.mimeType),
        upsert: true,
      })
    if (upErr) {
      logger.error('ia.sessao.artefato.upload', { sessaoId: params.sessaoId, ext }, upErr)
      return null
    }

    const campos = {
      tipo: TIPO_DOCUMENTO_ARTEFATO,
      file_url: path,
      file_name: nomeArtefato(arquivo.nome),
      mime_type: mimeArtefato(ext, arquivo.mimeType),
      tamanho_bytes: arquivo.tamanho,
      texto_extraido: textoExtraidoDeArtefato({ ext, bytes: arquivo.bytes }),
    }

    let documentoId: string
    let atualizado = false

    // A linha anterior ainda existe? (o advogado pode ter removido o artefato)
    const { data: existente } = documentoAnterior
      ? await admin
          .from('documentos')
          .select('id')
          .eq('id', documentoAnterior)
          .eq('tenant_id', params.tenantId)
          .maybeSingle()
      : { data: null }

    if (existente?.id) {
      const { data, error } = await admin
        .from('documentos')
        .update(campos)
        .eq('id', existente.id)
        .eq('tenant_id', params.tenantId)
        .select('id')
        .single()
      if (error || !data) {
        logger.error('ia.sessao.artefato.update', { sessaoId: params.sessaoId, ext }, error)
        return null
      }
      documentoId = data.id as string
      atualizado = true
    } else {
      const { data, error } = await admin
        .from('documentos')
        .insert({
          atendimento_id: params.atendimentoId,
          cliente_id: params.clienteId,
          tenant_id: params.tenantId,
          ...campos,
        })
        .select('id')
        .single()
      if (error || !data) {
        await admin.storage.from('documentos').remove([path]) // não deixa lixo
        logger.error('ia.sessao.artefato.insert', { sessaoId: params.sessaoId, ext }, error)
        return null
      }
      documentoId = data.id as string

      // Atalhos N:N: é por documento_vinculos que a árvore do dossiê lista.
      const vinculos: Array<Record<string, unknown>> = [
        { tenant_id: params.tenantId, documento_id: documentoId, atendimento_id: params.atendimentoId },
      ]
      if (params.processoId) {
        vinculos.push({ tenant_id: params.tenantId, documento_id: documentoId, processo_id: params.processoId })
      }
      const { error: vincErr } = await admin.from('documento_vinculos').insert(vinculos)
      if (vincErr) {
        logger.warn('ia.sessao.artefato.vinculo', { sessaoId: params.sessaoId, code: vincErr.code })
      }
    }

    // Mapa (sessão, nome lógico) → documento: é o que faz a próxima geração
    // substituir esta em vez de duplicar.
    const { error: mapaErr } = await admin
      .from('pecas_sessoes_anexos')
      .upsert(
        {
          sessao_id: params.sessaoId,
          documento_id: documentoId,
          origem: 'gerado',
          slug,
        },
        { onConflict: 'sessao_id,documento_id' },
      )
    if (mapaErr) {
      logger.warn('ia.sessao.artefato.mapa', { sessaoId: params.sessaoId, code: mapaErr.code })
    }

    return {
      documentoId,
      nome: campos.file_name,
      ext,
      tamanho: arquivo.tamanho,
      atualizado,
    }
  } catch (e) {
    logger.error('ia.sessao.artefato', { sessaoId: params.sessaoId, ext }, e)
    return null
  }
}

// ---------------------------------------------------------------------------
// Leitura da sessão (GET) — artefatos que o advogado já removeu do dossiê
// ---------------------------------------------------------------------------

/** Ids de documento citados como artefato nos turnos (payload.artefatos). */
export function idsDosArtefatos(turnos: Array<{ payload: Record<string, unknown> | null }>): string[] {
  const ids = new Set<string>()
  for (const t of turnos) {
    const lista = t.payload?.artefatos
    if (!Array.isArray(lista)) continue
    for (const item of lista) {
      const id = (item as { documentoId?: unknown } | null)?.documentoId
      if (typeof id === 'string' && id) ids.add(id)
    }
  }
  return [...ids]
}

/**
 * Marca `removido: true` nos artefatos cujo documento não existe mais (o
 * advogado apagou pelo card ou pelo dossiê). Uma consulta só, para a UI não
 * oferecer "abrir" em arquivo que sumiu.
 */
export async function marcarArtefatosRemovidos<T extends { payload: Record<string, unknown> | null }>(
  admin: SupabaseAdmin,
  params: { tenantId: string; turnos: T[] },
): Promise<T[]> {
  const ids = idsDosArtefatos(params.turnos)
  if (ids.length === 0) return params.turnos

  const { data } = await admin
    .from('documentos')
    .select('id')
    .in('id', ids)
    .eq('tenant_id', params.tenantId)

  const vivos = new Set(((data ?? []) as Array<{ id: string }>).map((d) => d.id))

  return params.turnos.map((t) => {
    const lista = t.payload?.artefatos
    if (!Array.isArray(lista)) return t
    return {
      ...t,
      payload: {
        ...t.payload,
        artefatos: lista.map((item) => {
          const a = (item ?? {}) as Record<string, unknown>
          const id = typeof a.documentoId === 'string' ? a.documentoId : ''
          return { ...a, removido: !vivos.has(id) }
        }),
      },
    }
  })
}
