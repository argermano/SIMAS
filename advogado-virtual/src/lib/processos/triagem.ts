/**
 * Lógica pura de triagem de publicações (testável, sem I/O).
 *
 * A transição de estado de uma publicação SÓ pode partir de 'nova' — depois de
 * triada/descartada/com tarefa a caixa de entrada é imutável (trilha de
 * auditoria; descartada ≠ apagada). O claim atômico real acontece na rota
 * (UPDATE ... WHERE status='nova'); estas funções são o guard determinístico e
 * a montagem do texto padrão da tarefa. Ver docs/PLANO-PUBLICACOES-OPUS.md §4/§6.
 */

export type StatusPublicacao = 'nova' | 'triada' | 'tarefa_criada' | 'descartada'
export type AcaoTriagem = 'triada' | 'descartar' | 'tarefa'

/** Status final de cada ação de triagem. */
const STATUS_ALVO: Record<AcaoTriagem, StatusPublicacao> = {
  triada: 'triada',
  descartar: 'descartada',
  tarefa: 'tarefa_criada',
}

export type ResultadoTransicao =
  | { ok: true; novoStatus: StatusPublicacao }
  | { ok: false; motivo: string }

/**
 * Valida se a ação pode ser aplicada ao status atual.
 * Regra única: toda ação de triagem parte de 'nova'. Qualquer outro status
 * (triada, tarefa_criada, descartada) já foi processado → rejeita.
 * Retorna o status final da ação em caso de sucesso (para 'tarefa' o alvo é
 * 'tarefa_criada' — a rota reserva 'triada' antes de criar a tarefa).
 */
export function validarTransicao(statusAtual: string, acao: AcaoTriagem): ResultadoTransicao {
  if (statusAtual !== 'nova') {
    return { ok: false, motivo: 'Publicação já triada' }
  }
  return { ok: true, novoStatus: STATUS_ALVO[acao] }
}

export interface PublicacaoDescricao {
  tipo_documento?: string | null
  tipo_comunicacao?: string | null
  numero_mascara?: string | null
  sigla_tribunal?: string | null
}

/**
 * Monta a descrição padrão da tarefa no Kanban a partir dos metadados da
 * publicação: "Publicação {tipo} — proc. {nº} ({tribunal})".
 * - tipo: tipo_documento, com fallback para tipo_comunicacao e, por fim, 'sem tipo'.
 * - sem número de processo (edital sem nº): usa "proc. não informado".
 * - sem tribunal: omite o sufixo "(...)".
 * Este texto é apenas um ponto de partida — a UI permite editar antes de criar.
 */
export function montarDescricaoTarefa(pub: PublicacaoDescricao): string {
  const tipo = (pub.tipo_documento?.trim() || pub.tipo_comunicacao?.trim() || 'sem tipo')
  const numero = pub.numero_mascara?.trim()
  const tribunal = pub.sigla_tribunal?.trim()

  const proc = numero ? `proc. ${numero}` : 'proc. não informado'
  const trib = tribunal ? ` (${tribunal})` : ''

  return `Publicação ${tipo} — ${proc}${trib}`
}

/**
 * Status final de uma publicação após o TRATAMENTO (estação de tratamento):
 * criou ≥1 tarefa → 'tarefa_criada' (Tratada com tarefa); nenhuma tarefa —
 * apenas nota/marcação — → 'triada' (Tratada sem tarefa). O descarte tem fluxo
 * próprio (status 'descartada') e NÃO passa por aqui. Helper puro para a rota
 * decidir o alvo do UPDATE de confirmação sem espalhar a regra pelo código.
 */
export function statusAposTratamento(tarefasCriadas: number): StatusPublicacao {
  return tarefasCriadas > 0 ? 'tarefa_criada' : 'triada'
}
