// server-only: núcleo compartilhado do "enviar WhatsApp ao cliente" — usado pela
// rota do CASO (/api/atendimentos/[id]/whatsapp) e pela rota POR CLIENTE
// (/api/clientes/[id]/whatsapp). Extraído para um único ponto de verdade: as duas
// telas validam o MESMO cliente nos anexos e disparam TUDO pelo canal do bot
// (Evolution) — texto via enviarAvisoWhatsApp, anexos via enviarMediaWhatsApp
// (o texto vira legenda do 1º anexo). Nenhuma regra de negócio muda em relação ao
// que a rota do caso já fazia; só passou a morar aqui.
// SERVER-ONLY: carregarBytesAnexo usa SERVICE_ROLE_KEY; nunca importar no cliente.

import type { createClient } from '@/lib/supabase/server'
import { apenasDigitos } from '@/lib/conversas/telefone'
import { enviarAvisoWhatsApp, enviarMediaWhatsApp } from '@/lib/processos/notificar'
import type { Instancia } from '@/lib/conversas/instancia'
import { carregarBytesAnexo } from '@/lib/conversas/anexo-documento'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

// Cada anexo é exatamente um: documento do bucket XOR peça (exportada em .docx).
export interface AnexoRef {
  documentoId?: string
  pecaId?: string
}

export type ResultadoOk = { ok: true; enviados: string[] }
export type ResultadoErro = { ok: false; erro: string; status: number }
export type Resultado = ResultadoOk | ResultadoErro

/**
 * Telefone com dígitos suficientes para envio (DDD + número, com ou sem DDI).
 * PURO (sem rede) — testável isoladamente. Espelha a checagem que as rotas usavam.
 */
export function telefoneEnvioValido(telefone: string | null | undefined): boolean {
  return !!telefone && apenasDigitos(telefone).length >= 10
}

/**
 * LGPD/segurança: todo anexo tem de ser DESTE cliente. Sem isso, um id de
 * documento/peça de OUTRO cliente do mesmo tenant vazaria para o WhatsApp deste
 * (carregarBytesAnexo só valida o tenant). A UI já filtra por cliente; aqui é a
 * checagem real do servidor. Documento: cliente_id direto; peça: via
 * atendimentos.cliente_id (peça não tem cliente_id próprio).
 */
export async function validarAnexosDoCliente(args: {
  supabase: SupabaseServer
  tenantId: string
  clienteId: string
  anexos: AnexoRef[]
}): Promise<{ ok: true } | ResultadoErro> {
  const { supabase, tenantId, clienteId, anexos } = args
  const docIds = [...new Set(anexos.filter((a) => a.documentoId).map((a) => a.documentoId!))]
  const pecaIds = [...new Set(anexos.filter((a) => a.pecaId).map((a) => a.pecaId!))]

  if (docIds.length > 0) {
    const { data: docsOk } = await supabase
      .from('documentos')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('cliente_id', clienteId)
      .in('id', docIds)
    if ((docsOk?.length ?? 0) !== docIds.length) {
      return { ok: false, erro: 'Documento não pertence a este cliente', status: 403 }
    }
  }
  if (pecaIds.length > 0) {
    const { data: pecasOk } = await supabase
      .from('pecas')
      .select('id, atendimentos!inner(cliente_id)')
      .eq('tenant_id', tenantId)
      .eq('atendimentos.cliente_id', clienteId)
      .in('id', pecaIds)
    if ((pecasOk?.length ?? 0) !== pecaIds.length) {
      return { ok: false, erro: 'Peça não pertence a este cliente', status: 403 }
    }
  }
  return { ok: true }
}

/**
 * Dispara a mensagem ao WhatsApp do cliente pelo canal do bot. Dois caminhos:
 *  - SEM anexos: um único texto (enviarAvisoWhatsApp).
 *  - COM anexos: sendMedia por anexo (o 1º leva o texto como legenda). Funciona
 *    para QUALQUER número, mesmo cliente novo sem conversa aberta no Chatwoot.
 * Em falha parcial (algo já saiu) devolve 502 com a contagem — nunca finge "tudo
 * ok". As mensagens de erro são idênticas às que a rota do caso já retornava.
 * NÃO valida posse dos anexos — chame validarAnexosDoCliente antes.
 * `instancia` (opcional) escolhe o número de saída; ausente → roteia pelo DDD.
 */
export async function despacharWhatsAppCliente(args: {
  supabase: SupabaseServer
  tenantId: string
  telefone: string
  texto?: string
  anexos?: AnexoRef[]
  instancia?: Instancia | null
}): Promise<Resultado> {
  const { supabase, tenantId, telefone, texto, anexos, instancia } = args
  const temAnexos = (anexos?.length ?? 0) > 0

  // ── Caminho SEM anexos: um único texto ─────────────────────────────────────
  // autor 'atendente': aqui SEMPRE é um humano escrevendo pelo modal — o bot
  // pausa a IA daquela conversa (senão ele conversa por cima da atendente).
  if (!temAnexos) {
    const r = await enviarAvisoWhatsApp(telefone, texto!, instancia, 'atendente')
    if (!r.ok) return { ok: false, erro: 'Falha ao enviar pelo WhatsApp — tente novamente', status: 502 }
    return { ok: true, enviados: [] }
  }

  // ── Caminho COM anexos: sendMedia (texto = legenda do 1º) ───────────────────
  const lista = anexos!
  const enviados: string[] = []
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i]
    const anexo = await carregarBytesAnexo({
      supabase,
      tenantId,
      documentoId: a.documentoId,
      pecaId: a.pecaId,
    })
    if (!anexo.ok) {
      // Nada saiu ainda → erro "limpo" com o status do helper; algo já saiu →
      // 502 de sucesso parcial (o cliente já recebeu parte — não fingir tudo ok).
      if (enviados.length === 0) return { ok: false, erro: anexo.erro, status: anexo.status }
      return { ok: false, erro: `Enviei ${enviados.length} de ${lista.length}. O anexo seguinte falhou: ${anexo.erro}`, status: 502 }
    }

    const r = await enviarMediaWhatsApp(
      telefone,
      { base64: anexo.bytes.toString('base64'), filename: anexo.filename, mimetype: anexo.contentType },
      // Só o PRIMEIRO anexo leva o texto como legenda (mantém a ordem).
      i === 0 ? texto ?? '' : '',
      instancia,
      'atendente',
    )
    if (!r.ok) {
      if (enviados.length === 0) {
        return { ok: false, erro: 'Falha ao enviar o anexo pelo WhatsApp — tente novamente', status: 502 }
      }
      return { ok: false, erro: `Enviei ${enviados.length} de ${lista.length}; "${anexo.filename}" falhou.`, status: 502 }
    }
    enviados.push(anexo.filename)
  }

  return { ok: true, enviados }
}
