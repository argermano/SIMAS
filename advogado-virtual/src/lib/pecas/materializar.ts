// Materialização da peça no dossiê (080): quando a peça chega ao ESTADO FINAL
// (revisão aprovada ou exportada), grava o .docx no bucket `documentos` e cria/
// atualiza a linha em `documentos` vinculada ao CASO (e ao processo do caso, se
// houver) — a árvore do dossiê já lista essa linha. RE-aprovar/RE-exportar a MESMA
// peça ATUALIZA o mesmo documento (chave `peca_id`), nunca duplica.
//
// Efeito colateral BEST-EFFORT: jamais bloqueia nem falha a aprovação/exportação
// (o humano decide o conteúdo/estado — invariante da casa). O espelho do Drive
// pega carona no fluxo NORMAL (enfileirarDriveSync) — nunca chama o Google direto.
// LGPD: logs só ids/contagens, nunca conteúdo/nome/PII. SERVER-ONLY.

import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { gerarDocxComTimbrado, DOCX_MIME } from '@/lib/export/gerar-docx'
import { resolverEstiloEfetivo } from '@/lib/format/estilo-documento'
import { enfileirarDriveSync } from '@/lib/drive/fila'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { logger } from '@/lib/logger'

export interface PecaMaterializavel {
  id: string
  tipo: string
  area: string
  conteudo_markdown: string | null
  atendimento_id: string | null
  tenant_id: string
}

export type MotivoNaoMaterializar = 'sem_conteudo' | 'sem_caso' | 'erro'

export interface MaterializarResultado {
  ok: boolean
  documentoId?: string
  motivo?: MotivoNaoMaterializar
}

/** Nome do tipo de peça legível ("Petição Inicial"), com fallback do slug. */
export function nomeTipoPeca(tipo: string): string {
  return TIPOS_PECA[tipo]?.nome ?? tipo.replace(/_/g, ' ')
}

/** Nome do arquivo materializado: "Peça — <tipo> — <dd/mm/aaaa>.docx". */
export function nomeArquivoPeca(nomeTipo: string, data: Date = new Date()): string {
  const dataBr = data.toLocaleDateString('pt-BR')
  return `Peça — ${nomeTipo} — ${dataBr}.docx`
}

/**
 * Caminho no bucket `documentos` — SEMPRE com prefixo do tenant (RLS do bucket) e
 * único por peça+instante, então nunca sobrescreve o documento de outro fluxo.
 * Fica sob a pasta do caso do cliente: <tenant>/clientes/<cliente>/casos/<caso>/pecas/.
 */
export function caminhoDocxPeca(
  tenantId: string,
  clienteId: string,
  atendimentoId: string,
  pecaId: string,
  ts: number = Date.now(),
): string {
  return `${tenantId}/clientes/${clienteId}/casos/${atendimentoId}/pecas/${pecaId}_${ts}.docx`
}

const admin = () =>
  createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

/**
 * Materializa a peça no dossiê do cliente. `supabase` deve ser o client de SESSÃO
 * (RLS por tenant) — quem chama já validou a posse da peça. `bufferPronto` evita
 * regenerar o .docx quando o chamador (exportação) já o produziu.
 */
export async function materializarPecaNoDossie(
  supabase: SupabaseClient,
  peca: PecaMaterializavel,
  opts?: { bufferPronto?: Buffer },
): Promise<MaterializarResultado> {
  try {
    if (!peca.conteudo_markdown?.trim()) return { ok: false, motivo: 'sem_conteudo' }
    if (!peca.atendimento_id) return { ok: false, motivo: 'sem_caso' }

    // Cliente e processo do caso (o processo vira um 2º atalho no dossiê, se houver).
    const { data: atendimento } = await supabase
      .from('atendimentos')
      .select('id, cliente_id, vinculo_processo_id')
      .eq('id', peca.atendimento_id)
      .eq('tenant_id', peca.tenant_id)
      .single()
    if (!atendimento?.cliente_id) return { ok: false, motivo: 'sem_caso' }
    const clienteId = atendimento.cliente_id as string
    const processoId = (atendimento.vinculo_processo_id as string | null) ?? null

    const nomeTipo = nomeTipoPeca(peca.tipo)

    // Gera (ou reaproveita) o .docx com o MESMO pipeline da exportação.
    let buffer = opts?.bufferPronto
    if (!buffer) {
      const estilo = await resolverEstiloEfetivo(supabase, peca.tenant_id, {
        tipo: 'peca',
        subtipo: peca.tipo,
      })
      buffer = await gerarDocxComTimbrado(supabase, peca.tenant_id, {
        conteudo: peca.conteudo_markdown,
        titulo: nomeTipo,
        area: peca.area,
        estilo,
      })
    }

    const fileName = nomeArquivoPeca(nomeTipo)
    const path = caminhoDocxPeca(peca.tenant_id, clienteId, peca.atendimento_id, peca.id)

    const { error: upErr } = await supabase.storage
      .from('documentos')
      .upload(path, buffer, { contentType: DOCX_MIME, upsert: true })
    if (upErr) {
      logger.error('pecas.materializar.upload', { pecaId: peca.id }, upErr)
      return { ok: false, motivo: 'erro' }
    }

    const camposArquivo = {
      tipo: peca.tipo,
      file_url: path,
      file_name: fileName,
      mime_type: DOCX_MIME,
      tamanho_bytes: buffer.length,
      texto_extraido: peca.conteudo_markdown.slice(0, 5000),
    }

    // Já materializada antes? Atualiza a MESMA linha (uq_documentos_peca) — o
    // documento do caso é único por peça.
    const { data: existente } = await supabase
      .from('documentos')
      .select('id, file_url')
      .eq('peca_id', peca.id)
      .eq('tenant_id', peca.tenant_id)
      .maybeSingle()

    let documentoId: string
    if (existente) {
      const { data, error } = await supabase
        .from('documentos')
        .update(camposArquivo)
        .eq('id', existente.id)
        .eq('tenant_id', peca.tenant_id)
        .select('id')
        .single()
      if (error || !data) {
        await supabase.storage.from('documentos').remove([path]) // não deixa lixo
        logger.error('pecas.materializar.update', { pecaId: peca.id }, error)
        return { ok: false, motivo: 'erro' }
      }
      documentoId = data.id
      // Remove o .docx antigo (best-effort — o path muda a cada materialização).
      if (existente.file_url && existente.file_url !== path) {
        await supabase.storage.from('documentos').remove([existente.file_url as string])
      }
    } else {
      const { data, error } = await supabase
        .from('documentos')
        .insert({
          atendimento_id: peca.atendimento_id,
          cliente_id: clienteId,
          tenant_id: peca.tenant_id,
          peca_id: peca.id,
          ...camposArquivo,
        })
        .select('id')
        .single()
      if (error || !data) {
        await supabase.storage.from('documentos').remove([path])
        logger.error('pecas.materializar.insert', { pecaId: peca.id }, error)
        return { ok: false, motivo: 'erro' }
      }
      documentoId = data.id

      // Atalho N:N na pasta do CASO (é por documento_vinculos que a árvore lista).
      const vinculos: Array<Record<string, unknown>> = [
        { tenant_id: peca.tenant_id, documento_id: documentoId, atendimento_id: peca.atendimento_id },
      ]
      // E na pasta do PROCESSO do caso, se o caso tiver um vinculado (057).
      if (processoId) {
        vinculos.push({ tenant_id: peca.tenant_id, documento_id: documentoId, processo_id: processoId })
      }
      const { error: vincErr } = await supabase.from('documento_vinculos').insert(vinculos)
      if (vincErr) logger.warn('pecas.materializar.vinculo', { pecaId: peca.id, code: vincErr.code })
    }

    // Espelho do Drive: pega carona no fluxo NORMAL (fila), como qualquer upload.
    await enfileirarDriveSync(admin(), peca.tenant_id, clienteId)

    return { ok: true, documentoId }
  } catch (e) {
    logger.error('pecas.materializar', { pecaId: peca.id }, e)
    return { ok: false, motivo: 'erro' }
  }
}
