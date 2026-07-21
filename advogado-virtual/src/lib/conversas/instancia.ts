// Lógica PURA de roteamento do número de saída do WhatsApp por unidade.
// Zero I/O — as rotas de envio HUMANO (clientes/[id]/whatsapp e
// atendimentos/[id]/whatsapp) usam para derivar a instância padrão do usuário;
// o modal usa os rótulos/opções. O ai-attendant recebe isto como body.instance
// no POST /notify. Sem instância → o VPS roteia pelo DDD do destino (fallback).
//
// Mapa (mesmos 3 slugs das presenças — migration 049): brasilia → whatsapp-df;
// florianopolis e blumenau → whatsapp-sc.

/** Instâncias do WhatsApp aceitas pelo /notify (body.instance). */
export type Instancia = 'whatsapp-sc' | 'whatsapp-df'

/**
 * Instância de saída padrão para a unidade do membro. Aceita `string | null`
 * porque a coluna users.unidade é TEXT (defesa contra valor fora do CHECK).
 * null / desconhecido → null (sem preferência → o VPS roteia pelo DDD).
 */
export function instanciaDaUnidade(unidade: string | null | undefined): Instancia | null {
  switch (unidade) {
    case 'brasilia':
      return 'whatsapp-df'
    case 'florianopolis':
    case 'blumenau':
      return 'whatsapp-sc'
    default:
      return null
  }
}

/** Rótulo humano de cada instância (para a UI). */
export const ROTULO_INSTANCIA: Record<Instancia, string> = {
  'whatsapp-sc': 'Número SC (Blumenau/Floripa)',
  'whatsapp-df': 'Número DF (Brasília)',
}

/** Rótulo do valor escolhido, incluindo o automático (null = pelo DDD). */
export function rotuloInstancia(instancia: Instancia | null): string {
  return instancia ? ROTULO_INSTANCIA[instancia] : 'Automático (pelo DDD do destino)'
}

/**
 * Opções do select do modal, na ordem exibida. O valor '' representa o
 * automático (pelo DDD) — o modal o traduz para `instancia: null` no corpo.
 */
export const OPCOES_INSTANCIA: { value: '' | Instancia; label: string }[] = [
  { value: '', label: rotuloInstancia(null) },
  { value: 'whatsapp-sc', label: ROTULO_INSTANCIA['whatsapp-sc'] },
  { value: 'whatsapp-df', label: ROTULO_INSTANCIA['whatsapp-df'] },
]
