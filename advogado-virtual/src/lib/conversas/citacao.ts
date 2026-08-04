// Lógica PURA da RESPOSTA COM CITAÇÃO (padrão WhatsApp), sem rede e sem DOM:
// quem pode ser citado, que autor aparece na faixa, que trecho resume a mensagem
// citada e como achar a citada dentro da página carregada da thread.
//
// Contrato com o relay: a mensagem traz `emRespostaA` (id numérico de OUTRA
// mensagem da MESMA conversa, vindo de content_attributes.in_reply_to no
// Chatwoot). A resolução do trecho é LOCAL — nunca pedimos a mensagem citada ao
// servidor: se ela não está na página carregada, a tela mostra um bloco genérico.

import type { Mensagem } from './tipos'

/** Tipos de mídia que a faixa de citação sabe rotular. */
export type MidiaCitada = 'imagem' | 'video' | 'audio' | 'documento' | 'localizacao' | 'contato'

/** Teto do trecho citado (chars). ~90 cabe em duas linhas curtas da faixa. */
export const LIMITE_TRECHO_CITACAO = 90

/**
 * Quem pode ser CITADO/respondido: qualquer mensagem real da conversa, de
 * entrada OU de saída — no WhatsApp responde-se tanto o que o cliente mandou
 * quanto o que o escritório mandou. Ficam de fora as notas internas (não existem
 * no WhatsApp; citá-las vazaria texto interno na citação do cliente) e as linhas
 * de atividade do sistema (não são mensagens).
 */
export function podeResponder(m: Pick<Mensagem, 'direcao' | 'privada'>): boolean {
  return m.direcao !== 'atividade' && !m.privada
}

/** file_type do anexo (normalizado pelo relay) → mídia da citação. */
export function midiaDoTipoAnexo(tipo: string | null | undefined): MidiaCitada {
  switch (tipo) {
    case 'image':
      return 'imagem'
    case 'video':
      return 'video'
    case 'audio':
      return 'audio'
    case 'location':
      return 'localizacao'
    case 'contact':
      return 'contato'
    default:
      return 'documento'
  }
}

/** Rótulo pt-BR da mídia citada ("Foto", "Vídeo", …) — como no WhatsApp. */
export function rotuloMidia(midia: MidiaCitada): string {
  switch (midia) {
    case 'imagem':
      return 'Foto'
    case 'video':
      return 'Vídeo'
    case 'audio':
      return 'Áudio'
    case 'localizacao':
      return 'Localização'
    case 'contato':
      return 'Contato'
    default:
      return 'Documento'
  }
}

/**
 * Trecho de uma linha: quebras e espaços repetidos viram um espaço só (a faixa
 * tem altura fixa) e o corte respeita o limite em PONTOS DE CÓDIGO — cortar por
 * .slice() partiria emoji ao meio (par substituto) e deixaria um caractere
 * quebrado na tela. Só encurta de fato quando passa do limite.
 */
export function encurtarTrecho(texto: string, limite: number = LIMITE_TRECHO_CITACAO): string {
  const limpo = (texto ?? '').replace(/\s+/g, ' ').trim()
  if (limite <= 0) return ''
  const pontos = Array.from(limpo)
  if (pontos.length <= limite) return limpo
  return `${pontos.slice(0, limite).join('').trimEnd()}…`
}

export interface ResumoCitacao {
  /** null quando a mensagem é só texto. */
  midia: MidiaCitada | null
  /** Texto a exibir: a legenda/conteúdo encurtado, ou o rótulo da mídia. */
  trecho: string
}

/**
 * Resumo da mensagem citada para a faixa (composer) e para o bloco dentro da
 * bolha — os dois usam exatamente o mesmo texto, de propósito.
 *  • só texto  → trecho encurtado
 *  • mídia com legenda → mídia + legenda encurtada (WhatsApp mostra a legenda)
 *  • mídia sem legenda → mídia + rótulo ("Foto", "Áudio", …)
 *  • nada      → "Mensagem" (defensivo: mensagem sem conteúdo e sem anexo)
 */
export function resumoCitacao(
  m: Pick<Mensagem, 'conteudo' | 'anexos'>,
  limite: number = LIMITE_TRECHO_CITACAO,
): ResumoCitacao {
  const primeiro = (m.anexos ?? [])[0]
  const midia = primeiro ? midiaDoTipoAnexo(primeiro.tipo) : null
  const texto = encurtarTrecho(m.conteudo ?? '', limite)
  if (texto) return { midia, trecho: texto }
  if (midia) return { midia, trecho: rotuloMidia(midia) }
  return { midia: null, trecho: 'Mensagem' }
}

/**
 * Autor mostrado na citação. Saída do próprio agente conectado vira "Você"
 * (padrão WhatsApp); as demais usam o nome que o relay já entrega.
 *
 * A entrada prefere o SENDER da mensagem, não o contato da conversa: em GRUPO o
 * contato é o grupo ("Escritório pai") e o sender é quem de fato escreveu —
 * citar pelo contato apagaria o participante e ainda contradiria o rótulo que a
 * própria bolha citada exibe. O nome do contato fica de reserva para quando o
 * relay não manda sender (mensagem do espelho, relay antigo).
 */
export function autorCitacao(
  m: Pick<Mensagem, 'direcao' | 'sender'>,
  opts?: { nomeContato?: string | null; nomeAgente?: string | null },
): string {
  const doSender = m.sender?.nome?.trim() ?? ''
  if (m.direcao === 'entrada') {
    return doSender || opts?.nomeContato?.trim() || 'Cliente'
  }
  const agente = opts?.nomeAgente?.trim() ?? ''
  if (m.sender?.tipo === 'agente' && agente && doSender && agente === doSender) return 'Você'
  return doSender || 'Você'
}

/**
 * Acha a mensagem citada DENTRO da página já carregada da thread. null quando
 * não há citação ou quando a citada ficou fora da página — nesse caso a tela
 * mostra o bloco genérico "Mensagem anterior", sem nenhuma busca extra ao
 * servidor (regra do módulo: a citação nunca dispara fetch).
 */
export function resolverCitada(
  mensagens: Mensagem[],
  emRespostaA: number | null | undefined,
): Mensagem | null {
  if (typeof emRespostaA !== 'number' || !Number.isFinite(emRespostaA)) return null
  return mensagens.find((m) => m.id === emRespostaA) ?? null
}

/**
 * Índice id → mensagem da página carregada. A thread resolve N citações contra
 * N mensagens; com o índice isso é O(N) em vez de O(N²) a cada re-render.
 */
export function indexarPorId(mensagens: Mensagem[]): Map<number, Mensagem> {
  const mapa = new Map<number, Mensagem>()
  for (const m of mensagens) mapa.set(m.id, m)
  return mapa
}
