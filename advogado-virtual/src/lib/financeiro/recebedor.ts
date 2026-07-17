// Financeiro L1 — decide se um comprovante recebido é DIRECIONADO AO ESCRITÓRIO
// (recebedor = o escritório ou a conta pessoal da titular) ou a um TERCEIRO.
// Motivação (pedido do dono, 2026-07): o inbox/staging de comprovantes só deve
// conter recibos do escritório; recibos de terceiros que passam pelo WhatsApp
// continuam na conversa e são anexados ao caso/cliente por outro fluxo.
// Puro/determinístico (sem IA, sem I/O) → testável. LGPD: não loga nada aqui.

import { normalizarChavePix } from '@/lib/financeiro/pix'
import type { DadosComprovante } from '@/lib/financeiro/comprovante'

export interface ConfigRecebedor {
  pixChave?: string | null   // chave Pix configurada do escritório (já normalizada)
  pixNome?: string | null    // nome do recebedor no Pix das cobranças
  tenantNome?: string | null // razão social / nome do tenant
}

export type DecisaoRecebedor = 'sim' | 'nao' | 'desconhecido'

// Tokens genéricos de nome de banca que NÃO identificam um escritório específico
// (duas bancas diferentes compartilham "SOCIEDADE ADVOCACIA"). Nunca contam
// sozinhos para casar o recebedor com o escritório.
const GENERICOS = new Set([
  'ADVOCACIA', 'ADVOCACIAS', 'ADVOGADO', 'ADVOGADA', 'ADVOGADOS', 'ADVOGADAS',
  'SOCIEDADE', 'INDIVIDUAL', 'ASSOCIADOS', 'ASSOCIADAS', 'ESCRITORIO',
  'JURIDICO', 'JURIDICA', 'CONSULTORIA', 'LTDA', 'EIRELI', 'MEI',
])

/** UPPERCASE, sem acento, só letras/números/espaço, espaços colapsados. */
function normalizarNome(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas combinantes (acentos)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/** Tokens distintivos: 4+ caracteres e fora da lista de genéricos. */
function tokensDistintivos(v: string): Set<string> {
  const out = new Set<string>()
  for (const t of normalizarNome(v).split(' ')) {
    if (t.length >= 4 && !GENERICOS.has(t)) out.add(t)
  }
  return out
}

/**
 * O recebedor do comprovante é o escritório (ou a conta pessoal da titular)?
 * - 'sim'          → mantém no fluxo do inbox/staging (é do escritório).
 * - 'nao'          → recebedor extraído e claramente de terceiro; NÃO stageia
 *                    nem inboxa (o anexo segue na conversa p/ anexar ao caso).
 * - 'desconhecido' → sem recebedor/chave utilizável no comprovante (ou sem
 *                    referência p/ comparar); na dúvida ENTRA — nunca perder
 *                    recibo real do escritório.
 *
 * Regras (positivo vence): chaveDestino == pixChave => sim; senão, interseção
 * de tokens distintivos do recebedorNome com pixNome/tenantNome (>=1 token
 * distintivo tipo sobrenome já basta, e genéricos não contam) => sim;
 * recebedorNome presente e sem interseção => nao; sem base para decidir =>
 * desconhecido. A chaveDestino só dá sinal POSITIVO: uma chave diferente da
 * configurada não prova ser terceiro (pode ser a conta pessoal da titular).
 */
export function recebedorEhEscritorio(
  dados: Pick<DadosComprovante, 'recebedorNome' | 'chaveDestino'>,
  cfg: ConfigRecebedor,
): DecisaoRecebedor {
  // 1) Chave Pix de destino bate com a do escritório → certeza positiva.
  const chaveDestino = dados.chaveDestino?.trim()
  const pixChave = cfg.pixChave?.trim()
  if (chaveDestino && pixChave) {
    const a = normalizarChavePix(chaveDestino)
    const b = normalizarChavePix(pixChave)
    if (a && b && a === b) return 'sim'
  }

  // 2) Nome do recebedor: casa por tokens distintivos com pixNome OU tenantNome.
  const recebedor = dados.recebedorNome?.trim()
  if (recebedor) {
    const rec = tokensDistintivos(recebedor)
    const ref = new Set<string>()
    for (const nome of [cfg.pixNome, cfg.tenantNome]) {
      if (nome) for (const t of tokensDistintivos(nome)) ref.add(t)
    }
    // Recebedor sem tokens distintivos (só genéricos) OU sem referência para
    // comparar → inconclusivo: mantém (não descartar recibo do escritório).
    if (rec.size === 0 || ref.size === 0) return 'desconhecido'
    for (const t of rec) if (ref.has(t)) return 'sim'
    // Recebedor extraído e nada casou → é de terceiro.
    return 'nao'
  }

  // 3) Sem recebedor e sem chave utilizável: não dá para decidir → mantém.
  return 'desconhecido'
}
