import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { marcarArtefatosRemovidos } from '@/lib/ia/sessao/artefatos'
import { estimarProximaRodada, lerTokensSessao } from '@/lib/ia/sessao/custo'
import { montarSystemSessao } from '@/lib/ia/sessao/prompts'
import {
  adminSessoes,
  carregarPecaDoTenant,
  carregarSessao,
  listarPropostas,
  listarTurnos,
} from '@/lib/ia/sessao/sessoes'

// GET /api/pecas/[id]/sessao/[sid] — a sessão inteira para RETOMAR: turnos na
// ordem, propostas (a pendente é a que a UI oferece aplicar) e a estimativa da
// próxima rodada.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id: pecaId, sid } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const peca = await carregarPecaDoTenant(supabase, pecaId, usuario.tenant_id)
  if (!peca) return jsonError('Peça não encontrada', 404)

  const admin = adminSessoes()
  const sessao = await carregarSessao(admin, { sessaoId: sid, pecaId, tenantId: usuario.tenant_id })
  if (!sessao) return jsonError('Sessão não encontrada', 404)

  const [turnosCrus, propostas] = await Promise.all([
    listarTurnos(admin, sessao.id),
    listarPropostas(admin, sessao.id),
  ])

  // Artefato que o advogado já apagou do dossiê não pode aparecer no painel
  // oferecendo "abrir" (F0.5). Uma consulta só, sobre os ids dos turnos.
  const turnos = await marcarArtefatosRemovidos(admin, { tenantId: usuario.tenant_id, turnos: turnosCrus })

  // Estimativa da próxima rodada. A base boa é o uso REAL da última rodada
  // (guardado em tokens.ultima_entrada); antes da primeira, cai na conta por
  // caracteres do que já dá para medir sem custo — system + peça + histórico.
  // O dossiê não entra nessa conta (medi-lo exigiria baixar todos os textos
  // extraídos só para desenhar um aviso), então a 1ª estimativa é um piso.
  const tokens = lerTokensSessao(sessao.tokens)
  const charsHistorico = turnos.reduce((soma, t) => soma + (t.conteudo?.length ?? 0), 0)
  const chars =
    montarSystemSessao(null, { artefatos: true }).length + (peca.conteudo_markdown?.length ?? 0) + charsHistorico

  const estimativa = estimarProximaRodada({ modelo: sessao.modelo, tokens, chars })

  return NextResponse.json({
    sessao,
    turnos,
    propostas,
    peca: { id: peca.id, versao: peca.versao ?? 1, status: peca.status },
    estimativa: {
      ...estimativa,
      // A primeira estimativa ignora o dossiê — a UI avisa que é um piso.
      parcial: estimativa.base === 'caracteres',
    },
  })
}
