// server-only: resolve a CONVERSA aberta do Chatwoot (id numérico) cujo contato
// tem o telefone informado. Anexos vão pelo relay POST /conversations/:id/anexo,
// que exige uma conversa já aberta — daqui sai o id. Varre GET /conversations?
// status=open (25/página) nas 4 primeiras páginas (100 conversas) casando o
// telefone pelo matcher canônico (tolerante a máscara/DDI/9º dígito). Reusa o
// relayFetch (leitura tem fallback admin no relay, então funciona sem token pessoal).

import { relayFetch } from '@/lib/conversas/relay'
import { mesmoTelefone } from '@/lib/conversas/telefone'

// Só id + contato.telefone importam aqui; shape defensivo (o relay pode evoluir).
interface ConversaLeve {
  id?: unknown
  contato?: { telefone?: unknown } | null
}

// 4 páginas × 25 = teto de 100 conversas abertas varridas. É o suficiente para o
// caso real (poucas conversas abertas por escritório) sem paginar indefinidamente.
const MAX_PAGINAS = 4

function extrairConversas(data: unknown): ConversaLeve[] {
  if (!data || typeof data !== 'object') return []
  const lista = (data as { conversas?: unknown }).conversas
  return Array.isArray(lista) ? (lista as ConversaLeve[]) : []
}

/**
 * id numérico da conversa aberta do telefone, ou null se não houver (cliente sem
 * conversa aberta) ou se o relay estiver indisponível. Nunca lança.
 */
export async function resolverConversaPorTelefone(
  email: string,
  telefone: string,
): Promise<number | null> {
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const { status, data } = await relayFetch('/conversations', {
      method: 'GET',
      email,
      query: { status: 'open', page: String(page) },
    })
    // Relay indisponível/erro: não dá para afirmar que existe — trata como "não achou".
    if (status < 200 || status >= 300) return null

    const conversas = extrairConversas(data)
    if (conversas.length === 0) break // fim da paginação

    const achou = conversas.find((c) =>
      mesmoTelefone(typeof c?.contato?.telefone === 'string' ? c.contato.telefone : null, telefone),
    )
    if (achou && typeof achou.id === 'number') return achou.id

    if (conversas.length < 25) break // página incompleta = última página
  }
  return null
}
