import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logger } from '@/lib/logger'
import { calendarDisponivel, emailElegivel, verificarDelegacao } from '@/lib/calendar/api'
import { calendarAdmin, enfileirarCalendarSync } from '@/lib/calendar/fila'
import { drenarUsuarios, TETO_TENTATIVAS } from '@/lib/calendar/espelho'

// Espelho ATIVO da agenda no Google Calendar do PRÓPRIO usuário (068). Estado (GET)
// para o modal "Conectar ao meu calendário" e sincronização manual (POST, só o
// próprio usuário — sessão própria). Alternativa ao feed ICS que o Google recusa
// assinar em produção. Só e-mails do DOMÍNIO Workspace do impersonador entram;
// fora do domínio (ex.: gmail) segue no feed ICS. Ver src/lib/calendar/*.
export const maxDuration = 60

/** E-mail do usuário logado (users.email — o usuário do auth não o traz). */
async function emailDoUsuario(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from('users').select('email').eq('id', userId).maybeSingle()
  return (data?.email as string | undefined) ?? null
}

// GET — estado por usuário logado para o modal:
//  • configurado: as envs do espelho ativo presentes (senão fica INERTE);
//  • elegivel: e-mail do usuário no DOMÍNIO Workspace do impersonador;
//  • delegacaoOk: token impersonado obtido (DWD+scope calendar autorizados);
//  • email: o próprio e-mail (mostrado só a ele, p/ a msg "fora do domínio");
//  • pendentesFila: eventos deste usuário aguardando espelhamento na fila.
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { usuario } = auth

  const admin = calendarAdmin()
  const email = await emailDoUsuario(admin, usuario.id)
  const configurado = calendarDisponivel()
  const elegivel = configurado && emailElegivel(email, process.env.GOOGLE_DRIVE_IMPERSONATE)

  // Só bate no Google quando elegível — e barato (token cacheado por e-mail).
  let delegacaoOk = false
  if (elegivel && email) {
    try {
      delegacaoOk = await verificarDelegacao(email)
    } catch (e) {
      logger.error('agenda.espelho_google.delegacao', {}, e) // rede/timeout: fica false
    }
  }

  const { count } = await admin
    .from('calendar_sync_fila')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', usuario.id)
    .lt('tentativas', TETO_TENTATIVAS) // conta só os VIVOS (exclui dead-letter)

  return NextResponse.json({ configurado, elegivel, delegacaoOk, email, pendentesFila: count ?? 0 })
}

// POST — "Sincronizar meus eventos agora": espelha SÓ o próprio usuário (sessão
// própria), teto ~55s sob o maxDuration=60. Enfileira e drena JÁ (reusa o claim →
// sem corrida com o cron); o que não couber fica na fila durável.
export async function POST() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { usuario } = auth

  if (!calendarDisponivel()) {
    return jsonError('O espelho no Google Calendar não está configurado neste ambiente.', 400)
  }

  const admin = calendarAdmin()
  const email = await emailDoUsuario(admin, usuario.id)
  if (!emailElegivel(email, process.env.GOOGLE_DRIVE_IMPERSONATE)) {
    return jsonError('Seu e-mail está fora do domínio do escritório; use o link ICS abaixo.', 400)
  }

  await enfileirarCalendarSync(admin, usuario.tenant_id, [usuario.id])
  const r = await drenarUsuarios(admin, [usuario.id], { deadline: Date.now() + 55_000 })

  // Delegação ainda não autorizada pelo administrador → 200 com a flag (a UI
  // mostra "aguardando autorização", não um erro).
  if (r.delegacaoPendente > 0) {
    return NextResponse.json({ ok: false, delegacaoPendente: true })
  }
  // Google recusou TODAS as chamadas (ex.: Calendar API não ativada no projeto —
  // a emissão do token passa, as chamadas reais dão 403): sem isso o modal
  // mostrava sucesso com zero eventos espelhados.
  if (r.erros > 0 && r.upserts === 0 && r.remocoes === 0) {
    return NextResponse.json({ ok: false, erros: r.erros })
  }
  return NextResponse.json({ ok: true, upserts: r.upserts, remocoes: r.remocoes, erros: r.erros })
}
