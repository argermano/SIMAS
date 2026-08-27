// Resumo automático dos documentos GRANDES do dossiê (F0.3, §6.3 do plano).
//
// O problema real: 16 fichas financeiras de 50 páginas não cabem no prompt de
// uma rodada de lapidação — e, mesmo cabendo, custariam uma fortuna a cada
// rodada. A saída não é truncar em silêncio (o que faz a IA "não ver" a prova):
// é dar ao agente um RESUMO objetivo do documento + o aviso de que a íntegra
// existe e pode ser pedida em trechos.
//
// O resumo é gerado UMA vez por documento (Haiku, ~US$ 0,01) e fica em
// `documentos.resumo_ia` (migration 085). Idempotente e best-effort: se a IA
// falhar, o documento volta a entrar truncado com marca — nunca some.

import { completionText } from '@/lib/anthropic/client'
import { safeLogUsage } from '@/lib/anthropic/usage'
import { logger } from '@/lib/logger'
import type { SupabaseAdmin } from '@/lib/ia/sessao/sessoes'

/** Acima disso o documento entra como resumo (mesmo teto por documento dos prompts). */
export const LIMITE_RESUMO_CHARS = 30_000

/** Modelo de leitura em massa (§4 do plano): barato e suficiente para resumir. */
export const MODELO_RESUMO = 'claude-haiku-4-5-20251001'

/** Teto de saída: ~300 tokens de resumo cabem folgados em 1024. */
export const MAX_TOKENS_RESUMO = 1024

/**
 * Teto de ENTRADA do resumo. Haiku 4.5 tem janela de 200k tokens; 400k
 * caracteres (~100k tokens) deixam margem confortável para o system e a saída.
 */
const MAX_CHARS_ENTRADA = 400_000

const SYSTEM_RESUMO = `Você resume documentos jurídicos e administrativos brasileiros para um advogado que vai usá-los como prova em uma peça processual.

REGRAS:
- Máximo de 300 palavras, em português, sem preâmbulo ("Este documento...", "Segue o resumo...").
- Diga O QUE É o documento, o PERÍODO que cobre e QUEM são as partes/órgãos citados.
- Liste os dados objetivos que um advogado procuraria: datas, valores, números de benefício/processo/contrato, vínculos, cargos, decisões e fundamentos.
- Preserve números LITERALMENTE. Nunca arredonde, nunca estime, nunca invente um dado que não está no texto.
- Se o documento for uma tabela/extrato repetitivo, descreva a estrutura (colunas, período, quantidade de linhas) e destaque os extremos e as anomalias.
- Termine com uma linha "Para conferir na íntegra: <o que precisa ser lido no documento original>".
- Não opine sobre o mérito, não sugira teses e não escreva conclusões jurídicas.`

/**
 * Garante o `resumo_ia` de um documento grande. Devolve o resumo (existente ou
 * recém-criado) ou null quando o documento não precisa de resumo / a geração
 * falhou. NUNCA lança: quem chama está montando o contexto de uma rodada e não
 * pode cair por causa de um resumo.
 */
export async function garantirResumoIA(
  admin: SupabaseAdmin,
  params: { documentoId: string; tenantId: string; userId?: string | null },
): Promise<string | null> {
  const inicio = Date.now()
  try {
    const { data: doc } = await admin
      .from('documentos')
      .select('id, tenant_id, texto_extraido, resumo_ia, file_name, tipo')
      .eq('id', params.documentoId)
      .eq('tenant_id', params.tenantId)
      .maybeSingle()

    if (!doc) return null

    const texto = ((doc.texto_extraido as string | null) ?? '')
    const resumoExistente = ((doc.resumo_ia as string | null) ?? '').trim()
    if (resumoExistente) return resumoExistente
    if (texto.length <= LIMITE_RESUMO_CHARS) return null

    const { text, usage } = await completionText({
      system: SYSTEM_RESUMO,
      prompt: [
        `Documento: ${doc.file_name} (tipo: ${doc.tipo}).`,
        `Tamanho do texto extraído: ${texto.length.toLocaleString('pt-BR')} caracteres.`,
        '',
        '--- INÍCIO DO DOCUMENTO ---',
        texto.slice(0, MAX_CHARS_ENTRADA),
        '--- FIM DO DOCUMENTO ---',
      ].join('\n'),
      model: MODELO_RESUMO,
      maxTokens: MAX_TOKENS_RESUMO,
    })

    const resumo = text.trim()
    if (!resumo) return null

    const { error } = await admin
      .from('documentos')
      .update({ resumo_ia: resumo })
      .eq('id', params.documentoId)
      .eq('tenant_id', params.tenantId)
    if (error) {
      // O resumo serve para esta rodada mesmo sem ter sido persistido.
      logger.warn('documentos.resumo_ia.persistencia_falhou', { documentoId: params.documentoId })
    }

    await safeLogUsage({
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      endpoint: 'resumo_documento',
      modelo: MODELO_RESUMO,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      tokensCacheRead: usage.cacheRead,
      tokensCacheWrite: usage.cacheWrite,
      latenciaMs: Date.now() - inicio,
      origem: 'messages',
    })

    // LGPD: só ids e tamanhos — jamais o texto do documento ou do resumo.
    logger.info('documentos.resumo_ia.gerado', {
      documentoId: params.documentoId,
      chars: texto.length,
      charsResumo: resumo.length,
    })

    return resumo
  } catch (e) {
    logger.warn('documentos.resumo_ia.falhou', {
      documentoId: params.documentoId,
      causa: e instanceof Error ? e.name : 'desconhecida',
    })
    return null
  }
}

/**
 * Resume, em paralelo, todos os documentos grandes ainda sem resumo. O retorno
 * é um mapa documentoId → resumo, aplicado sobre a lista já carregada (evita
 * um segundo SELECT depois da geração).
 */
export async function garantirResumosDosGrandes(
  admin: SupabaseAdmin,
  params: {
    tenantId: string
    userId?: string | null
    documentos: Array<{ id: string; texto_extraido: string | null; resumo_ia?: string | null }>
  },
): Promise<Map<string, string>> {
  const pendentes = params.documentos.filter(
    (d) => (d.texto_extraido ?? '').length > LIMITE_RESUMO_CHARS && !(d.resumo_ia ?? '').trim(),
  )
  const mapa = new Map<string, string>()
  if (pendentes.length === 0) return mapa

  const resultados = await Promise.all(
    pendentes.map(async (d) => ({
      id: d.id,
      resumo: await garantirResumoIA(admin, { documentoId: d.id, tenantId: params.tenantId, userId: params.userId }),
    })),
  )
  for (const r of resultados) if (r.resumo) mapa.set(r.id, r.resumo)
  return mapa
}
