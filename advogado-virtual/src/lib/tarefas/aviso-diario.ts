// Frente W3 — aviso diário de tarefas por WhatsApp ao PRÓPRIO membro da equipe.
//
// INVARIANTE: isto NÃO cria nem calcula prazo. Só LEMBRA tarefas cujo vencimento
// (due_date) um humano já definiu, mandando ao WhatsApp do membro responsável OU
// envolvido. Sem recorrência, sem cálculo de prazo processual.
//
// Roda de carona no cron lembretes-prazo (Vercel Hobby: sem cron novo). Claim
// atômico por (user_id, dia) na tabela avisos_tarefas_diarios (INSERT ON CONFLICT
// DO NOTHING via upsert ignoreDuplicates): só quem inserir a linha envia — NUNCA
// 2 mensagens ao mesmo membro no mesmo dia. Falha de envio NÃO desfaz o claim
// (preferimos perder um aviso a mandar dois num retry).

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { enviarAvisoWhatsApp } from '@/lib/processos/notificar'
import { instanciaDaUnidade } from '@/lib/conversas/instancia'
import { urlBaseApp } from '@/lib/email'

// ── Helpers PUROS (testáveis sem rede/DB) ────────────────────────────────────

/**
 * Offset de America/Sao_Paulo em horas ATRÁS de UTC no instante dado (hoje = 3;
 * daria 2 se o horário de verão voltasse). Deriva do próprio instante, então é
 * imune a mudança de regra de fuso — não hardcoda -3.
 */
function offsetHorasSaoPaulo(instante: Date): number {
  const horaSP = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hour12: false,
    }).format(instante),
  )
  let diff = instante.getUTCHours() - (horaSP % 24)
  if (diff < 0) diff += 24 // o dia civil de SP fica "atrás" do de UTC
  return diff
}

/**
 * Janela [início, fim) do dia CIVIL de America/Sao_Paulo que contém `agora`, em
 * instantes UTC (ISO). due_date é timestamptz — comparar contra ESTES limites
 * resolve o "vira o dia" à noite no Brasil (UTC-3). `fim` é a meia-noite do dia
 * seguinte (exclusiva). `dia` é a data civil de SP (YYYY-MM-DD) — chave do claim.
 */
export function janelaDiaSaoPaulo(agora: Date): { inicioISO: string; fimISO: string; dia: string } {
  const dia = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora) // YYYY-MM-DD
  const [y, m, d] = dia.split('-').map(Number)
  // Âncora ao meio-dia UTC do dia civil de SP: longe das bordas de meia-noite, o
  // offset lido é sempre o do dia certo (imune a DST se ele voltar).
  const off = offsetHorasSaoPaulo(new Date(Date.UTC(y, m - 1, d, 12)))
  const inicio = new Date(Date.UTC(y, m - 1, d, off, 0, 0)) // 00:00 de SP em UTC
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000)
  return { inicioISO: inicio.toISOString(), fimISO: fim.toISOString(), dia }
}

/** Primeiro nome, capitalizado, para a saudação (mesmo padrão do notificar.ts). */
function primeiroNome(nome: string | null | undefined): string {
  const p = (nome ?? '').trim().split(/\s+/)[0]
  if (!p) return ''
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
}

/**
 * Título curto da tarefa para o item da lista: colapsa espaços/quebras e corta
 * em `max` caracteres (com reticências). As tarefas do escritório têm títulos
 * longos ("CLIENTE x PARTE: AÇÃO. PUB dd/mm. N dias") — encurtar mantém a
 * mensagem legível no WhatsApp.
 */
export function tituloCurtoTarefa(descricao: string, max = 60): string {
  const limpo = (descricao ?? '').replace(/\s+/g, ' ').trim()
  if (limpo.length <= max) return limpo
  return `${limpo.slice(0, max - 1).trimEnd()}…`
}

export interface TarefaAviso {
  id: string
  description: string
}

const MAX_ITENS = 10

/**
 * Monta a ÚNICA mensagem do aviso diário. Saudação + até 10 itens
 * "• {título curto} → {url}/tarefas?task={id}" + "...e mais N" quando sobrar.
 * Pura: sem rede/DB (testável). `urlBase` vem de urlBaseApp() no chamador.
 */
export function montarMensagemAvisoTarefas(args: {
  nome: string | null
  tarefas: TarefaAviso[]
  urlBase: string
}): string {
  const nome = primeiroNome(args.nome)
  const saud = nome ? `Bom dia, ${nome}!` : 'Bom dia!'
  const base = args.urlBase.replace(/\/+$/, '') // sem barra final duplicada
  const visiveis = args.tarefas.slice(0, MAX_ITENS)
  const linhas = visiveis.map(
    (t) => `• ${tituloCurtoTarefa(t.description)} → ${base}/tarefas?task=${t.id}`,
  )
  const restantes = args.tarefas.length - visiveis.length
  const partes = [`${saud} Suas tarefas de hoje no SIMAS:`, '', ...linhas]
  if (restantes > 0) partes.push(`...e mais ${restantes}`)
  return partes.join('\n')
}

// ── Orquestração (I/O) ───────────────────────────────────────────────────────

interface UsuarioComCelular {
  id: string
  nome: string | null
  tenant_id: string
  unidade: string | null
  celular: string
}

export interface ResultadoAvisosTarefas {
  usuarios: number
  comTarefas: number
  enviados: number
  erros: number
}

/**
 * Para cada usuário ATIVO com celular, junta as tarefas NÃO concluídas que vencem
 * HOJE (janela civil de São Paulo) onde ele é responsável (assignee_id) OU
 * envolvido (task_assignees); se houver ao menos uma, reivindica o dia (claim
 * atômico) e envia UMA mensagem ao WhatsApp dele. `deadline` (epoch ms) corta o
 * lote antes do teto de tempo do cron. LGPD: logs só com ids/contagens.
 */
export async function enviarAvisosTarefasHoje(
  admin: SupabaseClient,
  deadline: number,
): Promise<ResultadoAvisosTarefas> {
  const { inicioISO, fimISO, dia } = janelaDiaSaoPaulo(new Date())

  const { data: usuariosRaw, error: errUsuarios } = await admin
    .from('users')
    .select('id, nome, tenant_id, unidade, celular')
    .eq('status', 'ativo')
    .not('celular', 'is', null)
  if (errUsuarios) throw errUsuarios

  const usuarios = (usuariosRaw ?? []) as UsuarioComCelular[]
  const resultado: ResultadoAvisosTarefas = { usuarios: usuarios.length, comTarefas: 0, enviados: 0, erros: 0 }
  if (usuarios.length === 0) return resultado
  const userIds = usuarios.map((u) => u.id)

  // Tarefas de hoje (não concluídas) onde o usuário é RESPONSÁVEL (assignee_id).
  const { data: comoResp, error: errResp } = await admin
    .from('tasks')
    .select('id, description, due_date, assignee_id')
    .is('completed_at', null)
    .gte('due_date', inicioISO)
    .lt('due_date', fimISO)
    .in('assignee_id', userIds)
  if (errResp) throw errResp

  // Tarefas de hoje onde o usuário é ENVOLVIDO (task_assignees N:N). O !inner +
  // filtros sobre a tabela embutida restringem à MESMA janela e não concluídas.
  const { data: comoEnv, error: errEnv } = await admin
    .from('task_assignees')
    .select('user_id, task:tasks!inner(id, description, due_date, completed_at)')
    .in('user_id', userIds)
    .is('task.completed_at', null)
    .gte('task.due_date', inicioISO)
    .lt('task.due_date', fimISO)
  if (errEnv) throw errEnv

  // Agrupa por usuário deduplicando por id da tarefa (responsável E envolvido = 1x).
  const porUsuario = new Map<string, Map<string, TarefaAviso>>()
  const adicionar = (uid: string, t: TarefaAviso) => {
    if (!porUsuario.has(uid)) porUsuario.set(uid, new Map())
    porUsuario.get(uid)!.set(t.id, t)
  }
  for (const t of (comoResp ?? []) as { id: string; description: string; assignee_id: string | null }[]) {
    if (t.assignee_id) adicionar(t.assignee_id, { id: t.id, description: t.description })
  }
  for (const row of (comoEnv ?? []) as unknown as { user_id: string; task: { id: string; description: string } | null }[]) {
    if (row.task) adicionar(row.user_id, { id: row.task.id, description: row.task.description })
  }

  const urlBase = urlBaseApp()
  let processados = 0
  for (const u of usuarios) {
    if (Date.now() > deadline) {
      logger.warn('cron.avisos_tarefas.deadline_cortou', {
        processados,
        restantes: usuarios.length - processados,
      })
      break
    }
    processados++

    const mapa = porUsuario.get(u.id)
    if (!mapa || mapa.size === 0) continue // sem tarefas hoje → não claim, não envia
    resultado.comTarefas++

    // CLAIM atômico (INSERT ON CONFLICT DO NOTHING): só quem inserir a linha do
    // dia envia. upsert ignoreDuplicates + .select() → linhas SÓ quando inseriu.
    const { data: claim, error: errClaim } = await admin
      .from('avisos_tarefas_diarios')
      .upsert(
        { tenant_id: u.tenant_id, user_id: u.id, dia },
        { onConflict: 'user_id,dia', ignoreDuplicates: true },
      )
      .select('user_id')
    if (errClaim) {
      logger.error('cron.avisos_tarefas.claim_falhou', { user: u.id }, errClaim)
      continue
    }
    if (!claim || claim.length === 0) continue // outro worker já avisou este membro hoje

    const texto = montarMensagemAvisoTarefas({ nome: u.nome, tarefas: [...mapa.values()], urlBase })
    // Aviso AUTOMÁTICO: sem autor (não pausa a IA). Instância pela unidade do
    // membro (é o WhatsApp DELE) — exceção consciente ao "automático roteia pelo
    // DDD": aqui o destino é o próprio membro, e o número certo é o da unidade.
    const res = await enviarAvisoWhatsApp(u.celular, texto, instanciaDaUnidade(u.unidade))
    if (res.ok) resultado.enviados++
    else {
      // Falha NÃO desfaz o claim: preferimos perder um aviso a duplicar num retry.
      resultado.erros++
      logger.error('cron.avisos_tarefas.envio_falhou', { user: u.id })
    }
  }

  return resultado
}
