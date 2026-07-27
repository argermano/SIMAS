import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventoConversa } from './contrato'
import {
  conversaChave,
  conversasDoLote,
  deduplicarEventos,
  linhaMensagem,
  patchDeConversa,
  type ConversaExistente,
} from './normalizar'

/**
 * Ingestão de um lote de eventos no acervo (migration 082). Chamado pela rota
 * POST /api/integracao/conversas/eventos — a rota só autentica, valida e chama
 * daqui (route.ts só exporta handlers).
 *
 * É INLINE (sem fila): são 3 a 4 queries por lote de até 50 eventos, todas
 * leves. A durabilidade mora do lado do encaminhador (buffer em disco no VPS +
 * re-tentativa do lote inteiro); do nosso lado o que garante segurança do retry
 * é o UNIQUE (tenant_id, instancia, mensagem_id) com ON CONFLICT DO NOTHING.
 *
 * Erro de banco vira exceção → a rota devolve 5xx → o VPS re-envia o lote.
 * Nunca devolver 2xx com falha parcial silenciosa: 2xx significa "consumi".
 */

export class ErroIngestao extends Error {
  constructor(public etapa: string) {
    super(`Falha na ingestão do acervo (${etapa})`)
    this.name = 'ErroIngestao'
  }
}

export interface ResultadoIngestao {
  aceitos: number
  duplicados: number
  /**
   * Ids das conversas tocadas pelo lote — o gatilho quente da Etapa 1
   * (reconciliação em after()) precisa saber QUAIS conversas olhar.
   */
  conversaIds: string[]
}

export async function ingerirEventos(
  admin: SupabaseClient,
  tenantId: string,
  eventos: EventoConversa[],
): Promise<ResultadoIngestao> {
  const { unicos, duplicadosNoLote } = deduplicarEventos(eventos)
  if (unicos.length === 0) return { aceitos: 0, duplicados: duplicadosNoLote, conversaIds: [] }

  const desejadas = conversasDoLote(unicos)

  // 1) Cria as conversas que ainda não existem. ON CONFLICT DO NOTHING: quem já
  //    existe é preservado (o UPDATE seletivo vem no passo 3) — um upsert com
  //    DO UPDATE apagaria o título de um grupo num evento sem subject.
  const { error: erroConversas } = await admin.from('conversas_acervo').upsert(
    desejadas.map((c) => ({
      tenant_id: tenantId,
      instancia: c.instancia,
      jid: c.jid,
      tipo: c.tipo,
      titulo: c.titulo,
      ultima_mensagem_em: c.ultimaMensagemEm,
    })),
    { onConflict: 'tenant_id,instancia,jid', ignoreDuplicates: true },
  )
  if (erroConversas) throw new ErroIngestao('conversas_upsert')

  // 2) Carrega os ids (das criadas agora e das que já existiam).
  const { data: linhasConversa, error: erroSelect } = await admin
    .from('conversas_acervo')
    .select('id, instancia, jid, tipo, titulo, ultima_mensagem_em')
    .eq('tenant_id', tenantId)
    .in('instancia', [...new Set(desejadas.map((c) => c.instancia))])
    .in('jid', [...new Set(desejadas.map((c) => c.jid))])
  if (erroSelect) throw new ErroIngestao('conversas_select')

  const porChave = new Map<string, ConversaExistente>()
  for (const linha of linhasConversa ?? []) {
    porChave.set(conversaChave(linha.instancia as string, linha.jid as string), {
      id: linha.id as string,
      tipo: (linha.tipo as string | null) ?? null,
      titulo: (linha.titulo as string | null) ?? null,
      ultima_mensagem_em: (linha.ultima_mensagem_em as string | null) ?? null,
    })
  }

  // 3) Atualiza só o que mudou (ultima_mensagem_em só avança; título não some).
  for (const desejada of desejadas) {
    const existente = porChave.get(desejada.chave)
    if (!existente) throw new ErroIngestao('conversa_ausente')
    const patch = patchDeConversa(existente, desejada)
    if (!patch) continue
    const { error } = await admin
      .from('conversas_acervo')
      .update(patch)
      .eq('id', existente.id)
      .eq('tenant_id', tenantId)
    if (error) throw new ErroIngestao('conversa_update')
  }

  // 4) Mensagens: ON CONFLICT DO NOTHING pelo UNIQUE (tenant, instancia,
  //    mensagem_id). O .select('id') devolve SÓ as linhas realmente inseridas —
  //    é daí que sai a contagem de aceitos × duplicados.
  const linhas = unicos.map((evento) => {
    const conversa = porChave.get(conversaChave(evento.instancia, evento.conversaJid))
    if (!conversa) throw new ErroIngestao('conversa_ausente')
    return linhaMensagem(evento, { tenantId, conversaId: conversa.id })
  })

  const { data: inseridas, error: erroMensagens } = await admin
    .from('conversa_mensagens')
    .upsert(linhas, {
      onConflict: 'tenant_id,instancia,mensagem_id',
      ignoreDuplicates: true,
    })
    .select('id')
  if (erroMensagens) throw new ErroIngestao('mensagens_upsert')

  const aceitos = inseridas?.length ?? 0
  // Conversas do lote (sem repetição) — insumo do gatilho de reconciliação.
  const conversaIds = [
    ...new Set(
      desejadas
        .map((d) => porChave.get(d.chave)?.id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ]
  return {
    aceitos,
    duplicados: duplicadosNoLote + (unicos.length - aceitos),
    conversaIds,
  }
}
