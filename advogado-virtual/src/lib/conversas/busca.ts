// Matcher PURO da busca de conversas (usado no filtro cliente e na varredura
// global do /conversas). Sem rede/DOM: fácil de testar. Casa por nome/última
// mensagem (case + acento-insensível) OU telefone (quando a busca parece número).

import { apenasDigitos, mesmoTelefone } from './telefone'
import type { Conversa } from './tipos'

/** minúsculas + sem acentos — tolera "José"/"jose", "São"/"sao". */
export function normalizarBusca(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** A busca "parece número"? (≥ 3 dígitos evita casar telefone com "ana 4"). */
export function pareceNumero(termo: string): boolean {
  return apenasDigitos(termo).length >= 3
}

/**
 * A conversa casa o termo? Nome ou última mensagem (case+acento-insensível), OU
 * — quando a busca parece número — telefone por mesmoTelefone (tolera máscara/
 * DDI/9º dígito) ou por inclusão dos dígitos (buscas parciais). Termo vazio casa
 * tudo (sem filtro).
 */
export function conversaCasaBusca(c: Conversa, termo: string): boolean {
  const t = normalizarBusca(termo.trim())
  if (!t) return true
  const nome = normalizarBusca(c.contato.nome ?? '')
  const trecho = normalizarBusca(c.ultimaMensagem?.trecho ?? '')
  if (nome.includes(t) || trecho.includes(t)) return true
  if (pareceNumero(termo)) {
    const dig = apenasDigitos(termo)
    if (mesmoTelefone(c.contato.telefone, termo)) return true
    if (apenasDigitos(c.contato.telefone).includes(dig)) return true
  }
  return false
}
