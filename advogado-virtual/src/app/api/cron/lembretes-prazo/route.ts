import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { enviarEmail, emailTemplate, urlBaseApp } from '@/lib/email'
import { logger } from '@/lib/logger'

export const maxDuration = 60

// GET /api/cron/lembretes-prazo — job diário (Vercel Cron). Envia 1 e-mail por
// responsável com as tarefas do kanban cujo prazo está a até 48h (ou vencido) e
// que ainda não foram lembradas. Escopo MÍNIMO de propósito (o escritório usa
// Astrea para gestão): só lembra os prazos que já existem, sem recorrência.
//
// Proteção fail-closed: exige Authorization: Bearer ${CRON_SECRET}. Sem o
// secret configurado, responde 401 (não roda). A Vercel injeta esse header
// automaticamente nos crons quando CRON_SECRET está no ambiente.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Janela: tudo com prazo até 48h à frente (inclui vencidos ainda não lembrados).
  const limite = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

  const { data: tarefas, error } = await admin
    .from('tasks')
    .select('id, description, due_date, assignee:users!tasks_assignee_id_fkey(nome, email)')
    .not('assignee_id', 'is', null)
    .is('completed_at', null)
    .is('lembrete_enviado_em', null)
    .not('due_date', 'is', null)
    .lte('due_date', limite)

  if (error) {
    logger.error('cron.lembretes.query_falhou', {}, error)
    return NextResponse.json({ erro: error.message }, { status: 500 })
  }

  type Tarefa = { id: string; description: string; due_date: string; assignee: { nome?: string; email?: string } | null }
  const lista = (tarefas ?? []) as unknown as Tarefa[]

  // Agrupa por e-mail do responsável.
  const porPessoa = new Map<string, { nome: string; tarefas: Tarefa[] }>()
  for (const t of lista) {
    const email = t.assignee?.email
    if (!email) continue
    if (!porPessoa.has(email)) porPessoa.set(email, { nome: t.assignee?.nome ?? 'colega', tarefas: [] })
    porPessoa.get(email)!.tarefas.push(t)
  }

  const fmtData = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  const urlTarefas = `${urlBaseApp()}/tarefas`
  let enviados = 0
  const idsLembrados: string[] = []

  for (const [email, { nome, tarefas: ts }] of porPessoa) {
    const linhas = ts
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
      .map((t) => {
        const vencida = new Date(t.due_date).getTime() < Date.now()
        const cor = vencida ? '#dc2626' : '#4f5fcc'
        return `<li style="margin:6px 0;"><strong style="color:${cor};">${fmtData(t.due_date)}${vencida ? ' (vencida)' : ''}</strong> — ${escapar(t.description)}</li>`
      })
      .join('')

    const ok = await enviarEmail({
      para: email,
      assunto: `Você tem ${ts.length} prazo${ts.length > 1 ? 's' : ''} próximo${ts.length > 1 ? 's' : ''}`,
      html: emailTemplate({
        titulo: `Prazos, ${nome}`,
        conteudo: `<p>Estas tarefas têm prazo nas próximas 48 horas (ou já venceram):</p><ul style="padding-left:18px;color:#475569;">${linhas}</ul>`,
        botao: { texto: 'Abrir o quadro de tarefas', url: urlTarefas },
      }),
    })
    if (ok) {
      enviados++
      idsLembrados.push(...ts.map((t) => t.id))
    }
  }

  // Marca as tarefas lembradas para não repetir amanhã.
  if (idsLembrados.length > 0) {
    await admin.from('tasks').update({ lembrete_enviado_em: new Date().toISOString() }).in('id', idsLembrados)
  }

  logger.info('cron.lembretes', { pessoas: porPessoa.size, emailsEnviados: enviados, tarefas: idsLembrados.length })
  return NextResponse.json({ ok: true, pessoas: porPessoa.size, enviados, tarefas: idsLembrados.length })
}

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
