import { NextResponse } from 'next/server'
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { enviarEmail, emailTemplate, urlBaseApp } from '@/lib/email'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { alertarFalhaPublicacoes } from '@/lib/processos/alertas'
import { hojeSaoPauloISO } from '@/lib/processos/util'
import { enviarAvisoWhatsApp } from '@/lib/processos/notificar'
import { montarMensagensAvisoParcela } from '@/lib/financeiro/aviso'
import { gerarPixCopiaECola } from '@/lib/financeiro/pix'

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
  const t0 = Date.now()
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

  // Vigia cruzado das publicações (isolado: nunca derruba os lembretes acima).
  // Este cron roda às 10:00 UTC, ANTES do funil-consultas (11:00) que executa a
  // captura DJEN. Se não houver nenhuma captura com sucesso nas últimas 26h E
  // existir ao menos um tenant com OAB configurada, a captura de ontem não rodou
  // (falha silenciosa) — alerta a operação. Janela de 26h (>24h) dá folga para
  // atraso do cron sem gerar falso positivo dentro do mesmo ciclo diário.
  try {
    const { data: tenantsComOab, error: errOab } = await admin
      .from('tenants')
      .select('id')
      .not('oab_numero', 'is', null)
      .limit(1)
    if (errOab) throw errOab

    if ((tenantsComOab?.length ?? 0) > 0) {
      const limite26h = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
      const { data: sucessos, error: errCap } = await admin
        .from('capturas_publicacoes')
        .select('id')
        .eq('status', 'sucesso')
        .gte('created_at', limite26h)
        .limit(1)
      if (errCap) throw errCap

      if ((sucessos?.length ?? 0) === 0) {
        await alertarFalhaPublicacoes({
          assunto: 'captura de publicações não rodou nas últimas 26h',
          detalhes:
            'O vigia cruzado (cron lembretes-prazo, 10:00 UTC) não encontrou ' +
            'nenhuma captura de publicações com status "sucesso" nas últimas 26 ' +
            'horas, apesar de existir tenant com OAB configurada. A rodada diária ' +
            'de captura do DJEN (funil-consultas) provavelmente não executou ou ' +
            'falhou. Verifique os crons da Vercel e a tabela capturas_publicacoes.',
        })
        logger.warn('cron.publicacoes_vigia.sem_sucesso_26h', {})
      }
    }
  } catch (e) {
    logger.error('cron.publicacoes_vigia.falha', {}, e as Error)
  }

  // Avisos de parcela (Financeiro L1) — etapa ISOLADA com deadline próprio:
  // nunca derruba os lembretes/vigia acima. D-3 e D-0, claim atômico antes do
  // envio, opt-out por cliente, NUNCA parcela vencida (só igualdade de data).
  let avisosParcelas: { candidatas: number; enviados: number; erros: number } = {
    candidatas: 0, enviados: 0, erros: 0,
  }
  try {
    // Deadline ancorado no INÍCIO da request (maxDuration=60): reduz a janela
    // de kill entre o claim e o envio quando as etapas anteriores demoram.
    avisosParcelas = await enviarAvisosParcelas(admin, t0 + 50_000)
    logger.info('cron.avisos_parcelas', { ...avisosParcelas })
  } catch (e) {
    logger.error('cron.avisos_parcelas.falha', {}, e as Error)
  }

  return NextResponse.json({ ok: true, pessoas: porPessoa.size, enviados, tarefas: idsLembrados.length, avisosParcelas })
}

/** Soma `dias` a uma data YYYY-MM-DD ancorando no meio-dia UTC (imune a fuso/DST). */
function somarDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  dt.setUTCDate(dt.getUTCDate() + dias)
  return dt.toISOString().slice(0, 10)
}

interface ParcelaAviso {
  id: string
  tenant_id: string
  cliente_id: string
  descricao: string
  valor_centavos: number
  vencimento: string
  aviso_d3_em: string | null
  aviso_d0_em: string | null
}

/**
 * Varre parcelas ABERTAS que vencem hoje (D-0, aviso_d0_em null) ou em 3 dias
 * (D-3, aviso_d3_em null) — datas no fuso America/Sao_Paulo — e envia o aviso
 * por WhatsApp ao cliente que tem aviso_cobranca ligado e telefone. O CLAIM é
 * atômico (UPDATE ... WHERE aviso_dX_em IS NULL RETURNING, padrão Fase 5) e
 * acontece ANTES do envio: nunca 2 avisos da mesma parcela, mesmo sob
 * concorrência. Parcela vencida NUNCA entra (comparação por igualdade de data).
 * LGPD: loga apenas ids/contagens — nunca valores ou texto.
 */
async function enviarAvisosParcelas(admin: SupabaseClient, deadline: number) {
  const hoje = hojeSaoPauloISO()
  const d3 = somarDiasISO(hoje, 3)

  // Paginação ORDENADA até esgotar (ou até o deadline): a janela D-3 é por
  // igualdade de data — parcela que ficar fora hoje perde o D-3 para sempre.
  const PAGINA = 200
  const todas: ParcelaAviso[] = []
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await admin
      .from('parcelas')
      .select('id, tenant_id, cliente_id, descricao, valor_centavos, vencimento, aviso_d3_em, aviso_d0_em')
      .eq('status', 'aberta')
      // Quem já mandou comprovante (staging "aguardando baixa") fica FORA dos
      // avisos: não se cobra o cliente que já pagou e só espera a conferência.
      .is('comprovante_recebido_em', null)
      .in('vencimento', [hoje, d3])
      .order('vencimento', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGINA - 1)
    if (error) throw error
    todas.push(...((data ?? []) as ParcelaAviso[]))
    if ((data ?? []).length < PAGINA) break
    if (Date.now() > deadline) {
      logger.warn('cron.avisos_parcelas.deadline_na_busca', { carregadas: todas.length })
      break
    }
  }

  // Só as com aviso ainda pendente (claim null para a janela correspondente).
  const pendentes = todas.filter((p) =>
    p.vencimento === hoje ? !p.aviso_d0_em : !p.aviso_d3_em,
  )
  const resultado = { candidatas: pendentes.length, enviados: 0, erros: 0 }
  if (pendentes.length === 0) return resultado

  // Contexto em lote: clientes (opt-out/telefone) e tenants (nome + Pix).
  const clienteIds = [...new Set(pendentes.map((p) => p.cliente_id))]
  const tenantIds = [...new Set(pendentes.map((p) => p.tenant_id))]
  const [{ data: clientes }, { data: tenants }] = await Promise.all([
    admin.from('clientes').select('id, nome, telefone, aviso_cobranca').in('id', clienteIds).is('deleted_at', null),
    admin.from('tenants').select('id, nome, config').in('id', tenantIds),
  ])
  const porCliente = new Map((clientes ?? []).map((c) => [c.id as string, c]))
  const porTenant = new Map((tenants ?? []).map((t) => [t.id as string, t]))

  let processadas = 0
  for (const p of pendentes) {
    if (Date.now() > deadline) {
      // Visibilidade: quantas ficaram de fora quando o deadline cortou o lote.
      logger.warn('cron.avisos_parcelas.deadline_cortou', {
        processadas,
        restantes: pendentes.length - processadas,
      })
      break
    }
    processadas++

    const cli = porCliente.get(p.cliente_id)
    // Opt-out (aviso_cobranca desligado), cliente removido ou sem telefone:
    // não envia e NÃO faz claim (se religar antes do D-0, o aviso do dia sai).
    if (!cli || cli.aviso_cobranca !== true || !cli.telefone) continue

    // CLAIM atômico antes do envio (padrão Fase 5): só envia quem virar a coluna.
    const ehHoje = p.vencimento === hoje
    const campo = ehHoje ? 'aviso_d0_em' : 'aviso_d3_em'
    const { data: claim } = await admin
      .from('parcelas')
      .update({ [campo]: new Date().toISOString() })
      .eq('id', p.id)
      .eq('status', 'aberta')
      .is(campo, null)
      .select('id')
    if (!claim || claim.length === 0) continue // outro worker já pegou

    const ten = porTenant.get(p.tenant_id)
    const fin = ((ten?.config as Record<string, unknown> | null)?.financeiro ?? {}) as {
      pix_chave?: string; pix_nome?: string; pix_cidade?: string
    }
    let pixCopiaECola: string | null = null
    if (fin.pix_chave && fin.pix_nome && fin.pix_cidade) {
      try {
        pixCopiaECola = gerarPixCopiaECola({
          chave: fin.pix_chave,
          nome: fin.pix_nome,
          cidade: fin.pix_cidade,
          valorCentavos: p.valor_centavos,
        })
      } catch {
        pixCopiaECola = null // config Pix inválida — aviso segue sem o copia-e-cola
      }
    }

    // Sequência de mensagens (formato aprovado pelo dono, 2026-07-11):
    // aviso → copia-e-cola limpo → "Chave Pix: ...". Envio em ordem; se a
    // primeira falhar, não manda as demais (código solto sem contexto).
    const mensagens = montarMensagensAvisoParcela({
      nomeCliente: (cli.nome as string) ?? null,
      descricao: p.descricao,
      valorCentavos: p.valor_centavos,
      vencimentoISO: p.vencimento,
      pixCopiaECola,
      chavePix: fin.pix_chave ?? null,
      escritorioNome: (ten?.nome as string) ?? null,
      ehHoje,
    })

    let res = await enviarAvisoWhatsApp(cli.telefone as string, mensagens[0])
    if (res.ok) {
      for (const extra of mensagens.slice(1)) {
        const r2 = await enviarAvisoWhatsApp(cli.telefone as string, extra)
        if (!r2.ok) { res = r2; break } // registra a falha parcial na auditoria abaixo
      }
    }
    if (res.ok) resultado.enviados++
    else {
      // Claim fica: preferimos NÃO reenviar (invariante "nunca 2x") a arriscar
      // duplicado. Registra a falha na auditoria para a equipe reenviar
      // manualmente pelo card das Conversas (LGPD: só ids, sem texto/valores).
      resultado.erros++
      logger.error('cron.avisos_parcelas.envio_falhou', { parcela: p.id })
      await logAudit({
        tenantId: p.tenant_id,
        action: 'financeiro.aviso_falhou',
        resourceType: 'parcela',
        resourceId: p.id,
        metadata: { janela: ehHoje ? 'd0' : 'd3', vencimento: p.vencimento },
      })
    }
  }

  return resultado
}

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
