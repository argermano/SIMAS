// Catálogo PURO das notificações do escritório: tipos, rótulos pt-BR e defaults
// por canal. Zero I/O e zero import de server — é seguro no cliente (a matriz de
// toggles do Perfil importa daqui) E no servidor (o despachante importa daqui).
//
// INVARIANTE (ver migration 081): os DEFAULTS moram AQUI, nunca no banco.
// users.notificacoes guarda só o que o usuário mudou; o que falta cai no default.

/** Tipos de comunicação que o usuário pode ligar/desligar por canal. */
export type TipoNotificacao = 'tarefa_atribuida' | 'tarefa_comentario' | 'resumo_diario'

/** Preferência por canal de um tipo. */
export interface CanalPrefs {
  email: boolean
  whatsapp: boolean
}

interface ItemCatalogo {
  /** Rótulo curto pt-BR para a matriz do Perfil. */
  rotulo: string
  /** Uma linha de contexto (por que existe / o que dispara). */
  descricao: string
  /** Comportamento quando o usuário nunca mexeu neste tipo. */
  default: CanalPrefs
}

/**
 * Fonte única da verdade. A ordem das chaves é a ordem exibida na matriz.
 * - tarefa_atribuida: nasce ligada nos dois (o pedido do dono — avisar por e-mail
 *   E WhatsApp quem recebe uma tarefa).
 * - tarefa_comentario: nasce DESLIGADA — o sino de comentários já cobre isso no app.
 * - resumo_diario: só WhatsApp por default — mantém o comportamento atual do aviso
 *   diário (src/lib/tarefas/aviso-diario.ts), que já manda por WhatsApp.
 */
export const CATALOGO_NOTIFICACOES: Record<TipoNotificacao, ItemCatalogo> = {
  tarefa_atribuida: {
    rotulo: 'Nova tarefa atribuída a você',
    descricao: 'Quando você vira responsável ou envolvido em uma tarefa.',
    default: { email: true, whatsapp: true },
  },
  tarefa_comentario: {
    rotulo: 'Comentário em tarefa sua',
    descricao: 'Quando alguém comenta em uma tarefa em que você está.',
    default: { email: false, whatsapp: false },
  },
  resumo_diario: {
    rotulo: 'Resumo diário de tarefas',
    descricao: 'De manhã, a lista das suas tarefas que vencem no dia.',
    default: { email: false, whatsapp: true },
  },
}

/** Tipos na ordem de exibição (deriva das chaves do catálogo). */
export const TIPOS_NOTIFICACAO = Object.keys(CATALOGO_NOTIFICACOES) as TipoNotificacao[]

/** Um valor é um `TipoNotificacao` conhecido? */
export function tipoNotificacaoValido(tipo: string): tipo is TipoNotificacao {
  return Object.prototype.hasOwnProperty.call(CATALOGO_NOTIFICACOES, tipo)
}

/**
 * Resolve as preferências EFETIVAS de um tipo a partir do que está gravado em
 * `users.notificacoes` (que pode ser null, parcial ou lixo). Regras:
 *  - tipo/canal ausente → cai no default do catálogo;
 *  - só um `boolean` sobrescreve o default (qualquer outra coisa é ignorada);
 *  - tipo desconhecido → { email:false, whatsapp:false } (nunca envia por engano).
 * PURA: sem I/O. É o único lugar que traduz o mapa cru em decisão de envio.
 */
export function resolverPreferencias(notificacoes: unknown, tipo: TipoNotificacao): CanalPrefs {
  const item = CATALOGO_NOTIFICACOES[tipo]
  // Tipo desconhecido: nunca envia, mesmo que o mapa cru traga uma entrada — não
  // agimos sobre um tipo que o código não reconhece.
  if (!item) return { email: false, whatsapp: false }
  const def: CanalPrefs = item.default

  const mapa =
    notificacoes && typeof notificacoes === 'object' ? (notificacoes as Record<string, unknown>) : {}
  const pref = mapa[tipo]
  if (!pref || typeof pref !== 'object') return { ...def }

  const p = pref as Record<string, unknown>
  return {
    email: typeof p.email === 'boolean' ? p.email : def.email,
    whatsapp: typeof p.whatsapp === 'boolean' ? p.whatsapp : def.whatsapp,
  }
}

/** Mapa efetivo (todos os tipos resolvidos) — usado pela UI do Perfil. */
export function preferenciasEfetivas(notificacoes: unknown): Record<TipoNotificacao, CanalPrefs> {
  const out = {} as Record<TipoNotificacao, CanalPrefs>
  for (const tipo of TIPOS_NOTIFICACAO) out[tipo] = resolverPreferencias(notificacoes, tipo)
  return out
}

/**
 * Poda o mapa escolhido pelo usuário para gravar SÓ o que difere do default —
 * mantendo a invariante "defaults só no código". Devolve `null` quando tudo bate
 * com o default (a coluna volta a NULL). O PATCH /api/perfil usa isto.
 */
export function podarParaGravar(
  escolhido: Record<TipoNotificacao, CanalPrefs>,
): Record<string, CanalPrefs> | null {
  const out: Record<string, CanalPrefs> = {}
  for (const tipo of TIPOS_NOTIFICACAO) {
    const def = CATALOGO_NOTIFICACOES[tipo].default
    const e = escolhido[tipo]
    if (e && (e.email !== def.email || e.whatsapp !== def.whatsapp)) {
      out[tipo] = { email: e.email, whatsapp: e.whatsapp }
    }
  }
  return Object.keys(out).length > 0 ? out : null
}
