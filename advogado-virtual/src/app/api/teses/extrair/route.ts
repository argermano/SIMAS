import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { extrairTextoDeArquivo } from '@/lib/extracao/ler-arquivo'
import { SYSTEM_EXTRAIR_TESES, buildPromptExtrairTeses, type TeseExtraida } from '@/lib/prompts/teses/extrair-teses'
import { verificarCitacoesOnline } from '@/lib/jurisprudencia/verificador-citacoes-online'
import { similaridadeTexto } from '@/lib/telemetria/similaridade'
import { AREAS } from '@/lib/constants/areas'
import { logger } from '@/lib/logger'

export const maxDuration = 300

const MAX_FILE_SIZE = 25 * 1024 * 1024
const MAX_TEXTO_CHARS = 120_000
const LIMIAR_DEDUP = 0.75

// POST /api/teses/extrair — recebe UMA peça do escritório, extrai teses e as
// grava como SUGESTÕES (status='sugerida') para o advogado revisar. O cliente
// itera sobre vários arquivos, um por chamada.
export async function POST(req: Request) {
  const start = Date.now()

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!(usuario.role === 'admin' || usuario.role === 'advogado')) {
    return jsonError('Sem permissão para minerar teses', 403)
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return jsonError('Arquivo não enviado', 400)
  if (file.size > MAX_FILE_SIZE) return jsonError('Arquivo excede 25 MB', 413)

  const buffer = Buffer.from(await file.arrayBuffer())
  const { texto, erro } = await extrairTextoDeArquivo(buffer, file.name, file.type)
  if (erro) return jsonError(erro, 400)
  if (texto.trim().length < 400) {
    return NextResponse.json({ sugeridas: 0, duplicadas: 0, aviso: 'Pouco texto extraído — verifique o arquivo.' })
  }

  const areas = Object.values(AREAS)
    .filter((a) => a.ativo)
    .map((a) => ({ id: a.id, nome: a.nome }))

  // Extração das teses via IA.
  let extraidas: TeseExtraida[] = []
  try {
    const { result, usage } = await completionJSON<{ teses: TeseExtraida[] }>({
      system: SYSTEM_EXTRAIR_TESES,
      prompt: buildPromptExtrairTeses(texto.slice(0, MAX_TEXTO_CHARS), areas),
    })
    extraidas = Array.isArray(result?.teses) ? result.teses : []
    await logUsage({
      tenantId: usuario.tenant_id, userId: usuario.id, endpoint: 'extrair_teses',
      modelo: DEFAULT_MODEL, tokensInput: usage.input, tokensOutput: usage.output,
      latenciaMs: Date.now() - start,
    })
  } catch (err) {
    logger.error('teses.extrair.falha', { arquivo: file.name }, err)
    return jsonError('Não foi possível analisar a peça. Tente novamente.', 500)
  }

  if (extraidas.length === 0) {
    return NextResponse.json({ sugeridas: 0, duplicadas: 0 })
  }

  // Dedup contra as teses existentes do tenant (sugeridas + aprovadas).
  const { data: existentes } = await supabase
    .from('teses_escritorio')
    .select('tese')
    .eq('tenant_id', usuario.tenant_id)
    .in('status', ['sugerida', 'aprovada'])
  const enunciados = (existentes ?? []).map((t) => t.tese as string)

  const novas = extraidas.filter((t) => {
    if (!t.tese || t.tese.trim().length < 15) return false
    return !enunciados.some((e) => similaridadeTexto(t.tese, e) >= LIMIAR_DEDUP)
  })
  const duplicadas = extraidas.length - novas.length

  // Verificador de citações em cada sugestão (roda antes da revisão humana).
  const idsAreas = new Set<string>(areas.map((a) => a.id))
  const registros = await Promise.all(novas.map(async (t) => {
    const textoCitacoes = [
      ...(t.dispositivos ?? []),
      ...(t.sumulas ?? []),
      ...((t.ementas ?? []).map((e) => e.processo).filter(Boolean) as string[]),
    ].join('. ')
    let verificacao = null
    try {
      verificacao = textoCitacoes.trim() ? await verificarCitacoesOnline(textoCitacoes) : null
    } catch { /* verificação é best-effort */ }

    return {
      tenant_id: usuario.tenant_id,
      area: idsAreas.has(t.area) ? t.area : 'civel',
      status: 'sugerida' as const,
      tese: t.tese.trim(),
      dispositivos: t.dispositivos ?? [],
      sumulas: t.sumulas ?? [],
      ementas: t.ementas ?? [],
      quando_usar: t.quando_usar ?? null,
      verificacao,
      origem_arquivo: file.name,
      trecho_origem: t.trecho_origem ?? null,
      criada_por: usuario.id,
    }
  }))

  if (registros.length > 0) {
    const { error } = await supabase.from('teses_escritorio').insert(registros)
    if (error) {
      logger.error('teses.extrair.insert_falha', { arquivo: file.name }, error)
      return jsonError('Teses analisadas, mas falha ao salvar. Tente novamente.', 500)
    }
  }

  // Arquiva o original (best-effort — auditoria da origem).
  try {
    await supabase.storage.from('documentos').upload(
      `${usuario.tenant_id}/teses-uploads/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
      buffer,
      { contentType: file.type || 'application/octet-stream', upsert: false },
    )
  } catch { /* arquivamento é opcional */ }

  logger.info('teses.extrair', { arquivo: file.name, sugeridas: registros.length, duplicadas })
  return NextResponse.json({ sugeridas: registros.length, duplicadas })
}
