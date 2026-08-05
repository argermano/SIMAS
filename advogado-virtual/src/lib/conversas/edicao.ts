// Lógica PURA do EDITAR MENSAGEM ENVIADA (padrão WhatsApp), sem rede e sem DOM.
// Compartilhada pela bolha (mostra ou não a ação) e pela rota PATCH
// /api/conversas/[id]/mensagens/[mensagemId] (revalida antes de tocar o VPS) —
// a regra mora AQUI, em um lugar só: tela e servidor nunca podem discordar sobre
// o que é editável.
//
// Como a edição chega ao WhatsApp: SIMAS → ai-attendant (POST /editar) →
// Evolution (PUT /chat/updateMessage). O aviso "Editada: <novo texto>" que
// aparece no Chatwoot é postado pelo PRÓPRIO Evolution — o SIMAS não escreve
// nada lá (o Chatwoot não tem API de editar conteúdo; o acompanhamento É o
// padrão da ponte).

import type { Mensagem } from './tipos'

/**
 * Janela de edição. O WhatsApp aceita editar mensagem própria por ~15 minutos;
 * usamos 14 de propósito — a margem cobre o relógio do servidor × o do celular e
 * os segundos que a requisição leva para atravessar SIMAS → VPS → Evolution.
 * Oferecer o botão no minuto 14:59 seria prometer o que a ponta pode recusar.
 */
export const JANELA_EDICAO_MS = 14 * 60_000

/**
 * Tolerância do casamento por CONTEÚDO+TEMPO entre uma mensagem do Chatwoot e a
 * linha do acervo (último degrau da escada do WAID). 10 min é folgado em relação
 * à janela de edição e ainda assim curto o bastante para não pescar um texto
 * repetido de outra hora ("ok", "obrigado").
 */
export const JANELA_MATCH_ACERVO_MS = 10 * 60_000

/** O mínimo que `podeEditar` precisa saber — a Mensagem do relay já satisfaz. */
export type MensagemEditavel = Pick<
  Mensagem,
  'direcao' | 'privada' | 'conteudo' | 'anexos' | 'timestamp'
>

/**
 * Quanto ainda resta da janela de edição, em ms (negativo = já passou).
 * `timestamp` do relay é EPOCH em SEGUNDOS (contrato de tipos.ts).
 * A bolha usa isto para agendar o desaparecimento da ação no instante exato em
 * que a janela fecha, em vez de deixar um botão que promete e falha.
 */
export function restanteEdicaoMs(m: Pick<Mensagem, 'timestamp'>, agoraMs: number): number {
  const ts = m.timestamp
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return -1
  return ts * 1000 + JANELA_EDICAO_MS - agoraMs
}

/**
 * Pode editar? Só o que o WhatsApp de fato deixa corrigir:
 *  • SAÍDA — mensagem própria (editar a do cliente não existe);
 *  • NÃO privada — nota interna vive só no Chatwoot, que não tem API de edição;
 *  • TEXTO PURO — mídia com legenda não é editável pelo updateMessage;
 *  • com texto — não há o que corrigir numa mensagem vazia;
 *  • dentro da JANELA (inclusive no limite exato: `<=`).
 * Atividade do sistema cai fora por não ser 'saida'.
 */
export function podeEditar(m: MensagemEditavel, agoraMs: number): boolean {
  if (m.direcao !== 'saida') return false
  if (m.privada) return false
  if ((m.anexos ?? []).length > 0) return false
  if (!(m.conteudo ?? '').trim()) return false
  return restanteEdicaoMs(m, agoraMs) >= 0
}

/**
 * WAID (key.id da Evolution) escondido no source_id do Chatwoot: a ponte nativa
 * grava 'WAID:<key.id>'. Qualquer outro formato (mensagem criada no painel do
 * Chatwoot, relay antigo, campo vazio) → null, e o chamador desce a escada.
 * Mesma leitura de `mensagemIdDeChatwoot` no backfill do acervo — aqui isolada
 * porque o que interessa é "tem WAID ou não", sem inventar id sintético.
 */
export function waIdDoSourceId(sourceId: string | null | undefined): string | null {
  const bruto = (sourceId ?? '').trim()
  const m = /^WAID:(.+)$/i.exec(bruto)
  if (!m) return null
  const id = m[1].trim()
  return id ? id : null
}

/**
 * Texto normalizado para COMPARAÇÃO (nunca para gravar): espaços colapsados e
 * pontas aparadas. O Chatwoot e a Evolution divergem em quebras de linha e
 * espaços à toa no mesmo texto — comparar cru perderia o casamento.
 */
export function normalizarTextoComparacao(texto: string | null | undefined): string {
  return (texto ?? '').replace(/\s+/g, ' ').trim()
}

/** Linha de conversa_mensagens, no recorte que o casamento consulta. */
export interface LinhaAcervoMatch {
  mensagem_id: string
  texto: string | null
  /** timestamp_msg (ISO / parseável por Date). */
  timestamp_msg: string
  de_mim: boolean
  tipo: string
}

/** A mensagem do Chatwoot que queremos localizar no acervo. */
export interface AlvoMatch {
  conteudo: string
  /** created_at da mensagem do Chatwoot em ISO. */
  criadaEmIso: string
}

/**
 * Último degrau da escada do WAID: acha, entre as linhas do acervo, a que É esta
 * mensagem do Chatwoot. Critérios (todos obrigatórios):
 *  • de_mim (só editamos o que saiu do nosso número) e tipo 'texto';
 *  • texto idêntico após normalização;
 *  • |Δt| dentro de JANELA_MATCH_ACERVO_MS.
 * Empate (o mesmo texto enviado duas vezes) → vence o de MENOR |Δt|; nenhuma
 * candidata → null, e a rota responde "não localizei essa mensagem no WhatsApp"
 * em vez de editar a mensagem errada do cliente.
 */
export function acharWaidNoAcervo(
  linhas: LinhaAcervoMatch[],
  alvo: AlvoMatch,
): string | null {
  const alvoTexto = normalizarTextoComparacao(alvo.conteudo)
  if (!alvoTexto) return null
  const alvoMs = Date.parse(alvo.criadaEmIso)
  if (!Number.isFinite(alvoMs)) return null

  let melhor: { id: string; delta: number } | null = null
  for (const l of linhas ?? []) {
    if (!l || l.de_mim !== true || l.tipo !== 'texto') continue
    if (!l.mensagem_id) continue
    if (normalizarTextoComparacao(l.texto) !== alvoTexto) continue
    const ms = Date.parse(l.timestamp_msg)
    if (!Number.isFinite(ms)) continue
    const delta = Math.abs(ms - alvoMs)
    if (delta > JANELA_MATCH_ACERVO_MS) continue
    if (!melhor || delta < melhor.delta) melhor = { id: l.mensagem_id, delta }
  }
  return melhor ? melhor.id : null
}

/** Motivo (pt-BR) de a mensagem não ser editável — texto único, tela e API. */
export const MOTIVO_NAO_EDITAVEL =
  'Só dá para editar mensagens de texto enviadas por você há menos de 14 minutos.'
