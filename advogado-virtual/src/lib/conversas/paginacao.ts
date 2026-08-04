// Helpers PUROS da paginação RETROATIVA da thread (histórico estilo WhatsApp),
// sem rede e sem DOM.
//
// Contrato com o relay: GET /conversations/:id/messages?before=<id> devolve as
// ~20 mensagens ANTERIORES ao id passado, no mesmo shape da primeira página.
// Os ids do Chatwoot são monotônicos no tempo, então ordenar por id é ordenar
// cronologicamente — e o MENOR id já carregado é o cursor da próxima página
// para trás.

import type { Mensagem } from './tipos'

/**
 * Junta duas listas por id (upsert: `novas` prevalecem sobre `atuais`) e
 * devolve tudo ordenado por id crescente.
 *
 * Serve aos DOIS caminhos da thread, de propósito:
 *  • prepend do histórico — a página anterior entra na frente sozinha;
 *  • refresh silencioso (polling / pós-envio) — a página recente ATUALIZA o que
 *    está na tela sem descartar o histórico que o usuário já puxou. Trocar a
 *    lista inteira pela resposta do refresh apagaria tudo o que veio antes.
 *
 * Consequência aceita: uma mensagem apagada no Chatwoot continua na tela até
 * recarregar a conversa — preservar o histórico paginado vale mais.
 */
export function mesclarMensagens(atuais: Mensagem[], novas: Mensagem[]): Mensagem[] {
  const porId = new Map<number, Mensagem>()
  for (const m of atuais) porId.set(m.id, m)
  for (const m of novas) porId.set(m.id, m)
  return Array.from(porId.values()).sort((a, b) => a.id - b.id)
}

/** Menor id da lista (cursor do `before=`); null quando não há mensagens. */
export function menorId(mensagens: Mensagem[]): number | null {
  let menor: number | null = null
  for (const m of mensagens) if (menor === null || m.id < menor) menor = m.id
  return menor
}
