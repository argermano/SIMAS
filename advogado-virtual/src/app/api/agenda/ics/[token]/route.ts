import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { buscarEventosCalendario, filtrarEventosDoUsuario, janelaPadrao } from '@/lib/agenda/consulta'
import { gerarICS } from '@/lib/agenda/ics'
import { urlBaseApp } from '@/lib/email'
import { logger } from '@/lib/logger'

// GET /api/agenda/ics/[token] — feed iCalendar PESSOAL (rota PÚBLICA).
// O token É a credencial: lookup exato em agenda_ics_tokens; qualquer falha
// de autenticação responde 404 GENÉRICO (sem detalhes) e o token NUNCA é
// logado. Sem getAuthContext — usa o client admin (service role).
//
// Janela: [-60d, +180d]. Filtro "eventos do usuário": responsável OU
// envolvido OU criador (inclui os 'particular' do PRÓPRIO usuário; consultas
// do bot não têm responsável/criador, logo ficam fora do feed pessoal).
// Janela e filtro vêm de consulta.ts (compartilhados com o espelho ativo).

function naoEncontrado(): NextResponse {
  return new NextResponse('Not found', { status: 404 })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || token.length < 32 || token.length > 256) return naoEncontrado()

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: registro } = await admin
    .from('agenda_ics_tokens')
    .select('user_id, tenant_id')
    .eq('token', token)
    .maybeSingle()
  if (!registro) return naoEncontrado()

  // Dono precisa estar ATIVO: usuário desligado perde o feed junto com a
  // sessão (404 genérico, como qualquer token inválido).
  const { data: dono } = await admin
    .from('users')
    .select('id, nome')
    .eq('id', registro.user_id)
    .eq('tenant_id', registro.tenant_id)
    .eq('status', 'ativo')
    .maybeSingle()
  if (!dono) return naoEncontrado()

  const { de, ate } = janelaPadrao()

  let eventos
  try {
    eventos = await buscarEventosCalendario(admin, {
      tenantId: registro.tenant_id,
      de,
      ate,
      // Alinhado à UI (filtros.ts): 'particular' só do próprio dono — um
      // particular de OUTRO criador não entra no feed nem se o dono for
      // responsável/envolvido. Corte já na query (defesa em profundidade).
      particularesDe: dono.id,
    })
  } catch (err) {
    logger.error('agenda.feed_ics.busca_falha', { userId: registro.user_id }, err)
    return new NextResponse('Erro interno', { status: 500 })
  }

  // Só eventos DO usuário (inclui particulares do próprio; o corte de
  // 'particular' de terceiros já veio da query via particularesDe).
  const meus = filtrarEventosDoUsuario(eventos, dono.id)

  const ics = gerarICS(meus, {
    nomeCal: `SIMAS — ${dono.nome ?? 'Agenda'}`,
    urlBase: urlBaseApp(),
  })

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      // SEM Content-Disposition: attachment — o "Adicionar por URL" do Google
      // Agenda FALHA quando o feed vem como anexo (trata como download, não
      // como assinatura). É um feed de assinatura, então serve inline.
      'Cache-Control': 'max-age=3600',
    },
  })
}
