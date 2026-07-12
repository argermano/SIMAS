// Finalização (lado cliente) compartilhada após o stream de geração/refino de
// peça: formata, salva o conteúdo, marca o caso como peca_gerada e resolve o
// destino de navegação (editor, ou volta à área quando colaborador → revisão).
//
// Usado por TelaAtendimento (modo criar) e TelaRefinamento (modo refinar),
// eliminando a duplicação e padronizando o tratamento de erro.

import { formatarPeca } from '@/lib/format/formatar-peca'
import { salvarPecaComGuarda } from '@/lib/ia/pecas/salvar-peca-client'

export type ResultadoStream = { fullText: string; headers: Headers; stopReason?: string | null }

export type FinalizacaoPeca =
  | { ok: true; pecaId: string; destino: string; emRevisao: boolean }
  | { ok: false; erro: string }

/**
 * Salva a peça gerada/refinada e devolve o destino de navegação.
 * Aborta (ok:false) se a peça não tiver id ou se algum passo de persistência
 * falhar — o chamador decide como exibir o erro.
 */
export async function finalizarGeracaoPeca(params: {
  resultado: ResultadoStream
  area: string
  atendimentoId: string
  roleUsuario: string
}): Promise<FinalizacaoPeca> {
  const pecaId = params.resultado.headers.get('X-Peca-Id')
  if (!pecaId) return { ok: false, erro: 'Não foi possível identificar a peça gerada.' }

  // Formatação forense padronizada antes de salvar
  const conteudoFormatado = formatarPeca(params.resultado.fullText)

  // Salva com a guarda anti-encolhimento: se a rede de segurança do servidor já
  // gravou um texto maior, pede confirmação antes de substituí-lo.
  const salvo = await salvarPecaComGuarda({ pecaId, conteudo: conteudoFormatado })
  if (!salvo.ok) {
    return { ok: false, erro: salvo.cancelado ? 'Salvamento cancelado.' : salvo.erro }
  }

  const resStatus = await fetch(`/api/atendimentos/${params.atendimentoId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'peca_gerada' }),
  })
  if (!resStatus.ok) {
    const data = await resStatus.json().catch(() => ({}))
    return { ok: false, erro: data.error ?? 'Falha ao atualizar o caso' }
  }

  const emRevisao = params.roleUsuario === 'colaborador'
  const destino = emRevisao ? `/${params.area}` : `/${params.area}/editor/${pecaId}`
  return { ok: true, pecaId, destino, emRevisao }
}
